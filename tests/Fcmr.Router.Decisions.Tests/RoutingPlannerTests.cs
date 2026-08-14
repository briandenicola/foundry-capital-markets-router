using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

/// <summary>
/// T-209, T-210, T-211. The evaluation order is the feature; these tests assert it behaviourally
/// rather than by reading the code, because code reading does not survive a refactor.
/// </summary>
public class RoutingPlannerTests
{
    private static PolicySet Policy(params ModelVendor[] approved) => new()
    {
        Id = "CapitalMarkets-US",
        BusinessUnit = "CapitalMarkets",
        DisplayName = "Capital Markets",
        ApprovedVendors = new HashSet<ModelVendor>(approved),
        MaxClassification = approved.ToDictionary(v => v, _ => DataClassification.Confidential),
        Version = 4,
    };

    private static RoutingRequest Request(
        DataClassification classification = DataClassification.Internal,
        decimal ceiling = 1.00m,
        int tokens = 8_000) => new()
        {
            Hints = new ComplexityHints { InputTokenEstimate = tokens },
            CostCeilingUsd = ceiling,
            DataClassification = classification,
        };

    [Fact]
    public void Plan_WhenTheCheapestModelIsUnapproved_DoesNotSelectIt()
    {
        // The load-bearing test for evaluation order. The cheapest model in the catalog by a wide
        // margin belongs to a vendor governance has not approved. If cost ran before policy, a
        // cost optimiser would reach straight for it — which is the exact failure the exchange
        // exists to prevent.
        var catalog = new List<TierPricing>
        {
            new()
            {
                Tier = ModelTier.Standard, Deployment = "unapproved-bargain",
                CostPerRequestUsd = 0.0001m, Vendor = ModelVendor.XAI,
            },
            new()
            {
                Tier = ModelTier.Standard, Deployment = "approved-standard",
                CostPerRequestUsd = 0.500m, Vendor = ModelVendor.AzureOpenAI,
            },
        };

        var decision = RoutingPlanner.Plan(Request(), catalog, Policy(ModelVendor.AzureOpenAI));

        decision.SelectedDeployment.Should().Be("approved-standard");
        decision.SelectedVendor.Should().Be(ModelVendor.AzureOpenAI);
        decision.CandidateTiers.Should().NotContain(c => c.Deployment == "unapproved-bargain" && c.Selected);
        decision.PolicyExclusions.Should().ContainSingle(e => e.Deployment == "unapproved-bargain");
    }

    [Fact]
    public void Plan_ExcludedModelsAreNeverOfferedToTheSelector()
    {
        // Stronger than "was not selected": the selector must not even see them. An excluded model
        // appearing among the candidates would mean the gate filtered nothing.
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Economy, Deployment = "a", CostPerRequestUsd = 0.001m, Vendor = ModelVendor.XAI },
            new() { Tier = ModelTier.Standard, Deployment = "b", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
        };

        var decision = RoutingPlanner.Plan(Request(), catalog, Policy(ModelVendor.AzureOpenAI));

