namespace Fcmr.Router.Decisions;

/// <summary>Cost, vendor, and deployment name for one candidate model.</summary>
public sealed record TierPricing
{
    public required ModelTier Tier { get; init; }
    public required string Deployment { get; init; }
    public required decimal CostPerRequestUsd { get; init; }
    public bool Available { get; init; } = true;

    /// <summary>
    /// Which vendor supplies this model. The exchange's central claim is that vendors are
    /// interchangeable, so vendor identity belongs on the candidate rather than being implied
    /// by the deployment name.
    /// </summary>
    public ModelVendor Vendor { get; init; } = ModelVendor.AzureOpenAI;

    /// <summary>How the model is served. Managed compute is a preview capability.</summary>
    public ServingMode Serving { get; init; } = ServingMode.Serverless;
}

/// <summary>
/// Selects a model tier from a complexity score and an enforced cost ceiling.
///
/// The ceiling is a control, not a report. When the indicated tier exceeds it, the selector
/// downgrades to the most capable affordable tier, and denies only when nothing is affordable.
/// A denial is returned to the caller and surfaced in the UI; it is never silently absorbed.
/// </summary>
public static class TierSelector
{
    public static RoutingDecision Select(
        double complexityScore,
        decimal costCeilingUsd,
        IReadOnlyList<TierPricing> pricing)
    {
        ArgumentNullException.ThrowIfNull(pricing);

        if (pricing.Count == 0)
        {
            throw new ArgumentException("At least one tier must be supplied.", nameof(pricing));
        }

        var indicated = ComplexityScorer.IndicatedTier(complexityScore);
        var available = pricing.Where(p => p.Available).OrderBy(p => p.Tier).ToList();

        if (available.Count == 0)
        {
            return Denied(complexityScore, costCeilingUsd, pricing,
                "No model tier is currently available. The router does not fall back to an unrouted direct call.");
        }

        var affordable = available.Where(p => p.CostPerRequestUsd <= costCeilingUsd).ToList();

        if (affordable.Count == 0)
        {
            var cheapest = available.MinBy(p => p.CostPerRequestUsd)!;
            return Denied(complexityScore, costCeilingUsd, pricing,
                $"Cheapest available tier {cheapest.Tier} projects {cheapest.CostPerRequestUsd:0.###} USD " +
                $"against a ceiling of {costCeilingUsd:0.###} USD.");
        }

        // Prefer the indicated tier. If it is unaffordable or unavailable, take the most capable
        // tier that is both.
        var chosen = affordable.FirstOrDefault(p => p.Tier == indicated)
                     ?? affordable.MaxBy(p => p.Tier)!;

        var downgraded = chosen.Tier < indicated;

        var rationale = downgraded
            ? $"Complexity {complexityScore:0.##} indicated {indicated}, but its projected cost exceeds the " +
              $"{costCeilingUsd:0.###} USD ceiling. Downgraded to {chosen.Tier} at " +
              $"{chosen.CostPerRequestUsd:0.###} USD."
            : $"Complexity {complexityScore:0.##} indicated {chosen.Tier}, projected at " +
              $"{chosen.CostPerRequestUsd:0.###} USD within the {costCeilingUsd:0.###} USD ceiling.";

        return new RoutingDecision
        {
            ComplexityScore = complexityScore,
            CostCeilingUsd = costCeilingUsd,
            Outcome = downgraded ? RoutingOutcome.Downgraded : RoutingOutcome.Routed,
            SelectedTier = chosen.Tier,
            SelectedDeployment = chosen.Deployment,
            CandidateTiers = BuildCandidates(pricing, chosen, costCeilingUsd, indicated),
            Rationale = rationale,
        };
    }

    private static RoutingDecision Denied(
        double complexityScore,
        decimal ceiling,
        IReadOnlyList<TierPricing> pricing,
        string rationale) => new()
        {
            ComplexityScore = complexityScore,
            CostCeilingUsd = ceiling,
            Outcome = RoutingOutcome.Denied,
            SelectedTier = null,
            SelectedDeployment = null,
            CandidateTiers = BuildCandidates(pricing, null, ceiling, null),
            Rationale = rationale,
        };

    private static List<TierCandidate> BuildCandidates(
        IReadOnlyList<TierPricing> pricing,
        TierPricing? chosen,
        decimal ceiling,
        ModelTier? indicated)
    {
        var candidates = new List<TierCandidate>(pricing.Count);

        foreach (var p in pricing.OrderBy(p => p.Tier))
        {
            var selected = chosen is not null && p.Tier == chosen.Tier;

            string? reason = null;
            if (!selected)
            {
                if (!p.Available)
                {
                    reason = "Tier unavailable.";
                }
                else if (p.CostPerRequestUsd > ceiling)
                {
                    reason = $"Projected {p.CostPerRequestUsd:0.###} USD exceeds the {ceiling:0.###} USD ceiling.";
                }
                else if (indicated is not null && p.Tier > indicated)
                {
                    reason = "Above the tier indicated by task complexity; no measured quality gain for this task kind.";
                }
                else
                {
                    reason = "Below the tier indicated by task complexity.";
                }
            }

            candidates.Add(new TierCandidate
            {
                Tier = p.Tier,
                Deployment = p.Deployment,
                ProjectedCostUsd = p.CostPerRequestUsd,
                Selected = selected,
                RejectedReason = reason,
            });
        }

        return candidates;
    }
}
