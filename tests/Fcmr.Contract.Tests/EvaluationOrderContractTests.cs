using Fcmr.Router.Decisions;
using FluentAssertions;
using Xunit;

namespace Fcmr.Contract.Tests;

/// <summary>
/// The evaluation-order guarantee from
/// <c>specs/002-governed-exchange/contracts/router-api-policy-extension.md</c>:
///
/// <code>catalog -&gt; PolicyGate.Evaluate() -&gt; eligible -&gt; TierSelector.Select() -&gt; decision</code>
///
/// The contract says this order "is asserted by test, not left to code reading", so it is asserted
/// here at the decision layer as well as over HTTP in <see cref="RouteContractTests"/>. The HTTP
/// test can only observe that the selection is absent from the exclusion list, because a contract
/// test cannot install a policy set. These tests can construct the adversarial catalog directly:
/// the cheapest model in it is the one governance forbids, so a cost-first implementation would
/// pick it every time.
///
/// This exercises the frozen <c>Fcmr.Router.Decisions</c> assembly and does not modify it.
/// </summary>
public sealed class EvaluationOrderContractTests
{
    /// <summary>
    /// A catalog whose cheapest entry by a wide margin is supplied by a vendor the policy set has
    /// not approved. Cost-first selection is therefore visible as a wrong answer, not as a
    /// coincidence.
    /// </summary>
    private static List<TierPricing> CatalogWhereTheCheapestIsForbidden() =>
    [
        new()
        {
            Tier = ModelTier.Economy,
            Deployment = "forbidden-bargain",
            CostPerRequestUsd = 0.0001m,
            Vendor = ModelVendor.Anthropic,
        },
        new()
        {
            Tier = ModelTier.Economy,
            Deployment = "approved-economy",
            CostPerRequestUsd = 0.010m,
            Vendor = ModelVendor.AzureOpenAI,
        },
        new()
        {
            Tier = ModelTier.Standard,
            Deployment = "approved-standard",
            CostPerRequestUsd = 0.030m,
            Vendor = ModelVendor.AzureOpenAI,
        },
    ];

    private static PolicySet AzureOnly(DataClassification maximum = DataClassification.Restricted) => new()
    {
        Id = "CapitalMarkets-US",
        BusinessUnit = "CapitalMarkets",
        ApprovedVendors = new HashSet<ModelVendor> { ModelVendor.AzureOpenAI },
        MaxClassification = new Dictionary<ModelVendor, DataClassification>
        {
            [ModelVendor.AzureOpenAI] = maximum,
        },
        Version = 4,
    };

    [Theory]
    [InlineData(DataClassification.Public)]
    [InlineData(DataClassification.Internal)]
    [InlineData(DataClassification.Confidential)]
    [InlineData(DataClassification.Restricted)]
    public void Plan_NeverSelectsTheCheapestCandidateWhenPolicyForbidsIt(DataClassification classification)
    {
        var decision = RoutingPlanner.Plan(
            new RoutingRequest
            {
                Hints = new ComplexityHints { InputTokenEstimate = 4000 },
                CostCeilingUsd = 100m,
                DataClassification = classification,
            },
            CatalogWhereTheCheapestIsForbidden(),
            AzureOnly());

        decision.SelectedDeployment.Should().NotBe("forbidden-bargain",
            "the cheapest candidate is supplied by an unapproved vendor. Selecting it would mean " +
            "cost ran before governance, which is the precise failure the exchange exists to prevent");
        decision.SelectedVendor.Should().NotBe(ModelVendor.Anthropic);
    }

    [Fact]
    public void Plan_WhenPolicyLeavesNothing_RefusesRatherThanDowngrades()
    {
        var decision = RoutingPlanner.Plan(
            new RoutingRequest
            {
                Hints = new ComplexityHints { InputTokenEstimate = 4000 },
                CostCeilingUsd = 100m,
                DataClassification = DataClassification.Restricted,
            },
            CatalogWhereTheCheapestIsForbidden(),
            AzureOnly(maximum: DataClassification.Internal));

        decision.Outcome.Should().Be(RoutingOutcome.RefusedByPolicy,
            "governance left no eligible model, and a refusal is not a cheaper route");
        decision.Outcome.Should().NotBe(RoutingOutcome.Denied,
            "Denied is the cost outcome. Collapsing the two loses the distinction between " +
            "'too expensive' and 'not permitted'");
        decision.SelectedDeployment.Should().BeNull();
        decision.PolicyExclusions.Should().NotBeEmpty();
    }

    [Fact]
    public void Plan_PinsThePolicySetVersionInForceAtDecisionTime()
    {
        var decision = RoutingPlanner.Plan(
            new RoutingRequest
            {
                Hints = new ComplexityHints { InputTokenEstimate = 4000 },
                CostCeilingUsd = 100m,
                DataClassification = DataClassification.Internal,
            },
            CatalogWhereTheCheapestIsForbidden(),
            AzureOnly());

        decision.PolicySetId.Should().Be("CapitalMarkets-US");
        decision.PolicySetVersion.Should().Be(4);
        decision.DataClassification.Should().Be(DataClassification.Internal,
            "the classification is recorded as declared, never inferred and never defaulted");
    }
}
