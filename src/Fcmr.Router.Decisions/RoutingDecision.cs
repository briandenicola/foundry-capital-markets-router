namespace Fcmr.Router.Decisions;

public sealed record TierCandidate
{
    public required ModelTier Tier { get; init; }
    public required string Deployment { get; init; }
    public required decimal ProjectedCostUsd { get; init; }

    /// <summary>
    /// Which vendor supplies this candidate. Present so the decision detail view can show that
    /// several vendors competed for the same request without a second lookup.
    /// </summary>
    public ModelVendor Vendor { get; init; } = ModelVendor.AzureOpenAI;

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

    // ---- Governance, added by Feature 002 Slice A ----

    /// <summary>Which policy set governed this decision.</summary>
    public string? PolicySetId { get; init; }

    /// <summary>
    /// Pinned at decision time. Without it, replaying an audit record after a policy edit would
    /// show a decision that appears to violate the policy in force, which is exactly the finding
    /// an auditor escalates.
    /// </summary>
    public int? PolicySetVersion { get; init; }

    /// <summary>Sensitivity the caller declared for this request. Never inferred, never defaulted.</summary>
    public DataClassification? DataClassification { get; init; }

    /// <summary>Vendor of the selected model. Null on any non-routed outcome.</summary>
    public ModelVendor? SelectedVendor { get; init; }

    /// <summary>
    /// Every candidate governance removed, each with a reason.
    ///
    /// Persisted rather than merely computed for the response: "why was this model not used?"
    /// is asked long after the request completes.
    /// </summary>
    public IReadOnlyList<PolicyExclusion> PolicyExclusions { get; init; } = [];
}
