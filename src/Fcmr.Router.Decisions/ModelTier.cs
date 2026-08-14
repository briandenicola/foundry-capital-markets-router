namespace Fcmr.Router.Decisions;

/// <summary>Model capability and cost tiers. Ordered cheapest to most expensive.</summary>
public enum ModelTier
{
    Economy = 0,
    Standard = 1,
    Premium = 2,
}

/// <summary>What the router did with a request.</summary>
public enum RoutingOutcome
{
    /// <summary>Routed to the tier the complexity score indicated.</summary>
    Routed,

    /// <summary>Routed to a cheaper tier than indicated, because the ceiling required it.</summary>
    Downgraded,

    /// <summary>Not routed. Even the cheapest viable tier exceeded the ceiling.</summary>
    Denied,
}
