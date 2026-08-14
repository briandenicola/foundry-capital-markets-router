namespace Fcmr.Router.Decisions;

/// <summary>
/// Everything the exchange needs to plan a request.
///
/// Note what is absent: there is no model, vendor, deployment, or tier field, and there will not
/// be one. Principle IV is enforced by this type's shape, because a field that exists is a field
/// that eventually gets used.
/// </summary>
public sealed record RoutingRequest
{
    public required ComplexityHints Hints { get; init; }

    /// <summary>Per-request cost ceiling. The policy ceiling still applies on top of it.</summary>
    public required decimal CostCeilingUsd { get; init; }

    /// <summary>
    /// What the data <em>is</em>, stated by the caller. Required, never defaulted.
    ///
    /// Defaulting an omitted classification to Public is how restricted data reaches a vendor that
    /// should not see it, so the contract makes omission a 400 rather than an assumption.
    /// </summary>
    public required DataClassification DataClassification { get; init; }

    /// <summary>Region execution would occur in, when the policy set constrains regions.</summary>
    public string? ExecutionRegion { get; init; }
}

/// <summary>
/// The single entry point for routing, and the one place the evaluation order is decided.
///
/// <code>
/// catalog -&gt; PolicyGate.Evaluate() -&gt; eligible -&gt; TierSelector.Select() -&gt; decision
/// </code>
///
/// Governance runs first and unconditionally. Cost and complexity then choose among what
/// governance permitted, and never see the models it removed. Reversing the two would let a cost
/// optimisation reach a model governance has not approved — the precise failure the exchange
/// exists to prevent — so the order is asserted by test rather than left to code reading.
///
/// Callers route through here. Calling TierSelector directly bypasses the gate.
/// </summary>
public static class RoutingPlanner
{
    public static RoutingDecision Plan(
        RoutingRequest request,
        IReadOnlyList<TierPricing> catalog,
        PolicySet policy)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(policy);

        if (catalog.Count == 0)
        {
            throw new ArgumentException("At least one catalog entry must be supplied.", nameof(catalog));
        }

        var score = ComplexityScorer.Score(request.Hints);

        // Stage 1 — governance. Always first.
        var evaluation = PolicyGate.Evaluate(
            catalog, policy, request.DataClassification, request.ExecutionRegion);

        if (evaluation.NoEligibleModels)
        {
            return Refused(score, request, evaluation, catalog);
        }

        // Stage 2 — economics, over the permitted subset only. The excluded models are not in
        // scope here, which is what makes the ordering structural rather than conventional.
        var effectiveCeiling = Math.Min(request.CostCeilingUsd, policy.MaxCostPerRequestUsd);
        var decision = TierSelector.Select(score, effectiveCeiling, evaluation.Eligible);

        return decision with
        {
            PolicySetId = evaluation.PolicySetId,
            PolicySetVersion = evaluation.PolicySetVersion,
            DataClassification = request.DataClassification,
            PolicyExclusions = evaluation.Excluded,
        };
    }

    private static RoutingDecision Refused(
        double score,
        RoutingRequest request,
        PolicyEvaluation evaluation,
        IReadOnlyList<TierPricing> catalog)
    {
        // Name the vendors rather than the count. "Refused by policy" is not an answer a
        // governance audience accepts, and the presenter reads this sentence aloud.
        var vendors = evaluation.Excluded
            .Select(e => e.Vendor)
            .Distinct()
            .OrderBy(v => v.ToString(), StringComparer.Ordinal)
            .ToList();

        // A refusal where every exclusion was a price decision is a cost outcome wearing a
        // governance label. Saying so keeps "too expensive" and "not permitted" apart even when
        // both arrive as RefusedByPolicy, which is the distinction the contract exists to protect.
        var allCostDriven = evaluation.Excluded.Count > 0 &&
                            evaluation.Excluded.All(e => e.Kind == PolicyExclusionKind.PolicyCostCeiling);

        var cause = allCostDriven
            ? "every candidate exceeded the policy cost ceiling, so this is a cost outcome rather than a governance one"
            : $"they were excluded on governance grounds for {request.DataClassification} data";

        var rationale =
            $"Policy set '{evaluation.PolicySetId}' version {evaluation.PolicySetVersion} left no eligible " +
            $"model. All {evaluation.Excluded.Count} candidate(s) across {vendors.Count} vendor(s) " +
            $"({string.Join(", ", vendors)}) were ruled out: {cause}. " +
            "The request was refused, not downgraded.";

        return new RoutingDecision
        {
            ComplexityScore = score,
            CostCeilingUsd = request.CostCeilingUsd,
            Outcome = RoutingOutcome.RefusedByPolicy,
            SelectedTier = null,
            SelectedDeployment = null,
            SelectedVendor = null,
            CandidateTiers = catalog
                .OrderBy(p => p.Tier)
                .ThenBy(p => p.CostPerRequestUsd)
                .ThenBy(p => p.Deployment, StringComparer.Ordinal)
                .Select(p => new TierCandidate
                {
                    Tier = p.Tier,
                    Deployment = p.Deployment,
                    ProjectedCostUsd = p.CostPerRequestUsd,
                    Vendor = p.Vendor,
                    Selected = false,
                    RejectedReason = evaluation.Excluded
                        .FirstOrDefault(e => string.Equals(e.Deployment, p.Deployment, StringComparison.Ordinal))
                        ?.Reason ?? "Excluded by governance policy.",
                })
                .ToList(),
            Rationale = rationale,
            PolicySetId = evaluation.PolicySetId,
            PolicySetVersion = evaluation.PolicySetVersion,
            DataClassification = request.DataClassification,
            PolicyExclusions = evaluation.Excluded,
        };
    }
}
