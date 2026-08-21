using System.Globalization;

namespace Fcmr.OrderRouting.Domain;

/// <summary>
/// The cost of routing one order to one venue, decomposed.
///
/// Decomposed rather than totalled because the justification has to survive being questioned. A
/// single number invites "where does that come from"; three components and a coefficient answer it
/// before it is asked.
/// </summary>
public sealed record CostBreakdown
{
    /// <summary>Share of the venue's displayed liquidity this order would take.</summary>
    public required decimal ParticipationRate { get; init; }

    /// <summary>Cost of crossing half the spread, in basis points of the mid.</summary>
    public required decimal SpreadCostBps { get; init; }

    /// <summary>Modelled market impact, in basis points. Linear in participation.</summary>
    public required decimal ImpactBps { get; init; }

    /// <summary>Venue fee in basis points. Negative for a rebate.</summary>
    public required decimal FeeBps { get; init; }

    /// <summary>Sum of the three components. May be negative where a rebate dominates.</summary>
    public decimal TotalCostBps => SpreadCostBps + ImpactBps + FeeBps;

    /// <summary>Expected execution price implied by <see cref="TotalCostBps"/>.</summary>
    public required decimal ProjectedPrice { get; init; }

    /// <summary>
    /// Expected implementation shortfall against the arrival mid, in currency. This is the
    /// "projected cost" AC-7 requires the proposal to carry.
    /// </summary>
    public required decimal ProjectedCostUsd { get; init; }
}

/// <summary>One venue assessed against the policy.</summary>
public sealed record VenueEvaluation
{
    public required VenueQuote Quote { get; init; }

    public required CostBreakdown Cost { get; init; }

    /// <summary>Venue-level breaches. Empty means this venue is routable.</summary>
    public required IReadOnlyList<PolicyBreach> Breaches { get; init; }

    public bool IsEligible => Breaches.Count == 0;

    /// <summary>The liquidity sentence AC-7 requires on the proposal.</summary>
    public string LiquidityRationale => string.Create(
        CultureInfo.InvariantCulture,
        $"{Quote.VenueCode} shows {Quote.DisplayedLiquidity:N0} shares at the touch; " +
        $"this order takes {Cost.ParticipationRate * 100m:N1}% of displayed liquidity " +
        $"at a {Quote.Spread:N4} spread.");
}

/// <summary>
/// Evaluates venues against the best-execution policy. Deterministic and total: the same inputs
/// always produce the same evaluation, and every venue is assessed whether or not it wins.
///
/// Assessing losers matters. The justification for the chosen venue is only meaningful next to
/// what it was chosen over, and a compliance reviewer asking "why not the cheaper one" needs the
/// rejected venue's breach on the record rather than reconstructed afterwards.
/// </summary>
public static class BestExecutionEvaluator
{
    /// <summary>
    /// Boundaries that depend only on the order, not on any venue. Evaluated once so that an order
    /// which cannot be routed anywhere halts naming the order-level policy, rather than emitting
    /// the same venue-level breach once per venue and burying the actual cause.
    /// </summary>
    public static IReadOnlyList<PolicyBreach> EvaluateOrder(OrderIntent order, BestExecutionPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(order);
        ArgumentNullException.ThrowIfNull(policy);

        var breaches = new List<PolicyBreach>();

        if (order.NotionalUsd > policy.MaxNotionalUsd)
        {
            breaches.Add(new PolicyBreach
            {
                Boundary = PolicyBoundary.NotionalCeilingExceeded,
                Permitted = policy.MaxNotionalUsd.ToString("C0", CultureInfo.InvariantCulture),
                Observed = order.NotionalUsd.ToString("C0", CultureInfo.InvariantCulture),
            });
        }

        return breaches;
    }

