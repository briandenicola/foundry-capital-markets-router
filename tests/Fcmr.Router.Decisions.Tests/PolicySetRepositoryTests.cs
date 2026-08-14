using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

/// <summary>
/// T-203. Optimistic concurrency, validation, and the change diff.
///
/// The behaviour proven here is the behaviour the Cosmos implementation must reproduce: a stale
/// write is rejected, never merged.
/// </summary>
public class PolicySetRepositoryTests
{
    private static PolicySet Baseline() => new()
    {
        Id = "CapitalMarkets-US",
        BusinessUnit = "CapitalMarkets",
        DisplayName = "Capital Markets — US",
        ApprovedVendors = new HashSet<ModelVendor>
        {
            ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI, ModelVendor.OpenWeight,
        },
        MaxClassification = new Dictionary<ModelVendor, DataClassification>
        {
            [ModelVendor.AzureOpenAI] = DataClassification.Confidential,
            [ModelVendor.Anthropic] = DataClassification.Internal,
            [ModelVendor.XAI] = DataClassification.Internal,
            [ModelVendor.OpenWeight] = DataClassification.Restricted,
        },
        AllowedRegions = new HashSet<string> { "eastus2" },
        MaxCostPerRequestUsd = 0.5m,
        PermitsRestrictedData = true,
        Version = 3,
    };

    private static InMemoryPolicySetRepository Repo() => new([Baseline()]);

    private static PolicySetUpdate Update(int expectedVersion, params ModelVendor[] approved) => new()
    {
        Id = "CapitalMarkets-US",
        BusinessUnit = "CapitalMarkets",
        ExpectedVersion = expectedVersion,
        UpdatedBy = "8f1c-approver",
        ApprovedVendors = new HashSet<ModelVendor>(approved),
        MaxClassification = approved.ToDictionary(
            v => v,
            v => v == ModelVendor.OpenWeight ? DataClassification.Restricted : DataClassification.Internal),
    };

    [Fact]
    public async Task UpdateAsync_WithTheCurrentVersion_IncrementsAndRecordsTheApprover()
    {
        var repo = Repo();

        var result = await repo.UpdateAsync(
            Update(3, ModelVendor.AzureOpenAI, ModelVendor.XAI, ModelVendor.OpenWeight));

        result.PolicySet.Version.Should().Be(4);
        result.PolicySet.UpdatedBy.Should().Be("8f1c-approver");
        result.PolicySet.ApprovedVendors.Should().NotContain(ModelVendor.Anthropic);
    }

    [Fact]
    public async Task UpdateAsync_WithAStaleVersion_FailsAndDoesNotMerge()
    {
        var repo = Repo();

        await repo.UpdateAsync(Update(3, ModelVendor.AzureOpenAI, ModelVendor.OpenWeight));

        // A second approver still holding version 3 must not silently overwrite the first.
        var act = async () => await repo.UpdateAsync(
            Update(3, ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.OpenWeight));

        var thrown = await act.Should().ThrowAsync<PolicySetConcurrencyException>();
        thrown.Which.ExpectedVersion.Should().Be(3);
        thrown.Which.ActualVersion.Should().Be(4);

        var current = await repo.GetAsync("CapitalMarkets", "CapitalMarkets-US");
        current!.Version.Should().Be(4, "the rejected write must leave no trace");
        current.ApprovedVendors.Should().NotContain(ModelVendor.Anthropic);
    }

    [Fact]
    public async Task UpdateAsync_ReturnsABeforeAndAfterDiff()
    {
        var repo = Repo();

        var result = await repo.UpdateAsync(
            Update(3, ModelVendor.AzureOpenAI, ModelVendor.XAI, ModelVendor.OpenWeight));

        var vendorChange = result.Changed.Should().ContainSingle(c => c.Field == "approvedVendors").Subject;
        vendorChange.From.Should().Contain("Anthropic");
        vendorChange.To.Should().NotContain("Anthropic");
    }

    [Fact]
    public async Task UpdateAsync_WhenTheChangeWouldLeaveRestrictedUnservable_Fails422()
    {
        var repo = Repo();

        // Removing OpenWeight strands the set: it is declared to permit Restricted, and no
        // remaining vendor may process it. Accepting this produces a policy set that refuses
        // every restricted request, which surfaces as a demo failure rather than an error.
        var act = async () => await repo.UpdateAsync(
            Update(3, ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI));

        var thrown = await act.Should().ThrowAsync<PolicySetValidationException>();
        thrown.Which.Error.Failure.Should().Be(PolicyValidationFailure.RestrictedDataUnservable);
        thrown.Which.Error.StatusCode.Should().Be(422);
    }

    [Fact]
    public async Task UpdateAsync_WhenClassificationNamesAnUnapprovedVendor_Fails400()
    {
        var repo = Repo();

        var update = new PolicySetUpdate
        {
            Id = "CapitalMarkets-US",
            BusinessUnit = "CapitalMarkets",
            ExpectedVersion = 3,
            UpdatedBy = "8f1c-approver",
            ApprovedVendors = new HashSet<ModelVendor> { ModelVendor.AzureOpenAI, ModelVendor.OpenWeight },
            MaxClassification = new Dictionary<ModelVendor, DataClassification>
            {
                [ModelVendor.AzureOpenAI] = DataClassification.Confidential,
                [ModelVendor.OpenWeight] = DataClassification.Restricted,
                [ModelVendor.Anthropic] = DataClassification.Internal,
            },
        };

        var act = async () => await repo.UpdateAsync(update);

        var thrown = await act.Should().ThrowAsync<PolicySetValidationException>();

        thrown.Which.Error.Failure.Should().Be(PolicyValidationFailure.ClassificationNamesUnapprovedVendor);
        thrown.Which.Error.StatusCode.Should().Be(400);
    }

