using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

public class TierSelectorTests
{
    private static List<TierPricing> Pricing(bool premiumAvailable = true) =>
    [
        new() { Tier = ModelTier.Economy, Deployment = "economy-dep", CostPerRequestUsd = 0.004m },
        new() { Tier = ModelTier.Standard, Deployment = "standard-dep", CostPerRequestUsd = 0.031m },
        new() { Tier = ModelTier.Premium, Deployment = "premium-dep", CostPerRequestUsd = 0.180m, Available = premiumAvailable },
    ];

    [Fact]
    public void Select_WithinCeiling_RoutesToIndicatedTier()
    {
        var decision = TierSelector.Select(0.50, 0.25m, Pricing());

        decision.Outcome.Should().Be(RoutingOutcome.Routed);
        decision.SelectedTier.Should().Be(ModelTier.Standard);
        decision.SelectedDeployment.Should().Be("standard-dep");
    }

    [Fact]
    public void Select_WhenIndicatedTierExceedsCeiling_Downgrades()
    {
        var decision = TierSelector.Select(0.90, 0.05m, Pricing());

        decision.Outcome.Should().Be(RoutingOutcome.Downgraded);
        decision.SelectedTier.Should().Be(ModelTier.Standard);
        decision.Rationale.Should().Contain("Downgraded");
    }

    [Fact]
    public void Select_WhenNothingIsAffordable_Denies()
    {
        var decision = TierSelector.Select(0.90, 0.001m, Pricing());

        decision.Outcome.Should().Be(RoutingOutcome.Denied);
        decision.SelectedTier.Should().BeNull();
        decision.SelectedDeployment.Should().BeNull();
    }

    [Fact]
    public void Select_CostExactlyAtCeiling_IsAffordable()
    {
        var decision = TierSelector.Select(0.90, 0.180m, Pricing());

        decision.Outcome.Should().Be(RoutingOutcome.Routed);
        decision.SelectedTier.Should().Be(ModelTier.Premium);
    }

    [Fact]
    public void Select_WhenPreferredTierUnavailable_FallsBackWithoutThrowing()
    {
        var decision = TierSelector.Select(0.95, 1.00m, Pricing(premiumAvailable: false));

        decision.Outcome.Should().Be(RoutingOutcome.Downgraded);
        decision.SelectedTier.Should().Be(ModelTier.Standard);
    }

    [Fact]
    public void Select_WhenNoTierIsAvailable_DeniesRatherThanCallingDirectly()
    {
        var none = new List<TierPricing>
        {
            new() { Tier = ModelTier.Economy, Deployment = "economy-dep", CostPerRequestUsd = 0.004m, Available = false },
        };

        var decision = TierSelector.Select(0.10, 1.00m, none);

        decision.Outcome.Should().Be(RoutingOutcome.Denied);
        decision.Rationale.Should().Contain("does not fall back");
    }

    [Fact]
    public void Select_AlwaysProducesARationaleNamingTheDecidingFactor()
    {
        foreach (var (score, ceiling) in new[] { (0.10, 1.00m), (0.50, 1.00m), (0.90, 0.05m), (0.90, 0.001m) })
        {
            var decision = TierSelector.Select(score, ceiling, Pricing());

            decision.Rationale.Should().NotBeNullOrWhiteSpace();
            decision.Rationale.Should().MatchRegex("(?i)(complexity|ceiling|available)");
        }
    }

    [Fact]
    public void Select_ReportsEveryCandidateWithAReasonForNonSelection()
    {
        var decision = TierSelector.Select(0.50, 0.25m, Pricing());

        decision.CandidateTiers.Should().HaveCount(3);
        decision.CandidateTiers.Where(c => !c.Selected)
            .Should().OnlyContain(c => !string.IsNullOrWhiteSpace(c.RejectedReason));
    }

    [Fact]
    public void Select_WithNoPricing_Throws()
    {
        var act = () => TierSelector.Select(0.5, 1.0m, []);

        act.Should().Throw<ArgumentException>();
    }
}
