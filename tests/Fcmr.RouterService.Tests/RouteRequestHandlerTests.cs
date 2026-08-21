using System.Text.Json;
using Fcmr.Router.Decisions;
using Fcmr.RouterService.Configuration;
using Fcmr.RouterService.Contracts;
using Fcmr.ServiceDefaults.Correlation;
using Fcmr.RouterService.Persistence;
using Fcmr.RouterService.Routing;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Fcmr.RouterService.Tests;

public sealed class RouteRequestHandlerTests
{
    private sealed class StaticCatalog(IReadOnlyList<TierPricing> models) : IModelCatalog
    {
        public IReadOnlyList<TierPricing> Current() => models;
    }

    private sealed class UnreachableStore : IRoutingDecisionStore
    {
        public Task SaveAsync(RoutingDecisionRecord record, CancellationToken ct = default) =>
            throw new InvalidOperationException("store unreachable");

        public Task<IReadOnlyList<RoutingDecisionRecord>> GetAsync(string correlationId, CancellationToken ct = default) =>
            throw new InvalidOperationException("store unreachable");

        public Task<IReadOnlyList<RoutingDecisionRecord>> ListSinceAsync(DateTimeOffset since, CancellationToken ct = default) =>
            throw new InvalidOperationException("store unreachable");

        public Task<bool> IsReachableAsync(CancellationToken ct = default) => Task.FromResult(false);
    }

    private static readonly IReadOnlyList<TierPricing> Catalog =
    [
        new() { Tier = ModelTier.Economy, Deployment = "economy-1", CostPerRequestUsd = 0.004m },
        new() { Tier = ModelTier.Standard, Deployment = "standard-1", CostPerRequestUsd = 0.031m },
        new() { Tier = ModelTier.Premium, Deployment = "premium-1", CostPerRequestUsd = 0.180m },
    ];

    private static PolicySet Policy(string id = "CapitalMarkets-US") => new()
    {
        Id = id,
        BusinessUnit = "CapitalMarkets",
        ApprovedVendors = new HashSet<ModelVendor> { ModelVendor.AzureOpenAI },
        MaxClassification = new Dictionary<ModelVendor, DataClassification>
        {
            [ModelVendor.AzureOpenAI] = DataClassification.Restricted,
        },
        MaxCostPerRequestUsd = 10m,
        PermitsRestrictedData = true,
    };

    private static (RouteRequestHandler Handler, InMemoryRoutingDecisionStore Store, CorrelationIdAccessor Correlation) Build(
        IReadOnlyList<TierPricing>? catalog = null,
        PolicySet? policy = null,
        IRoutingDecisionStore? store = null)
    {
        var options = new RouterOptions();
        var decisionStore = store ?? new InMemoryRoutingDecisionStore();
        var correlation = new CorrelationIdAccessor();
        correlation.Establish("generated-id", CorrelationIdSource.Generated);

        var handler = new RouteRequestHandler(
            new StaticCatalog(catalog ?? Catalog),
            new InMemoryPolicySetRepository(policy is null ? [] : [policy]),
            decisionStore,
            new StaticOptionsMonitor<RouterOptions>(options),
            correlation,
            TimeProvider.System,
            NullLogger<RouteRequestHandler>.Instance);

        return (handler, decisionStore as InMemoryRoutingDecisionStore ?? new InMemoryRoutingDecisionStore(), correlation);
    }

    private static RouteRequest Valid() => new()
    {
        Lane = Lane.Research,
        TaskKind = "synthesize",
        CostCeilingUsd = 0.25m,
        LatencyBudgetMs = 8000,
        DataClassification = DataClassification.Internal,
        ComplexityHints = new ComplexityHintsDto
        {
            InputTokenEstimate = 12_000,
            RequiresMultiStep = true,
            RequiresRetrieval = true,
        },
    };

