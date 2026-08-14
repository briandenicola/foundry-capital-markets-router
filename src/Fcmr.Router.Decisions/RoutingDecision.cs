namespace Fcmr.Router.Decisions;

public sealed record TierCandidate
{
    public required ModelTier Tier { get; init; }
    public required string Deployment { get; init; }
    public required decimal ProjectedCostUsd { get; init; }
    public bool Selected { get; init; }
    public string? RejectedReason { get; init; }
}

public sealed record RoutingDecision
{
    public required double ComplexityScore { get; init; }
    public required decimal CostCeilingUsd { get; init; }
    public required RoutingOutcome Outcome { get; init; }
    public ModelTier? SelectedTier { get; init; }
    public string? SelectedDeployment { get; init; }
    public required IReadOnlyList<TierCandidate> CandidateTiers { get; init; }

    /// <summary>
    /// Human-readable and shown in the UI at demo time. Must name the deciding factor —
    /// a rationale that does not explain the decision is worse than none, because it
    /// implies an explanation exists when it does not.
    /// </summary>
    public required string Rationale { get; init; }
}
