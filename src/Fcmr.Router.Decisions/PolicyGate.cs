namespace Fcmr.Router.Decisions;

/// <summary>
/// A governance policy set, owned by the business unit rather than by the application.
///
/// This is the object the demo mutates on stage: disabling a vendor here causes the exact same
/// request, from an unchanged application, to produce a different execution plan.
/// </summary>
public sealed record PolicySet
{
    public required string Name { get; init; }

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
}

/// <summary>Why a candidate was excluded, in language safe to show a governance audience.</summary>
public sealed record PolicyExclusion
{
    public required string Deployment { get; init; }
    public required ModelVendor Vendor { get; init; }
    public required string Reason { get; init; }
}

public sealed record PolicyEvaluation
{
    public required IReadOnlyList<TierPricing> Eligible { get; init; }
    public required IReadOnlyList<PolicyExclusion> Excluded { get; init; }
    public required string PolicySetName { get; init; }

    /// <summary>True when policy left nothing to route to. The request is refused, not downgraded.</summary>
    public bool NoEligibleModels => Eligible.Count == 0;
}

/// <summary>
/// Filters the model catalog by governance policy, before cost and complexity selection runs.
///
/// Order matters and is deliberate: policy decides what is <em>permissible</em>, then the router
/// decides what is <em>appropriate</em> among the permissible. Running these the other way round
/// would let a cost optimisation reach for a model governance has not approved, which is exactly
/// the failure mode the exchange exists to prevent.
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
                    Reason = $"Execution region '{executionRegion}' is not permitted by policy set '{policy.Name}'.",
                });
            }

            return new PolicyEvaluation
            {
                Eligible = eligible,
                Excluded = excluded,
                PolicySetName = policy.Name,
            };
        }

        foreach (var candidate in catalog)
        {
            if (!policy.ApprovedVendors.Contains(candidate.Vendor))
            {
                excluded.Add(new PolicyExclusion
                {
                    Deployment = candidate.Deployment,
                    Vendor = candidate.Vendor,
                    Reason = $"Vendor {candidate.Vendor} is not approved under policy set '{policy.Name}'.",
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
                    Reason = $"Projected {candidate.CostPerRequestUsd:0.###} USD exceeds the policy ceiling of {policy.MaxCostPerRequestUsd:0.###} USD.",
                });
                continue;
            }

            eligible.Add(candidate);
        }

        return new PolicyEvaluation
        {
            Eligible = eligible,
            Excluded = excluded,
            PolicySetName = policy.Name,
        };
    }
}