    [Fact]
    public async Task Routes_a_valid_request_and_returns_the_decision()
    {
        var (handler, _, _) = Build(policy: Policy());

        var result = await handler.HandleAsync(Valid());

        result.StatusCode.Should().Be(StatusCodes.Status200OK);
        var body = result.Body.Should().BeOfType<RouteResponse>().Subject;
        body.Decision.Outcome.Should().Be(RoutingOutcome.Routed);
        body.Decision.SelectedDeployment.Should().Be("standard-1");
        body.CorrelationId.Should().Be("generated-id");
    }

    /// <summary>
    /// The decision carries the policy set and version it was made under. Without that pin, an
    /// audit replayed after a policy edit shows a decision that appears to breach the policy in
    /// force, which is the finding an auditor escalates.
    /// </summary>
    [Fact]
    public async Task Pins_the_governing_policy_set_onto_the_decision()
    {
        var (handler, _, _) = Build(policy: Policy());

        var result = await handler.HandleAsync(Valid());

        var body = (RouteResponse)result.Body;
        body.Decision.PolicySetId.Should().Be("CapitalMarkets-US");
        body.Decision.PolicySetVersion.Should().Be(1);
        body.Decision.DataClassification.Should().Be(DataClassification.Internal);
    }

    [Fact]
    public async Task Never_claims_a_model_ran()
    {
        var (handler, _, _) = Build(policy: Policy());

        var result = await handler.HandleAsync(Valid());

        var body = (RouteResponse)result.Body;
        body.Result.Should().BeNull();
        body.Inference.State.Should().Be(InferenceState.NotInvoked);
        body.Metrics.PromptTokens.Should().BeNull();
        body.Metrics.CompletionTokens.Should().BeNull();
        body.Metrics.ActualCostUsd.Should().BeNull();
        body.Metrics.QualitySignal.Should().BeNull();
    }

    [Fact]
    public async Task Persists_every_decision_including_denials()
    {
        var store = new InMemoryRoutingDecisionStore();
        var (handler, _, _) = Build(policy: Policy(), store: store);

        await handler.HandleAsync(Valid() with { CostCeilingUsd = 0.001m });

        var saved = await store.GetAsync("generated-id");
        saved.Should().ContainSingle();
        saved[0].Decision.Outcome.Should().Be(RoutingOutcome.Denied);
        saved[0].Lane.Should().Be(Lane.Research);
        saved[0].TaskKind.Should().Be("synthesize");
        saved[0].ComplexityInputs.InputTokenEstimate.Should().Be(12_000);
    }

    [Fact]
    public async Task Surfaces_a_cost_denial_as_four_hundred_and_two_with_the_decision_attached()
    {
        var (handler, _, _) = Build(policy: Policy());

        var result = await handler.HandleAsync(Valid() with { CostCeilingUsd = 0.001m });

        result.StatusCode.Should().Be(StatusCodes.Status402PaymentRequired);
        var body = result.Body.Should().BeOfType<RouteErrorResponse>().Subject;
        body.Error.Should().Be(RouteStatusMapper.CostCeilingExceeded);
        body.Decision.Should().NotBeNull();
        body.CorrelationId.Should().Be("generated-id");
    }

    [Fact]
    public async Task Refuses_rather_than_routes_when_no_policy_set_can_be_resolved()
    {
        var (handler, _, _) = Build(policy: null);

        var result = await handler.HandleAsync(Valid());

        result.StatusCode.Should().Be(StatusCodes.Status503ServiceUnavailable);
        var body = result.Body.Should().BeOfType<RouteErrorResponse>().Subject;
        body.Error.Should().Be("GovernanceUnavailable");
    }

    [Fact]
    public async Task Refuses_when_no_deployments_are_configured()
    {
        var (handler, _, _) = Build(catalog: [], policy: Policy());

        var result = await handler.HandleAsync(Valid());

        result.StatusCode.Should().Be(StatusCodes.Status503ServiceUnavailable);
        ((RouteErrorResponse)result.Body).Error.Should().Be(RouteStatusMapper.NoTierAvailable);
    }

