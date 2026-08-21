using System.Globalization;

namespace Fcmr.OrderRouting.Domain;

public enum RoutingStatus
{
    /// <summary>A venue was selected. The proposal still requires human approval to execute.</summary>
    Proposed,

    /// <summary>No venue was routable. <see cref="RoutingOutcome.Breaches"/> names why.</summary>
    Halted,
}

/// <summary>
/// A route awaiting approval. Carries everything AC-7 requires a proposal to state: venue,
/// projected cost, liquidity rationale, and best-execution justification.
///
/// This is a proposal and never an execution. Nothing in this type can cause a fill; the only path
/// to one is <see cref="SimulatedOms"/>, which demands an approval it did not issue itself.
/// </summary>
public sealed record RouteProposal
{
    public required string ProposalId { get; init; }

    public required string CorrelationId { get; init; }

    public required string OrderId { get; init; }

    /// <summary>Order quantity, carried so the OMS need not re-derive it from the order.</summary>
    public required int Quantity { get; init; }

    /// <summary>The winning venue.</summary>
    public required string VenueCode { get; init; }

    public required CostBreakdown Cost { get; init; }

    public required string LiquidityRationale { get; init; }

    /// <summary>Why this venue, stated against the alternatives rather than in isolation.</summary>
    public required string BestExecutionJustification { get; init; }

    /// <summary>
    /// Identity that produced the proposal. Recorded so the approver can be checked against it:
    /// the identity that proposes may not be the identity that approves.
    /// </summary>
    public required string ProposedBy { get; init; }

    /// <summary>Every venue considered, winners and losers, with breaches.</summary>
    public required IReadOnlyList<VenueEvaluation> Considered { get; init; }
}

/// <summary>The result of planning a route: a proposal, or a halt naming the policies that stopped it.</summary>
public sealed record RoutingOutcome
{
    public required RoutingStatus Status { get; init; }

    /// <summary>Set when <see cref="Status"/> is <see cref="RoutingStatus.Proposed"/>.</summary>
    public RouteProposal? Proposal { get; init; }

    /// <summary>
    /// Every breach that contributed to a halt, order-level first. Empty when proposed.
    /// </summary>
    public IReadOnlyList<PolicyBreach> Breaches { get; init; } = [];

    /// <summary>Every venue considered, in deterministic order.</summary>
    public required IReadOnlyList<VenueEvaluation> Considered { get; init; }

    /// <summary>
    /// The halt sentence, naming each distinct boundary. AC-7 requires the breached policy to be
    /// named explicitly, so the summary is built from the boundary names rather than free text.
    /// </summary>
    public string HaltSummary => Status == RoutingStatus.Proposed
        ? string.Empty
        : $"Halted on {string.Join(", ", Breaches.Select(b => b.Boundary.ToString()).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal))}.";
}

/// <summary>
/// Selects a venue, or halts.
///
/// Selection is by rule and the rule is stated: lowest projected total cost in basis points, ties
/// broken by venue code so that two runs of the same rehearsal cannot disagree. Reproducibility is
/// not a nicety here — a demo that ranks differently on the second run invites the conclusion that
/// the ranking is arbitrary, which is precisely the accusation this architecture exists to answer.
/// </summary>
public static class RoutePlanner
{
    public static RoutingOutcome Plan(
        OrderIntent order,
        IEnumerable<VenueQuote> quotes,
        BestExecutionPolicy policy,
        string proposedBy,
        string? proposalId = null)
    {
        ArgumentNullException.ThrowIfNull(order);
        ArgumentNullException.ThrowIfNull(quotes);
        ArgumentNullException.ThrowIfNull(policy);
        ArgumentException.ThrowIfNullOrWhiteSpace(proposedBy);

        var evaluations = quotes
            .Select(q => BestExecutionEvaluator.EvaluateVenue(order, q, policy))
            .OrderBy(e => e.Cost.TotalCostBps)
            .ThenBy(e => e.Quote.VenueCode, StringComparer.Ordinal)
            .ToArray();

        var orderBreaches = BestExecutionEvaluator.EvaluateOrder(order, policy);

        // An order-level breach halts regardless of venue. Reporting it alone keeps the cause
        // legible: appending six identical venue breaches underneath would obscure it.
        if (orderBreaches.Count > 0)
        {
            return new RoutingOutcome
            {
                Status = RoutingStatus.Halted,
                Breaches = orderBreaches,
                Considered = evaluations,
            };
        }

        var eligible = evaluations.Where(e => e.IsEligible).ToArray();

        if (eligible.Length == 0)
        {
            return new RoutingOutcome
            {
                Status = RoutingStatus.Halted,
                Breaches = [.. evaluations.SelectMany(e => e.Breaches)],
                Considered = evaluations,
            };
        }

        var winner = eligible[0];

        return new RoutingOutcome
        {
            Status = RoutingStatus.Proposed,
            Considered = evaluations,
            Proposal = new RouteProposal
            {
                ProposalId = proposalId ?? $"prop-{order.OrderId}",
                CorrelationId = order.CorrelationId,
                OrderId = order.OrderId,
                Quantity = order.Quantity,
                VenueCode = winner.Quote.VenueCode,
                Cost = winner.Cost,
                LiquidityRationale = winner.LiquidityRationale,
                BestExecutionJustification = Justify(winner, eligible, evaluations),
                ProposedBy = proposedBy,
                Considered = evaluations,
            },
        };
    }

    private static string Justify(
        VenueEvaluation winner,
        VenueEvaluation[] eligible,
        VenueEvaluation[] all)
    {
        var parts = new List<string>
        {
            string.Create(CultureInfo.InvariantCulture,
            $"{winner.Quote.VenueCode} selected on lowest projected total cost " +
            $"({winner.Cost.TotalCostBps} bps = {winner.Cost.SpreadCostBps} spread + " +
            $"{winner.Cost.ImpactBps} impact + {winner.Cost.FeeBps} fee) " +
            $"among {eligible.Length} eligible venue{(eligible.Length == 1 ? string.Empty : "s")}."),
        };

        if (eligible.Length > 1)
        {
            var runnerUp = eligible[1];
            parts.Add(string.Create(CultureInfo.InvariantCulture,
                $"Next best {runnerUp.Quote.VenueCode} at {runnerUp.Cost.TotalCostBps} bps."));
        }

        var rejected = all.Where(e => !e.IsEligible).ToArray();
        if (rejected.Length > 0)
        {
            var named = rejected.Select(e =>
                $"{e.Quote.VenueCode} ({string.Join("/", e.Breaches.Select(b => b.Boundary))})");
            parts.Add($"Excluded: {string.Join("; ", named)}.");
        }

        return string.Join(" ", parts);
    }
}
