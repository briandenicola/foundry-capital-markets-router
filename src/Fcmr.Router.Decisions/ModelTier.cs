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

    /// <summary>
    /// Not routed. Governance policy left no eligible model.
    ///
    /// Deliberately distinct from <see cref="Denied"/>. "Too expensive" and "not permitted" are
    /// different conversations with different people, and collapsing them would lose that.
    ///
    /// This is a successful, governed outcome carried on a 200 response, never an error status.
    /// Modelling it as a failure would invite retry-on-error logic, and the one thing that must
    /// never happen is a retry that finds an unapproved model.
    /// </summary>
    RefusedByPolicy,
}
