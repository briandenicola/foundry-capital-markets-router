namespace Fcmr.OrderRouting.Domain;

/// <summary>
/// The named best-execution boundaries.
///
/// This enum exists so a halt can say *which* policy stopped it. AC-7 requires the breached policy
/// to be named explicitly: "blocked by policy" is not an answer a trading audience accepts, and the
/// follow-up question arrives within about two seconds. Naming it in the type system means the
/// answer cannot be omitted by whoever writes the UI.
/// </summary>
public enum PolicyBoundary
{
    /// <summary>Venue is not on the approved list for this desk.</summary>
    VenueNotApproved,

    /// <summary>A dark venue was selected for an order below the block-size floor.</summary>
    DarkPoolMinimumSize,

    /// <summary>The order would consume more of the displayed liquidity than permitted.</summary>
    ParticipationRateExceeded,

    /// <summary>The quoted spread is wider than the desk tolerates.</summary>
    SpreadToleranceExceeded,

    /// <summary>Projected execution price is through the trader's limit.</summary>
    LimitPriceBreached,

    /// <summary>Order notional exceeds the desk's ceiling. Evaluated once, not per venue.</summary>
    NotionalCeilingExceeded,
}

/// <summary>
/// One breach: which boundary, what the limit was, what the order or venue actually presented.
///
/// The observed and permitted values are carried separately from the prose so the UI can render a
/// comparison rather than a sentence, and so the audit record stays machine-readable.
/// </summary>
public sealed record PolicyBreach
{
    public required PolicyBoundary Boundary { get; init; }

    /// <summary>Venue this breach applies to, or null for an order-level breach.</summary>
    public string? VenueCode { get; init; }

    /// <summary>The value the policy permits, formatted for display.</summary>
    public required string Permitted { get; init; }

    /// <summary>The value actually presented, formatted for display.</summary>
    public required string Observed { get; init; }

    /// <summary>The named-policy sentence. Always names the boundary.</summary>
    public string Explanation => VenueCode is null
        ? $"{Boundary}: permitted {Permitted}, order presents {Observed}."
        : $"{Boundary} at {VenueCode}: permitted {Permitted}, venue presents {Observed}.";
}

/// <summary>
/// The desk's best-execution policy.
///
/// Every value here is a governance setting rather than an application setting. The distinction
/// matters: the demo changes one of these on stage and the routing outcome changes with no code
/// change, which is the order-routing echo of the policy demonstration the router makes.
/// </summary>
public sealed record BestExecutionPolicy
{
    /// <summary>Venues this desk may route to. A venue absent here is refused.</summary>
    public required IReadOnlySet<string> ApprovedVenues { get; init; }

    /// <summary>
    /// Largest share of a venue's displayed liquidity a single order may take, as a fraction.
    /// </summary>
    public decimal MaxParticipationRate { get; init; } = 0.20m;

    /// <summary>Widest spread the desk will cross, in basis points of the mid.</summary>
    public decimal MaxSpreadBps { get; init; } = 25m;

    /// <summary>Minimum order size for a dark venue. Below this, dark routing is refused.</summary>
    public int DarkPoolMinimumQuantity { get; init; } = 10_000;

    /// <summary>Largest order notional this desk may route at all.</summary>
    public decimal MaxNotionalUsd { get; init; } = 25_000_000m;

    /// <summary>
    /// Linear market-impact coefficient in basis points at 100% participation.
    ///
    /// A crude model, and deliberately so. It is deterministic, it is explainable in one sentence
    /// on stage, and it is not pretending to be a calibrated impact model. A sophisticated model
    /// nobody can explain would be worse here, because the point being demonstrated is that the
    /// number is arrived at by rule rather than by judgement.
    /// </summary>
    public decimal ImpactCoefficientBps { get; init; } = 50m;

    public static BestExecutionPolicy Default { get; } = new()
    {
        ApprovedVenues = new HashSet<string>(StringComparer.Ordinal)
        {
            "XLIT", "XMER", "XNOR", "XPAC", "DARK-1",
        },
    };
}
