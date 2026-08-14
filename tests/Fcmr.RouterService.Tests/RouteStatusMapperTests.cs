using Fcmr.Router.Decisions;
using Fcmr.RouterService.Routing;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace Fcmr.RouterService.Tests;

/// <summary>
/// The outcome-to-status mapping, exercised through real decisions produced by
/// <see cref="RoutingPlanner.Plan"/> rather than through hand-built decision records.
///
/// Hand-built records would let this suite pass while the planner produced something else
/// entirely, and the distinction under test — "too expensive" against "not permitted" — is
/// precisely the one that would go unnoticed.
/// </summary>
public sealed class RouteStatusMapperTests
{
    private static readonly IReadOnlyList<TierPricing> Catalog =
    [
        new() { Tier = ModelTier.Economy, Deployment = "economy-1", CostPerRequestUsd = 0.004m },
        new() { Tier = ModelTier.Standard, Deployment = "standard-1", CostPerRequestUsd = 0.031m },
        new() { Tier = ModelTier.Premium, Deployment = "premium-1", CostPerRequestUsd = 0.180m },
    ];

    private static PolicySet Permissive(decimal ceiling = 100m) => new()
    {
        Id = "TestPolicy",
        BusinessUnit = "CapitalMarkets",
        ApprovedVendors = new HashSet<ModelVendor> { ModelVendor.AzureOpenAI },
        MaxClassification = new Dictionary<ModelVendor, DataClassification>
        {
            [ModelVendor.AzureOpenAI] = DataClassification.Restricted,
        },
        MaxCostPerRequestUsd = ceiling,
        PermitsRestrictedData = true,
    };

    private static RoutingRequest Request(decimal ceiling, ComplexityHints? hints = null) => new()
    {
        Hints = hints ?? new ComplexityHints { InputTokenEstimate = 12_000, RequiresMultiStep = true, RequiresRetrieval = true },
        CostCeilingUsd = ceiling,
        DataClassification = DataClassification.Internal,
    };

    [Fact]
    public void Routed_is_two_hundred()
    {
        var decision = RoutingPlanner.Plan(Request(0.25m), Catalog, Permissive());

        decision.Outcome.Should().Be(RoutingOutcome.Routed);
        RouteStatusMapper.StatusFor(decision, Catalog).Should().Be(StatusCodes.Status200OK);
    }

    [Fact]
    public void Downgraded_is_two_hundred()
    {
        // High complexity indicates Premium; the ceiling only reaches Standard.
        var hints = new ComplexityHints
        {
            InputTokenEstimate = 32_000,
            RequiresMultiStep = true,
            RequiresRetrieval = true,
            RequiresToolCalls = true,
        };

        var decision = RoutingPlanner.Plan(Request(0.05m, hints), Catalog, Permissive());

        decision.Outcome.Should().Be(RoutingOutcome.Downgraded);
        RouteStatusMapper.StatusFor(decision, Catalog).Should().Be(StatusCodes.Status200OK);
    }

    [Fact]
    public void Denied_on_cost_is_four_hundred_and_two()
    {
        var decision = RoutingPlanner.Plan(Request(0.001m), Catalog, Permissive());

        decision.Outcome.Should().Be(RoutingOutcome.Denied);
        RouteStatusMapper.StatusFor(decision, Catalog).Should().Be(StatusCodes.Status402PaymentRequired);
        RouteStatusMapper.ErrorCodeFor(StatusCodes.Status402PaymentRequired)
            .Should().Be(RouteStatusMapper.CostCeilingExceeded);
    }

    /// <summary>
    /// The load-bearing case. A governance refusal is a governed answer, not a payment problem;
    /// carrying it on 402 would tell the caller to try again with a bigger budget, and no budget
    /// makes an unapproved vendor approved.
    /// </summary>
    [Fact]
    public void RefusedByPolicy_is_two_hundred_and_not_four_hundred_and_two()
    {
        var restrictive = Permissive() with
        {
            ApprovedVendors = new HashSet<ModelVendor> { ModelVendor.Anthropic },
            MaxClassification = new Dictionary<ModelVendor, DataClassification>
            {
                [ModelVendor.Anthropic] = DataClassification.Restricted,
            },
        };

        var decision = RoutingPlanner.Plan(Request(0.25m), Catalog, restrictive);

        decision.Outcome.Should().Be(RoutingOutcome.RefusedByPolicy);
        RouteStatusMapper.StatusFor(decision, Catalog).Should().Be(StatusCodes.Status200OK);
    }

    [Fact]
    public void A_classification_refusal_is_two_hundred()
    {
        var restrictive = Permissive() with
        {
            MaxClassification = new Dictionary<ModelVendor, DataClassification>
            {
                [ModelVendor.AzureOpenAI] = DataClassification.Public,
            },
        };

        var request = Request(0.25m) with { DataClassification = DataClassification.Restricted };
        var decision = RoutingPlanner.Plan(request, Catalog, restrictive);

        decision.Outcome.Should().Be(RoutingOutcome.RefusedByPolicy);
        RouteStatusMapper.StatusFor(decision, Catalog).Should().Be(StatusCodes.Status200OK);
    }

    [Fact]
    public void Nothing_available_is_five_hundred_and_three_rather_than_four_hundred_and_two()
    {
        var unavailable = Catalog.Select(c => c with { Available = false }).ToList();

        var decision = RoutingPlanner.Plan(Request(100m), unavailable, Permissive());

        decision.Outcome.Should().Be(RoutingOutcome.Denied);
        RouteStatusMapper.StatusFor(decision, unavailable).Should().Be(StatusCodes.Status503ServiceUnavailable);
        RouteStatusMapper.ErrorCodeFor(StatusCodes.Status503ServiceUnavailable)
            .Should().Be(RouteStatusMapper.NoTierAvailable);
    }

    /// <summary>
    /// Availability is judged over what policy left standing. A vendor governance already removed
    /// being offline says nothing about whether a tier was up for this request.
    /// </summary>
    [Fact]
    public void Availability_is_judged_only_over_candidates_policy_permitted()
    {
        List<TierPricing> mixed =
        [
            new() { Tier = ModelTier.Economy, Deployment = "approved-economy", CostPerRequestUsd = 0.004m, Vendor = ModelVendor.AzureOpenAI, Available = false },
            new() { Tier = ModelTier.Standard, Deployment = "unapproved-standard", CostPerRequestUsd = 0.031m, Vendor = ModelVendor.XAI, Available = true },
        ];

        var decision = RoutingPlanner.Plan(Request(100m), mixed, Permissive());

        decision.Outcome.Should().Be(RoutingOutcome.Denied);
        RouteStatusMapper.StatusFor(decision, mixed).Should().Be(StatusCodes.Status503ServiceUnavailable);
    }

    [Fact]
    public void Every_outcome_the_decisions_assembly_can_produce_has_a_mapping()
    {
        foreach (var outcome in Enum.GetValues<RoutingOutcome>())
        {
            var decision = new RoutingDecision
            {
                ComplexityScore = 0.5,
                CostCeilingUsd = 0.25m,
                Outcome = outcome,
                CandidateTiers = [],
                Rationale = "test",
            };

            RouteStatusMapper.StatusFor(decision, Catalog)
                .Should().NotBe(StatusCodes.Status500InternalServerError,
                    $"outcome {outcome} must have an explicit status mapping");
        }
    }
}