    /// <summary>Evaluates one venue for one order.</summary>
    public static VenueEvaluation EvaluateVenue(
        OrderIntent order,
        VenueQuote quote,
        BestExecutionPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(order);
        ArgumentNullException.ThrowIfNull(quote);
        ArgumentNullException.ThrowIfNull(policy);

        var cost = ComputeCost(order, quote, policy);
        var breaches = new List<PolicyBreach>();

        if (!policy.ApprovedVenues.Contains(quote.VenueCode))
        {
            breaches.Add(Breach(PolicyBoundary.VenueNotApproved, quote,
                permitted: string.Join(", ", policy.ApprovedVenues.Order(StringComparer.Ordinal)),
                observed: quote.VenueCode));
        }

        if (quote.IsDark && order.Quantity < policy.DarkPoolMinimumQuantity)
        {
            breaches.Add(Breach(PolicyBoundary.DarkPoolMinimumSize, quote,
                permitted: string.Create(CultureInfo.InvariantCulture, $"{policy.DarkPoolMinimumQuantity:N0} shares minimum"),
                observed: string.Create(CultureInfo.InvariantCulture, $"{order.Quantity:N0} shares")));
        }

        if (cost.ParticipationRate > policy.MaxParticipationRate)
        {
            breaches.Add(Breach(PolicyBoundary.ParticipationRateExceeded, quote,
                permitted: string.Create(CultureInfo.InvariantCulture, $"{policy.MaxParticipationRate * 100m:N1}%"),
                observed: string.Create(CultureInfo.InvariantCulture, $"{cost.ParticipationRate * 100m:N1}%")));
        }

        var spreadBps = quote.MidPrice == 0m ? 0m : Round(quote.Spread / quote.MidPrice * 10_000m);
        if (spreadBps > policy.MaxSpreadBps)
        {
            breaches.Add(Breach(PolicyBoundary.SpreadToleranceExceeded, quote,
                permitted: string.Create(CultureInfo.InvariantCulture, $"{policy.MaxSpreadBps} bps"),
                observed: string.Create(CultureInfo.InvariantCulture, $"{spreadBps} bps")));
        }

        var throughLimit = order.Side == OrderSide.Buy
            ? cost.ProjectedPrice > order.LimitPrice
            : cost.ProjectedPrice < order.LimitPrice;

        if (throughLimit)
        {
            breaches.Add(Breach(PolicyBoundary.LimitPriceBreached, quote,
                permitted: string.Create(CultureInfo.InvariantCulture, $"{(order.Side == OrderSide.Buy ? "at or below" : "at or above")} {order.LimitPrice:N4}"),
                observed: string.Create(CultureInfo.InvariantCulture, $"projected {cost.ProjectedPrice:N4}")));
        }

        return new VenueEvaluation { Quote = quote, Cost = cost, Breaches = breaches };
    }

    private static CostBreakdown ComputeCost(OrderIntent order, VenueQuote quote, BestExecutionPolicy policy)
    {
        var participation = quote.DisplayedLiquidity <= 0
            ? decimal.MaxValue / 1_000_000m
            : Round((decimal)order.Quantity / quote.DisplayedLiquidity, 6);

        var spreadCostBps = quote.MidPrice == 0m
            ? 0m
            : Round(quote.Spread / 2m / quote.MidPrice * 10_000m);

        // Dark venues execute at the midpoint, so there is no spread to cross. This is the reason
        // a dark venue can win on cost, and the reason the block-size floor exists to stop it
        // winning for orders that have no business being there.
        if (quote.IsDark)
        {
            spreadCostBps = 0m;
        }

        var impactBps = Round(policy.ImpactCoefficientBps * Math.Min(participation, 1m));
        var totalBps = spreadCostBps + impactBps + quote.FeeBps;

        var signed = order.Side == OrderSide.Buy ? 1m : -1m;
        var projectedPrice = Round(quote.MidPrice * (1m + signed * totalBps / 10_000m), 4);
        var projectedCostUsd = Round(totalBps / 10_000m * order.ArrivalMidPrice * order.Quantity, 2);

        return new CostBreakdown
        {
            ParticipationRate = participation,
            SpreadCostBps = spreadCostBps,
            ImpactBps = impactBps,
            FeeBps = quote.FeeBps,
            ProjectedPrice = projectedPrice,
            ProjectedCostUsd = projectedCostUsd,
        };
    }

    private static PolicyBreach Breach(PolicyBoundary boundary, VenueQuote quote, string permitted, string observed) =>
        new()
        {
            Boundary = boundary,
            VenueCode = quote.VenueCode,
            Permitted = permitted,
            Observed = observed,
        };

    // Fixed rounding everywhere, so two runs of the same rehearsal produce byte-identical numbers.
    private static decimal Round(decimal value, int places = 2) =>
        Math.Round(value, places, MidpointRounding.ToEven);
}
