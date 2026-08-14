namespace Fcmr.Router.Decisions;

/// <summary>
/// A governance policy set, owned by the business unit rather than by the application.
///
/// This is the object the demo mutates on stage: disabling a vendor here causes the exact same
/// request, from an unchanged application, to produce a different execution plan.
///
/// Field names track contracts/policy-api.md deliberately. A governance object whose domain shape
/// drifts from its published contract is one refactor away from an audit finding.
/// </summary>
public sealed record PolicySet
{
    /// <summary>Policy set identifier, for example CapitalMarkets-US.</summary>
    public required string Id { get; init; }

    /// <summary>Cosmos partition key. Governance is scoped per business unit.</summary>
    public required string BusinessUnit { get; init; }

    /// <summary>Shown in the policy screen.</summary>
    public string DisplayName { get; init; } = string.Empty;

    /// <summary>Vendors permitted for this policy set. A vendor absent here is blocked.</summary>
    public required IReadOnlySet<ModelVendor> ApprovedVendors { get; init; }

    /// <summary>
    /// The most sensitive data each vendor may process. A vendor may be approved in general and
    /// still be ineligible for a specific request.
    /// </summary>
    public required IReadOnlyDictionary<ModelVendor, DataClassification> MaxClassification { get; init; }

    /// <summary>Regions in which execution is permitted. Empty means unrestricted.</summary>
    public IReadOnlySet<string> AllowedRegions { get; init; } = new HashSet<string>();

    /// <summary>Hard ceiling for this policy set, applied before any per-request ceiling.</summary>
    public decimal MaxCostPerRequestUsd { get; init; } = decimal.MaxValue;

    /// <summary>
    /// Declares that this set is expected to serve Restricted data. When true, an edit that leaves
    /// no vendor able to process Restricted is rejected rather than accepted.
    ///
    /// Silently creating a policy set that refuses every restricted request is a configuration
    /// accident, and it would surface as a demo failure rather than as a validation error.
    /// </summary>
    public bool PermitsRestrictedData { get; init; }

    /// <summary>Incremented on every write. Pinned onto each decision at decision time.</summary>
    public int Version { get; init; } = 1;

    /// <summary>Entra object id of the approver who last changed this set.</summary>
    public string? UpdatedBy { get; init; }

    public DateTimeOffset? UpdatedAt { get; init; }
}

/// <summary>
/// The category of a policy exclusion.
///
/// Kept separate from the prose reason because a cost-driven exclusion is a different
/// conversation from a governance-driven one, and if every exclusion looks alike then a request
/// refused purely on price is indistinguishable from one refused on principle. That is exactly
/// the distinction contracts/router-api-policy-extension.md insists on preserving between
/// Denied and RefusedByPolicy, and it would be lost inside the gate without this.
/// </summary>
public enum PolicyExclusionKind
{
    VendorNotApproved,
    ClassificationExceeded,
    RegionNotPermitted,

    /// <summary>Excluded by the policy set's own cost ceiling, not by a governance rule.</summary>
    PolicyCostCeiling,
}

/// <summary>Why a candidate was excluded, in language safe to show a governance audience.</summary>
public sealed record PolicyExclusion
{
    public required string Deployment { get; init; }
    public required ModelVendor Vendor { get; init; }
    public required PolicyExclusionKind Kind { get; init; }
    public required string Reason { get; init; }
}

public sealed record PolicyEvaluation
{
    public required IReadOnlyList<TierPricing> Eligible { get; init; }
    public required IReadOnlyList<PolicyExclusion> Excluded { get; init; }
    public required string PolicySetId { get; init; }

    /// <summary>Version in force when this evaluation ran. Pinned onto the decision record.</summary>
    public required int PolicySetVersion { get; init; }

    /// <summary>True when policy left nothing to route to. The request is refused, not downgraded.</summary>
    public bool NoEligibleModels => Eligible.Count == 0;
}

/// <summary>
/// Filters the model catalog by governance policy, before cost and complexity selection runs.
///
/// Order matters and is deliberate: policy decides what is <em>permissible</em>, then the router
/// decides what is <em>appropriate</em> among the permissible. Running these the other way round
/// would let a cost optimisation reach for a model governance has not approved, which is exactly
/// the failure mode the exchange exists to prevent. See RoutingPlanner, which owns the order.
///
/// Every exclusion carries a reason. A governance audience will ask why a model was not used, and
/// "policy" on its own is not an answer they will accept.
/// </summary>
public static class PolicyGate
{
    public static PolicyEvaluation Evaluate(
        IReadOnlyList<TierPricing> catalog,
        PolicySet policy,
        DataClassification classification,
        string? executionRegion = null)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(policy);

        var eligible = new List<TierPricing>();
        var excluded = new List<PolicyExclusion>();

        if (policy.AllowedRegions.Count > 0 &&
            executionRegion is not null &&
            !policy.AllowedRegions.Contains(executionRegion))
        {
            foreach (var c in catalog)
            {
                excluded.Add(new PolicyExclusion
                {
                    Deployment = c.Deployment,
                    Vendor = c.Vendor,
                    Kind = PolicyExclusionKind.RegionNotPermitted,
                    Reason = $"Execution region '{executionRegion}' is not permitted by policy set '{policy.Id}'.",
                });
            }

            return Result(eligible, excluded, policy);
        }

        foreach (var candidate in catalog)
        {
            if (!policy.ApprovedVendors.Contains(candidate.Vendor))
            {
                excluded.Add(new PolicyExclusion
                {
                    Deployment = candidate.Deployment,
                    Vendor = candidate.Vendor,
                    Kind = PolicyExclusionKind.VendorNotApproved,
                    Reason = $"Vendor {candidate.Vendor} is not approved under policy set '{policy.Id}'.",
                });
                continue;
            }

            if (!policy.MaxClassification.TryGetValue(candidate.Vendor, out var permitted) ||
                classification > permitted)
            {
                excluded.Add(new PolicyExclusion
                {
                    Deployment = candidate.Deployment,
                    Vendor = candidate.Vendor,
                    Kind = PolicyExclusionKind.ClassificationExceeded,
                    Reason = $"Data classification {classification} exceeds the maximum permitted for vendor {candidate.Vendor}.",
                });
                continue;
            }

            if (candidate.CostPerRequestUsd > policy.MaxCostPerRequestUsd)
            {
                excluded.Add(new PolicyExclusion
                {
                    Deployment = candidate.Deployment,
                    Vendor = candidate.Vendor,
                    Kind = PolicyExclusionKind.PolicyCostCeiling,
                    Reason = $"Projected {candidate.CostPerRequestUsd:0.###} USD exceeds the policy ceiling of {policy.MaxCostPerRequestUsd:0.###} USD.",
                });
                continue;
            }

            eligible.Add(candidate);
        }

        return Result(eligible, excluded, policy);
    }

    private static PolicyEvaluation Result(
        IReadOnlyList<TierPricing> eligible,
        IReadOnlyList<PolicyExclusion> excluded,
        PolicySet policy) => new()
        {
            Eligible = eligible,
            Excluded = excluded,
            PolicySetId = policy.Id,
            PolicySetVersion = policy.Version,
        };
}
