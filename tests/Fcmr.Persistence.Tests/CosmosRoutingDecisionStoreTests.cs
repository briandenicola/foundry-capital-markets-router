using System.Text.Json;
using Fcmr.Router.Decisions;
using Fcmr.RouterService.Contracts;
using Fcmr.RouterService.Persistence;
using FluentAssertions;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Fcmr.Persistence.Tests;

/// <summary>
/// T-014. Exercises <see cref="CosmosRoutingDecisionStore"/> against a real Cosmos DB engine.
///
/// <para>
/// These assertions cannot be made against <c>InMemoryRoutingDecisionStore</c>, and that is the
/// justification for the suite. Serialization, partition-key routing, create-versus-upsert
/// semantics and query behaviour are all properties of the database, and an in-memory double
/// agrees with whatever the code believes — which is precisely why it never catches the case where
/// the code is wrong.
/// </para>
/// <para>
/// What the emulator does not cover is stated plainly rather than papered over: managed-identity
/// authentication, private endpoints and RBAC do not exist in it. Those remain unverified until a
/// subscription is available, and are tracked on T-014 rather than presumed to work.
/// </para>
/// </summary>
[Collection(nameof(CosmosEmulatorCollection))]
public sealed class CosmosRoutingDecisionStoreTests(CosmosEmulatorFixture emulator)
{
    [Fact]
    public async Task SavedDecision_IsReadBackIdentically()
    {
        var record = Record(NewCorrelationId());

        await emulator.Store.SaveAsync(record);

        var read = await emulator.Store.GetAsync(record.CorrelationId);

        read.Should().ContainSingle();
        read[0].Should().BeEquivalentTo(record,
            "a decision that does not survive a round-trip through the system of record is not " +
            "evidence of anything. This is the assertion the in-memory store could never make: it " +
            "hands back the same object it was given and never serialises it at all");
    }

    [Fact]
    public async Task StoredDocument_WritesEnumsAsNames()
    {
        var record = Record(NewCorrelationId());

        await emulator.Store.SaveAsync(record);

        var raw = await ReadRawAsync(record);

        raw.GetProperty("lane").GetString().Should().Be("OrderRouting");
        raw.GetProperty("decision").GetProperty("outcome").GetString().Should().Be("Routed");
        raw.GetProperty("decision").GetProperty("selectedTier").GetString().Should().Be("Standard");
    }

    [Fact]
    public async Task StoredDocument_UsesTheCamelCaseNamesTheDataModelPublishes()
    {
        var record = Record(NewCorrelationId());

        await emulator.Store.SaveAsync(record);

        var raw = await ReadRawAsync(record);

        raw.TryGetProperty("correlationId", out _).Should().BeTrue();
        raw.TryGetProperty("complexityInputs", out _).Should().BeTrue();
        raw.TryGetProperty("createdAt", out _).Should().BeTrue();
        raw.TryGetProperty("CorrelationId", out _).Should().BeFalse(
            "PascalCase members would make the stored document disagree with data-model.md, and a " +
            "document readable only by the code that wrote it is not an audit record");
    }

    [Fact]
    public async Task StoredDocument_PreservesDecimalCostExactly()
    {
        var record = Record(NewCorrelationId()) with
        {
            Decision = Decision() with { CostCeilingUsd = 0.0315m },
        };

        await emulator.Store.SaveAsync(record);

        var read = await emulator.Store.GetAsync(record.CorrelationId);

        read[0].Decision.CostCeilingUsd.Should().Be(0.0315m,
            "cost is what the scoreboard adds up and what the cost ceiling is compared against. A " +
            "value that arrives back as a binary-rounded double is a governance control drifting " +
            "quietly out of true");
    }

    [Fact]
    public async Task SavingTheSameIdTwice_IsRefusedRatherThanOverwriting()
    {
        var record = Record(NewCorrelationId());
        await emulator.Store.SaveAsync(record);

        var second = record with { Decision = Decision() with { Rationale = "A different decision." } };

        var act = async () => await emulator.Store.SaveAsync(second);

        (await act.Should().ThrowAsync<CosmosException>())
            .Which.StatusCode.Should().Be(System.Net.HttpStatusCode.Conflict,
                "the adapter uses CreateItem, not UpsertItem. This container is the system of " +
                "record for what the router decided; an upsert would let a duplicate id silently " +
                "replace a previous decision, and the loss would be invisible");

        var read = await emulator.Store.GetAsync(record.CorrelationId);
        read.Should().ContainSingle();
        read[0].Decision.Rationale.Should().Be(record.Decision.Rationale);
    }

    [Fact]
    public async Task Get_ReturnsOnlyTheRequestedCorrelation()
    {
        var mine = NewCorrelationId();
        var other = NewCorrelationId();

        await emulator.Store.SaveAsync(Record(mine));
        await emulator.Store.SaveAsync(Record(mine));
        await emulator.Store.SaveAsync(Record(other));

        var read = await emulator.Store.GetAsync(mine);

        read.Should().HaveCount(2);
        read.Should().OnlyContain(r => r.CorrelationId == mine,
            "AC-8 reconstructs one request's story. A query that leaked another correlation's " +
            "decisions into it would produce an audit answer about the wrong request");
    }

    [Fact]
    public async Task Get_ForAnUnknownCorrelation_ReturnsEmptyRatherThanThrowing()
    {
        var read = await emulator.Store.GetAsync(NewCorrelationId());

        read.Should().BeEmpty();
    }

