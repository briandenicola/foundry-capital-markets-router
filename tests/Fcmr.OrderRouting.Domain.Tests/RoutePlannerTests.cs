using FluentAssertions;
using Fcmr.OrderRouting.Domain;
using Xunit;

namespace Fcmr.OrderRouting.Domain.Tests;

public class RoutePlannerTests
{
    private const string Proposer = "agent-orderrouting";

    [Fact]
    public void Selects_the_lowest_projected_cost_among_eligible_venues()
    {
        var outcome = RoutePlanner.Plan(
            Fixtures.Order(limit: 200m),
            [
                Fixtures.Quote("XLIT", spread: 0.10m),
                Fixtures.Quote("XMER", spread: 0.02m),
                Fixtures.Quote("XNOR", spread: 0.06m),
            ],
            BestExecutionPolicy.Default,
            Proposer);

        outcome.Status.Should().Be(RoutingStatus.Proposed);
        outcome.Proposal!.VenueCode.Should().Be("XMER");
    }

    [Fact]
    public void Breaks_ties_by_venue_code_so_two_runs_cannot_disagree()
    {
        // Identical quotes: only the deterministic tie-break separates them.
        var quotes = new[]
        {
            Fixtures.Quote("XPAC"),
            Fixtures.Quote("XLIT"),
            Fixtures.Quote("XMER"),
        };

        var first = RoutePlanner.Plan(Fixtures.Order(limit: 200m), quotes, BestExecutionPolicy.Default, Proposer);
        var second = RoutePlanner.Plan(Fixtures.Order(limit: 200m), quotes.Reverse().ToArray(), BestExecutionPolicy.Default, Proposer);

        first.Proposal!.VenueCode.Should().Be("XLIT");
        second.Proposal!.VenueCode.Should().Be("XLIT",
            "input order must not affect the outcome, or the ranking is not reproducible");
    }

    [Fact]
    public void Halts_naming_the_order_level_policy_without_listing_every_venue()
    {
        var outcome = RoutePlanner.Plan(
            Fixtures.Order(quantity: 500_000, limit: 100m),
            [Fixtures.Quote("XLIT"), Fixtures.Quote("XMER")],
            BestExecutionPolicy.Default,
            Proposer);

        outcome.Status.Should().Be(RoutingStatus.Halted);
        outcome.Proposal.Should().BeNull();
        outcome.Breaches.Should().ContainSingle()
            .Which.Boundary.Should().Be(PolicyBoundary.NotionalCeilingExceeded);
        outcome.HaltSummary.Should().Be("Halted on NotionalCeilingExceeded.");
    }

    [Fact]
    public void Halts_naming_every_venue_policy_when_no_venue_is_routable()
    {
        var outcome = RoutePlanner.Plan(
            Fixtures.Order(quantity: 500, limit: 200m),
            [
                Fixtures.Quote("DARK-1", type: VenueType.Dark),
                Fixtures.Quote("DARK-2", type: VenueType.Dark),
            ],
            BestExecutionPolicy.Default,
            Proposer);

        outcome.Status.Should().Be(RoutingStatus.Halted);
        outcome.Breaches.Select(b => b.Boundary).Should().Contain(PolicyBoundary.DarkPoolMinimumSize);
        outcome.Breaches.Select(b => b.Boundary).Should().Contain(PolicyBoundary.VenueNotApproved);
        outcome.HaltSummary.Should().Be("Halted on DarkPoolMinimumSize, VenueNotApproved.");
    }

    [Fact]
    public void A_halt_never_says_merely_blocked_by_policy()
    {
        var outcome = RoutePlanner.Plan(
            Fixtures.Order(quantity: 500_000, limit: 100m),
            [Fixtures.Quote("XLIT")],
            BestExecutionPolicy.Default,
            Proposer);

        // AC-7: the breached policy is named explicitly. The audience asks "which one" immediately.
        outcome.HaltSummary.Should().NotBe("Halted.");
        outcome.Breaches.Should().OnlyContain(b => !string.IsNullOrWhiteSpace(b.Explanation));
        outcome.Breaches.Should().OnlyContain(b => b.Explanation.Contains(b.Boundary.ToString()));
    }