    [Fact]
    public async Task UpdateAsync_WhenValidationFails_LeavesTheStoredSetUntouched()
    {
        var repo = Repo();

        try
        {
            await repo.UpdateAsync(Update(3, ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI));
        }
        catch (PolicySetValidationException)
        {
            // expected
        }

        var current = await repo.GetAsync("CapitalMarkets", "CapitalMarkets-US");
        current!.Version.Should().Be(3, "a rejected change must not burn a version");
        current.ApprovedVendors.Should().Contain(ModelVendor.OpenWeight);
    }

    [Fact]
    public async Task UpdateAsync_OmittedFieldsAreLeftAlone()
    {
        var repo = Repo();

        var result = await repo.UpdateAsync(new PolicySetUpdate
        {
            Id = "CapitalMarkets-US",
            BusinessUnit = "CapitalMarkets",
            ExpectedVersion = 3,
            UpdatedBy = "8f1c-approver",
            MaxCostPerRequestUsd = 0.25m,
        });

        result.PolicySet.MaxCostPerRequestUsd.Should().Be(0.25m);
        result.PolicySet.ApprovedVendors.Should().HaveCount(4,
            "an omitted field means 'unchanged', never 'cleared'");
        result.PolicySet.AllowedRegions.Should().Contain("eastus2");
    }

    [Fact]
    public async Task HistoryAsync_ReturnsMostRecentFirst()
    {
        var repo = Repo();

        await repo.UpdateAsync(Update(3, ModelVendor.AzureOpenAI, ModelVendor.OpenWeight));
        await repo.UpdateAsync(Update(4, ModelVendor.AzureOpenAI, ModelVendor.XAI, ModelVendor.OpenWeight));

        var history = await repo.HistoryAsync("CapitalMarkets", "CapitalMarkets-US");

        history.Should().HaveCount(2);
        history[0].PolicySet.Version.Should().Be(5);
        history[1].PolicySet.Version.Should().Be(4);
    }

    [Fact]
    public async Task GetAsync_ForAnotherBusinessUnit_ReturnsNull()
    {
        var repo = Repo();

        var other = await repo.GetAsync("RetailBanking", "CapitalMarkets-US");

        other.Should().BeNull("governance is scoped per business unit");
    }

    [Fact]
    public async Task UpdateAsync_ForAnUnknownSet_Throws()
    {
        var repo = Repo();

        var act = async () => await repo.UpdateAsync(Update(1, ModelVendor.AzureOpenAI) with { Id = "Nope" });

        await act.Should().ThrowAsync<PolicySetNotFoundException>();
    }

    [Fact]
    public void Constructor_RejectsASeedThatCouldNotHaveBeenWrittenThroughTheApi()
    {
        var broken = Baseline() with
        {
            ApprovedVendors = new HashSet<ModelVendor> { ModelVendor.AzureOpenAI },
            MaxClassification = new Dictionary<ModelVendor, DataClassification>
            {
                [ModelVendor.AzureOpenAI] = DataClassification.Confidential,
            },
            PermitsRestrictedData = true,
        };

        var act = () => new InMemoryPolicySetRepository([broken]);

        act.Should().Throw<PolicySetValidationException>(
            "a Terraform-seeded baseline must obey the same rules as an API write");
    }

    [Fact]
    public async Task PolicyChange_IsVisibleToTheNextRoutingDecision()
    {
        // Beat 5 in miniature: change policy, resubmit an identical request, get a different plan.
        var repo = Repo();
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "claude", CostPerRequestUsd = 0.020m, Vendor = ModelVendor.Anthropic },
            new() { Tier = ModelTier.Standard, Deployment = "gpt", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
        };

        var request = new RoutingRequest
        {
            Hints = new ComplexityHints { InputTokenEstimate = 8_000 },
            CostCeilingUsd = 1.00m,
            DataClassification = DataClassification.Internal,
        };

        var before = RoutingPlanner.Plan(
            request, catalog, (await repo.GetAsync("CapitalMarkets", "CapitalMarkets-US"))!);

        before.SelectedVendor.Should().Be(ModelVendor.Anthropic, "it is the cheapest approved option");

        await repo.UpdateAsync(Update(3, ModelVendor.AzureOpenAI, ModelVendor.XAI, ModelVendor.OpenWeight));

        var after = RoutingPlanner.Plan(
            request, catalog, (await repo.GetAsync("CapitalMarkets", "CapitalMarkets-US"))!);

        after.SelectedVendor.Should().Be(ModelVendor.AzureOpenAI,
            "the same request, unchanged, must now route elsewhere");
        after.PolicySetVersion.Should().Be(4);
        before.PolicySetVersion.Should().Be(3, "the earlier decision keeps the version that governed it");
    }
}