    [Fact]
    public async Task ListSince_ExcludesRecordsOlderThanTheWindow()
    {
        var now = DateTimeOffset.UtcNow;
        var correlationId = NewCorrelationId();

        await emulator.Store.SaveAsync(Record(correlationId) with { CreatedAt = now.AddHours(-48) });
        await emulator.Store.SaveAsync(Record(correlationId) with { CreatedAt = now.AddMinutes(-5) });

        var read = await emulator.Store.ListSinceAsync(now.AddHours(-1));

        read.Should().NotBeEmpty();
        read.Should().OnlyContain(r => r.CreatedAt >= now.AddHours(-1),
            "the scoreboard reports a window. Including older records would overstate the saving " +
            "the demo claims, which is the one number the audience will check");
    }

    [Fact]
    public async Task ListSince_ReturnsMostRecentFirst()
    {
        var correlationId = NewCorrelationId();
        var now = DateTimeOffset.UtcNow;

        await emulator.Store.SaveAsync(Record(correlationId) with { CreatedAt = now.AddMinutes(-30) });
        await emulator.Store.SaveAsync(Record(correlationId) with { CreatedAt = now.AddMinutes(-10) });
        await emulator.Store.SaveAsync(Record(correlationId) with { CreatedAt = now.AddMinutes(-20) });

        var read = await emulator.Store.ListSinceAsync(now.AddHours(-1));

        read.Select(r => r.CreatedAt).Should().BeInDescendingOrder();
    }

    [Fact]
    public async Task IsReachable_IsTrueWhenTheContainerExists()
    {
        (await emulator.Store.IsReachableAsync()).Should().BeTrue();
    }

    [Fact]
    public async Task IsReachable_IsFalseWhenTheContainerIsMissing()
    {
        var missing = new CosmosRoutingDecisionStore(
            emulator.Client,
            new CosmosOptions
            {
                Database = emulator.Options.Database,
                DecisionsContainer = "aContainerThatDoesNotExist",
            });

        (await missing.IsReachableAsync()).Should().BeFalse(
            "readiness must consult the container the service actually writes to. A probe that " +
            "only proved the account was up would report ready while every write failed");
    }

    [Fact]
    public void EmulatorKeyPath_IsRefusedOutsideDevelopment()
    {
        var options = new CosmosOptions
        {
            Enabled = true,
            UseEmulator = true,
            AccountEndpoint = emulator.Options.AccountEndpoint,
        };

        var act = () => CosmosClientFactory.Create(
            options, new HostingEnvironment { EnvironmentName = Environments.Production });

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*emulator*",
                "the emulator authenticates with a key, and key authentication outside a " +
                "developer's machine would break the managed-identity-only rule. The guard is " +
                "asserted here because a control nobody tests is a comment");
    }

    [Fact]
    public void MissingEndpoint_FailsAtStartupRatherThanAtFirstWrite()
    {
        var act = () => CosmosClientFactory.Create(
            new CosmosOptions { Enabled = true, AccountEndpoint = "" },
            new HostingEnvironment());

        act.Should().Throw<InvalidOperationException>(
            "a service that starts without a decision store accepts requests it cannot record. " +
            "Failing at startup makes that impossible rather than merely unlikely");
    }

    private async Task<JsonElement> ReadRawAsync(RoutingDecisionRecord record)
    {
        // Read as a document rather than as the typed record, so the assertion is about what is
        // actually stored. Deserialising into the type would round-trip through the same
        // conventions being tested and agree with itself.
        var response = await emulator.Client
            .GetContainer(emulator.Options.Database, emulator.Options.DecisionsContainer)
            .ReadItemAsync<JsonElement>(record.Id, new PartitionKey(record.CorrelationId));

        return response.Resource;
    }

    private static string NewCorrelationId() => Guid.NewGuid().ToString();

    private static RoutingDecisionRecord Record(string correlationId) => new()
    {
        Id = Guid.NewGuid().ToString(),
        CorrelationId = correlationId,
        Lane = Lane.OrderRouting,
        TaskKind = "BestExecutionAnalysis",
        Decision = Decision(),
        ComplexityInputs = new ComplexityHints
        {
            InputTokenEstimate = 4200,
            RequiresMultiStep = true,
            RequiresRetrieval = true,
            RequiresToolCalls = false,
        },
        CreatedAt = DateTimeOffset.UtcNow,
        LatencyMs = 812,
    };

    private static RoutingDecision Decision() => new()
    {
        ComplexityScore = 0.61,
        CostCeilingUsd = 0.25m,
        Outcome = RoutingOutcome.Routed,
        SelectedTier = ModelTier.Standard,
        SelectedDeployment = "gpt-5.4",
        SelectedVendor = ModelVendor.AzureOpenAI,
        PolicySetId = "CapitalMarkets-US",
        PolicySetVersion = 3,
        DataClassification = DataClassification.Confidential,
        Rationale = "Moderate complexity, within the standard cost ceiling.",
        CandidateTiers =
        [
            new TierCandidate
            {
                Tier = ModelTier.Economy,
                Deployment = "gpt-5.4-mini",
                ProjectedCostUsd = 0.004m,
                Vendor = ModelVendor.AzureOpenAI,
                Selected = false,
                RejectedReason = "Below the quality floor for multi-step retrieval.",
            },
            new TierCandidate
            {
                Tier = ModelTier.Standard,
                Deployment = "gpt-5.4",
                ProjectedCostUsd = 0.031m,
                Vendor = ModelVendor.AzureOpenAI,
                Selected = true,
            },
        ],
        PolicyExclusions =
        [
            new PolicyExclusion
            {
                Deployment = "claude-opus-4.6",
                Vendor = ModelVendor.Anthropic,
                Kind = PolicyExclusionKind.VendorNotApproved,
                Reason = "Anthropic is not an approved vendor for CapitalMarkets-US.",
            },
        ],
    };
}
