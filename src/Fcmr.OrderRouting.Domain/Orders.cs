namespace Fcmr.OrderRouting.Domain;

public enum OrderSide
{
    Buy,
    Sell,
}

/// <summary>
/// An order awaiting a routing decision.
///
/// Deliberately not <c>Fcmr.Demo.Data.Order</c>. The fixture type describes what the generator
/// produces; this describes what routing needs. Binding the domain to the fixture would make the
/// synthetic corpus a load-bearing dependency of the policy engine, and the policy engine is the
/// part that has to stay true when the fixtures are replaced.
/// </summary>
public sealed record OrderIntent
{
    public required string OrderId { get; init; }

    /// <summary>Ties every downstream record to the originating request (Principle VI).</summary>
    public required string CorrelationId { get; init; }

    public required string Symbol { get; init; }

    public required OrderSide Side { get; init; }

    public required int Quantity { get; init; }

    /// <summary>
    /// The trader's limit. A projected execution price through this limit is a breach, not a
    /// rounding matter.
    /// </summary>
    public required decimal LimitPrice { get; init; }

    /// <summary>
    /// Reference price at the moment the order arrived. Cost is measured against this, so that
    /// "projected cost" means implementation shortfall rather than a number chosen to look small.
    /// </summary>
    public required decimal ArrivalMidPrice { get; init; }

    public string TraderId { get; init; } = string.Empty;

    /// <summary>Quantity times limit price. The figure notional boundaries are tested against.</summary>
    public decimal NotionalUsd => Quantity * LimitPrice;
}

public enum VenueType
{
    /// <summary>Displayed, quote-driven venue.</summary>
    Lit,

    /// <summary>Non-displayed venue. Restricted to block-size orders by policy.</summary>
    Dark,
}

/// <summary>
/// A venue's current state for one symbol, as the OMS reports it.
/// </summary>
public sealed record VenueQuote
{
    public required string VenueCode { get; init; }

    public required VenueType Type { get; init; }

    /// <summary>Midpoint. The cost baseline for this venue.</summary>
    public required decimal MidPrice { get; init; }

    /// <summary>Absolute bid-ask spread in price terms, not basis points.</summary>
    public required decimal Spread { get; init; }

    /// <summary>
    /// Shares available at the touch. Drives the participation-rate boundary, which is the
    /// boundary that catches an order large enough to move the market against itself.
    /// </summary>
    public required int DisplayedLiquidity { get; init; }

    /// <summary>
    /// Venue fee in basis points. Negative values are rebates, which is why this is signed and
    /// why the cost model adds it rather than taking its absolute value.
    /// </summary>
    public decimal FeeBps { get; init; }

    public bool IsDark => Type == VenueType.Dark;
}