    [Fact]
    public void Every_venue_is_reported_including_the_ones_that_lost()
    {
        var outcome = RoutePlanner.Plan(
            Fixtures.Order(limit: 200m),
            [Fixtures.Quote("XLIT"), Fixtures.Quote("XMER", spread: 0.02m), Fixtures.Quote("DARK-2")],
            BestExecutionPolicy.Default,
            Proposer);

        outcome.Considered.Should().HaveCount(3);
        outcome.Proposal!.Considered.Should().HaveCount(3,
            "the justification is only meaningful next to what was rejected");
    }

    [Fact]
    public void Justification_names_the_cost_components_the_runner_up_and_the_exclusions()
    {
        var outcome = RoutePlanner.Plan(
            Fixtures.Order(limit: 200m),
            [
                Fixtures.Quote("XLIT", spread: 0.02m),
                Fixtures.Quote("XMER", spread: 0.06m),
                Fixtures.Quote("DARK-2"),
            ],
            BestExecutionPolicy.Default,
            Proposer);

        var justification = outcome.Proposal!.BestExecutionJustification;

        justification.Should().Contain("XLIT selected on lowest projected total cost");
        justification.Should().Contain("spread");
        justification.Should().Contain("impact");
        justification.Should().Contain("fee");
        justification.Should().Contain("Next best XMER");
        justification.Should().Contain("Excluded: DARK-2 (VenueNotApproved)");
    }

    [Fact]
    public void Proposal_carries_everything_AC7_requires()
    {
        var outcome = RoutePlanner.Plan(
            Fixtures.Order(limit: 200m), [Fixtures.Quote()], BestExecutionPolicy.Default, Proposer);

        var proposal = outcome.Proposal!;
        proposal.VenueCode.Should().NotBeNullOrWhiteSpace();
        proposal.Cost.ProjectedCostUsd.Should().NotBe(0m);
        proposal.LiquidityRationale.Should().NotBeNullOrWhiteSpace();
        proposal.BestExecutionJustification.Should().NotBeNullOrWhiteSpace();
        proposal.CorrelationId.Should().Be("corr-1");
        proposal.ProposedBy.Should().Be(Proposer);
    }

    [Fact]
    public void Changing_the_policy_changes_the_outcome_with_no_code_change()
    {
        // The order-routing echo of the router's policy demonstration (Beat 5).
        var order = Fixtures.Order(quantity: 12_000, limit: 200m);
        var quotes = new[] { Fixtures.Quote("DARK-1", type: VenueType.Dark, liquidity: 200_000) };

        var permissive = RoutePlanner.Plan(order, quotes, BestExecutionPolicy.Default, Proposer);
        var restrictive = RoutePlanner.Plan(
            order,
            quotes,
            BestExecutionPolicy.Default with
            {
                ApprovedVenues = new HashSet<string>(StringComparer.Ordinal) { "XLIT" },
            },
            Proposer);

        permissive.Status.Should().Be(RoutingStatus.Proposed);
        restrictive.Status.Should().Be(RoutingStatus.Halted);
        restrictive.HaltSummary.Should().Contain("VenueNotApproved");
    }

    [Fact]
    public void Refuses_to_plan_without_a_proposing_identity()
    {
        var act = () => RoutePlanner.Plan(
            Fixtures.Order(), [Fixtures.Quote()], BestExecutionPolicy.Default, "  ");

        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Halted_outcome_has_an_empty_summary_when_proposed()
    {
        var outcome = RoutePlanner.Plan(
            Fixtures.Order(limit: 200m), [Fixtures.Quote()], BestExecutionPolicy.Default, Proposer);

        outcome.HaltSummary.Should().BeEmpty();
    }
}