    [Fact]
    public async Task Rejects_an_invalid_request_with_a_correlation_id_and_every_problem()
    {
        var (handler, _, _) = Build(policy: Policy());

        var result = await handler.HandleAsync(new RouteRequest());

        result.StatusCode.Should().Be(StatusCodes.Status400BadRequest);
        var body = result.Body.Should().BeOfType<RouteErrorResponse>().Subject;
        body.CorrelationId.Should().Be("generated-id");
        body.Details.Should().NotBeNull().And.HaveCountGreaterThan(1);
    }

    [Fact]
    public async Task Rejects_a_payload_that_names_a_model()
    {
        var (handler, _, _) = Build(policy: Policy());

        var payload = JsonDocument.Parse("""{ "deployment": "premium-1" }""").RootElement.Clone();
        var result = await handler.HandleAsync(Valid() with { Payload = payload });

        result.StatusCode.Should().Be(StatusCodes.Status400BadRequest);
    }

    [Fact]
    public async Task Adopts_a_body_correlation_id_when_the_router_had_generated_one()
    {
        var (handler, _, correlation) = Build(policy: Policy());

        var result = await handler.HandleAsync(Valid() with { CorrelationId = "caller-supplied" });

        result.StatusCode.Should().Be(StatusCodes.Status200OK);
        correlation.Value.Should().Be("caller-supplied");
        ((RouteResponse)result.Body).CorrelationId.Should().Be("caller-supplied");
    }

    [Fact]
    public async Task Rejects_a_body_correlation_id_that_contradicts_the_header()
    {
        var options = new RouterOptions();
        var correlation = new CorrelationIdAccessor();
        correlation.Establish("from-header", CorrelationIdSource.Header);

        var handler = new RouteRequestHandler(
            new StaticCatalog(Catalog),
            new InMemoryPolicySetRepository([Policy()]),
            new InMemoryRoutingDecisionStore(),
            new StaticOptionsMonitor<RouterOptions>(options),
            correlation,
            TimeProvider.System,
            NullLogger<RouteRequestHandler>.Instance);

        var result = await handler.HandleAsync(Valid() with { CorrelationId = "from-body" });

        result.StatusCode.Should().Be(StatusCodes.Status400BadRequest);
        ((RouteErrorResponse)result.Body).Error.Should().Be("CorrelationIdConflict");
    }

    [Fact]
    public async Task A_governance_refusal_is_a_two_hundred_that_says_no_model_was_reached()
    {
        var restrictive = Policy() with
        {
            ApprovedVendors = new HashSet<ModelVendor> { ModelVendor.Anthropic },
            MaxClassification = new Dictionary<ModelVendor, DataClassification>
            {
                [ModelVendor.Anthropic] = DataClassification.Restricted,
            },
        };

        var (handler, _, _) = Build(policy: restrictive);

        var result = await handler.HandleAsync(Valid());

        result.StatusCode.Should().Be(StatusCodes.Status200OK);
        var body = result.Body.Should().BeOfType<RouteResponse>().Subject;
        body.Decision.Outcome.Should().Be(RoutingOutcome.RefusedByPolicy);
        body.Decision.PolicyExclusions.Should().NotBeEmpty();
        body.Inference.State.Should().Be(InferenceState.NotReached);
    }

    [Fact]
    public async Task A_store_failure_is_not_swallowed()
    {
        var (handler, _, _) = Build(policy: Policy(), store: new UnreachableStore());

        var act = async () => await handler.HandleAsync(Valid());

        // A decision the router cannot record is a decision that never happened as far as the
        // audit trail is concerned. Returning 200 here would put an unrecorded model call one
        // commit away.
        await act.Should().ThrowAsync<InvalidOperationException>();
    }
}

internal sealed class StaticOptionsMonitor<T>(T value) : IOptionsMonitor<T>
{
    public T CurrentValue => value;

    public T Get(string? name) => value;

    public IDisposable? OnChange(Action<T, string?> listener) => null;
}