        decision.CandidateTiers.Should().ContainSingle()
            .Which.Deployment.Should().Be("b");
    }

    [Fact]
    public void Plan_AppliesThePolicyCeilingWhenItIsLowerThanTheRequestCeiling()
    {
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Economy, Deployment = "cheap", CostPerRequestUsd = 0.001m, Vendor = ModelVendor.AzureOpenAI },
            new() { Tier = ModelTier.Standard, Deployment = "mid", CostPerRequestUsd = 0.400m, Vendor = ModelVendor.AzureOpenAI },
        };

        var policy = Policy(ModelVendor.AzureOpenAI) with { MaxCostPerRequestUsd = 0.100m };

        // The request would allow 1.00 USD; policy caps it at 0.10.
        var decision = RoutingPlanner.Plan(Request(ceiling: 1.00m), catalog, policy);

        decision.SelectedDeployment.Should().Be("cheap");
        decision.PolicyExclusions.Should().ContainSingle(e => e.Deployment == "mid")
            .Which.Reason.Should().Contain("policy ceiling");
    }

    [Fact]
    public void Plan_PinsThePolicySetVersionOntoTheDecision()
    {
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "gpt", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
        };

        var decision = RoutingPlanner.Plan(
            Request(), catalog, Policy(ModelVendor.AzureOpenAI) with { Version = 11 });

        decision.PolicySetId.Should().Be("CapitalMarkets-US");
        decision.PolicySetVersion.Should().Be(11,
            "replaying an audit record after a policy edit must show the policy that actually applied");
        decision.DataClassification.Should().Be(DataClassification.Internal);
    }

    [Fact]
    public void Plan_RefusalIsDistinctFromDenial()
    {
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "gpt", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
        };

        var refused = RoutingPlanner.Plan(Request(), catalog, Policy(ModelVendor.Anthropic));
        var denied = RoutingPlanner.Plan(Request(ceiling: 0.0001m), catalog, Policy(ModelVendor.AzureOpenAI));

        refused.Outcome.Should().Be(RoutingOutcome.RefusedByPolicy);
        denied.Outcome.Should().Be(RoutingOutcome.Denied);
        refused.Outcome.Should().NotBe(denied.Outcome,
            "'not permitted' and 'too expensive' are different conversations with different people");
    }

    [Fact]
    public void Plan_RefusalRationaleNamesTheVendorsAndTheClassification()
    {
        // The presenter reads this sentence aloud in Beat 5. "Refused by policy" is not an answer
        // a governance audience accepts.
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "gpt", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
            new() { Tier = ModelTier.Premium, Deployment = "claude", CostPerRequestUsd = 0.090m, Vendor = ModelVendor.Anthropic },
        };

        var decision = RoutingPlanner.Plan(
            Request(DataClassification.Restricted), catalog, Policy(ModelVendor.XAI));

        decision.Rationale.Should().Contain("CapitalMarkets-US");
        decision.Rationale.Should().Contain("Restricted");
        decision.Rationale.Should().Contain("AzureOpenAI");
        decision.Rationale.Should().Contain("Anthropic");
        decision.PolicyExclusions.Should().OnlyContain(
            e => e.Kind == PolicyExclusionKind.VendorNotApproved);
    }

    [Fact]
    public void Plan_WhenEveryCandidateIsPricedOutByPolicy_SaysItIsACostOutcome()
    {
        // Without this the audience is told "governance refused it" when the truth is "nobody was
        // willing to pay for it" -- two different conversations with two different owners.
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "gpt", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
        };

        var policy = Policy(ModelVendor.AzureOpenAI) with { MaxCostPerRequestUsd = 0.001m };

        var decision = RoutingPlanner.Plan(Request(), catalog, policy);

        decision.Outcome.Should().Be(RoutingOutcome.RefusedByPolicy);
        decision.PolicyExclusions.Should().OnlyContain(
            e => e.Kind == PolicyExclusionKind.PolicyCostCeiling);
        decision.Rationale.Should().Contain("cost outcome rather than a governance one");
    }

    [Fact]
    public void Plan_WithSeveralVendorsInTheIndicatedTier_TakesTheCheapest()
    {
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "expensive", CostPerRequestUsd = 0.080m, Vendor = ModelVendor.AzureOpenAI },
            new() { Tier = ModelTier.Standard, Deployment = "cheapest", CostPerRequestUsd = 0.020m, Vendor = ModelVendor.Anthropic },
            new() { Tier = ModelTier.Standard, Deployment = "middle", CostPerRequestUsd = 0.050m, Vendor = ModelVendor.XAI },
        };

        var decision = RoutingPlanner.Plan(
            Request(), catalog, Policy(ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI));

        decision.SelectedDeployment.Should().Be("cheapest");
        decision.SelectedVendor.Should().Be(ModelVendor.Anthropic);
    }

    [Fact]
    public void Plan_MarksExactlyOneCandidateSelected()
    {
        // A multi-vendor catalog puts several models in one tier. Marking selection by tier
        // rather than by deployment would flag every same-tier competitor as the one that ran,
        // and the scoreboard's cost attribution is only as honest as this flag.
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "a", CostPerRequestUsd = 0.020m, Vendor = ModelVendor.AzureOpenAI },
            new() { Tier = ModelTier.Standard, Deployment = "b", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.Anthropic },
            new() { Tier = ModelTier.Standard, Deployment = "c", CostPerRequestUsd = 0.040m, Vendor = ModelVendor.XAI },
        };

        var decision = RoutingPlanner.Plan(
            Request(), catalog, Policy(ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI));

        decision.CandidateTiers.Count(c => c.Selected).Should().Be(1);
        decision.CandidateTiers.Where(c => !c.Selected).Should()
            .OnlyContain(c => !string.IsNullOrWhiteSpace(c.RejectedReason));
    }

    [Fact]
    public void Plan_IsDeterministic_ForIdenticalInputs()
    {
        // Beat 5 submits byte-identical payloads either side of a policy change. Any nondeterminism
        // here reads on stage as the router being arbitrary.
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "a", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
            new() { Tier = ModelTier.Standard, Deployment = "b", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.Anthropic },
        };

        var policy = Policy(ModelVendor.AzureOpenAI, ModelVendor.Anthropic);

        var first = RoutingPlanner.Plan(Request(), catalog, policy);
        var second = RoutingPlanner.Plan(Request(), catalog, policy);

        second.SelectedDeployment.Should().Be(first.SelectedDeployment);
        second.Rationale.Should().Be(first.Rationale);
    }

    [Fact]
    public void Plan_WithAnEmptyCatalog_Throws()
    {
        var act = () => RoutingPlanner.Plan(Request(), [], Policy(ModelVendor.AzureOpenAI));

        act.Should().Throw<ArgumentException>();
    }
}
