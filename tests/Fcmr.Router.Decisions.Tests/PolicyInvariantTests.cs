using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

/// <summary>
/// T-218 and T-219. The invariant the whole feature rests on:
///
///   <c>a selected vendor is always approved, and always permitted to see the request's data.</c>
///
/// The task called for a property test. The policy domain is finite and small — four vendors, so
/// sixteen approval subsets, four classifications each, and four-to-the-fourth classification maps
/// — so this enumerates the domain in full instead. Exhaustive enumeration is strictly stronger
/// than sampled property testing here: it cannot miss a case, it needs no generator library, and
/// it reproduces identically on every run, which matters for a repository with a hard determinism
/// principle.
/// </summary>
public class PolicyInvariantTests
{
    private static readonly ModelVendor[] AllVendors =
    [
        ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI, ModelVendor.OpenWeight,
    ];

    private static readonly DataClassification[] AllClassifications =
    [
        DataClassification.Public, DataClassification.Internal,
        DataClassification.Confidential, DataClassification.Restricted,
    ];

    /// <summary>Twelve deployments: every vendor competing at every tier.</summary>
    private static List<TierPricing> FullCatalog()
    {
        var catalog = new List<TierPricing>();
        var tierCost = new Dictionary<ModelTier, decimal>
        {
            [ModelTier.Economy] = 0.002m,
            [ModelTier.Standard] = 0.030m,
            [ModelTier.Premium] = 0.090m,
        };

        foreach (var vendor in AllVendors)
        {
            foreach (var (tier, baseCost) in tierCost)
            {
                catalog.Add(new TierPricing
                {
                    Tier = tier,
                    Deployment = $"{vendor}-{tier}".ToLowerInvariant(),
                    // Spread costs within a tier so cheapest-within-tier is a real choice.
                    CostPerRequestUsd = baseCost + (Array.IndexOf(AllVendors, vendor) * 0.001m),
                    Vendor = vendor,
                    Serving = vendor == ModelVendor.OpenWeight
                        ? ServingMode.ManagedCompute
                        : ServingMode.Serverless,
                });
            }
        }

        return catalog;
    }

    private static PolicySet Build(
        IReadOnlySet<ModelVendor> approved,
        IReadOnlyDictionary<ModelVendor, DataClassification> maxClass) => new()
        {
            Id = "CapitalMarkets-US",
            BusinessUnit = "CapitalMarkets",
            ApprovedVendors = approved,
            MaxClassification = maxClass,
            Version = 3,
        };

    [Fact]
    public void Plan_AcrossTheEntirePolicyDomain_NeverSelectsAnUnapprovedOrOverClearedVendor()
    {
        var catalog = FullCatalog();
        var failures = new List<string>();
        var cases = 0;
        var routed = 0;
        var refused = 0;

        // All 16 approval subsets.
        for (var mask = 0; mask < 1 << 4; mask++)
        {
            var approved = new HashSet<ModelVendor>();
            for (var bit = 0; bit < AllVendors.Length; bit++)
            {
                if ((mask & (1 << bit)) != 0)
                {
                    approved.Add(AllVendors[bit]);
                }
            }

            // All 256 assignments of a maximum classification to the four vendors.
            for (var assignment = 0; assignment < 256; assignment++)
            {
                var maxClass = new Dictionary<ModelVendor, DataClassification>();
                for (var bit = 0; bit < AllVendors.Length; bit++)
                {
                    var vendor = AllVendors[bit];
                    if (approved.Contains(vendor))
                    {
                        maxClass[vendor] = AllClassifications[(assignment >> (bit * 2)) & 0b11];
                    }
                }

                var policy = Build(approved, maxClass);

                foreach (var classification in AllClassifications)
                {
                    cases++;

                    var decision = RoutingPlanner.Plan(
                        new RoutingRequest
                        {
                            Hints = new ComplexityHints { InputTokenEstimate = 8_000 },
                            CostCeilingUsd = 10.00m,
                            DataClassification = classification,
                        },
                        catalog,
                        policy);

                    if (decision.SelectedVendor is null)
                    {
                        refused++;

                        // A non-selection must be an explicit governed outcome, never a quiet null.
                        if (decision.Outcome is not (RoutingOutcome.RefusedByPolicy or RoutingOutcome.Denied))
                        {
                            failures.Add(
                                $"mask={mask} assign={assignment} class={classification}: " +
                                $"no vendor selected but outcome was {decision.Outcome}.");
                        }

                        continue;
                    }

                    routed++;
                    var vendor = decision.SelectedVendor.Value;

                    if (!approved.Contains(vendor))
                    {
                        failures.Add(
                            $"mask={mask} assign={assignment} class={classification}: " +
                            $"selected unapproved vendor {vendor}.");
                    }
                    else if (!maxClass.TryGetValue(vendor, out var permitted) || classification > permitted)
                    {
                        failures.Add(
                            $"mask={mask} assign={assignment} class={classification}: " +
                            $"selected {vendor} cleared only to {(maxClass.TryGetValue(vendor, out var p) ? p.ToString() : "nothing")}.");
                    }
                }
            }
        }

        cases.Should().Be(16 * 256 * 4, "the enumeration must cover the whole domain");
        routed.Should().BeGreaterThan(0, "a test where nothing ever routes proves nothing");
        refused.Should().BeGreaterThan(0, "the empty policy set must genuinely refuse");
        failures.Should().BeEmpty();
    }

    [Fact]
    public void Plan_WhenPolicyLeavesNothingEligible_RefusesRatherThanDenies()
    {
        var policy = Build(new HashSet<ModelVendor>(), new Dictionary<ModelVendor, DataClassification>());

        var decision = RoutingPlanner.Plan(
            new RoutingRequest
            {
                Hints = new ComplexityHints { InputTokenEstimate = 1_000 },
                CostCeilingUsd = 10.00m,
                DataClassification = DataClassification.Internal,
            },
            FullCatalog(),
            policy);

        decision.Outcome.Should().Be(RoutingOutcome.RefusedByPolicy,
            "governance refusal and cost denial are different conversations with different people");
        decision.SelectedDeployment.Should().BeNull();
        decision.SelectedVendor.Should().BeNull();

        // T-219: every candidate is named, each with its own reason.
        decision.PolicyExclusions.Should().HaveCount(12);
        decision.PolicyExclusions.Should().OnlyContain(e => !string.IsNullOrWhiteSpace(e.Reason));
        decision.CandidateTiers.Should().OnlyContain(c => c.RejectedReason != null && !c.Selected);
    }

    [Fact]
    public void Plan_RemovingEachVendorInTurn_StillYieldsAValidPlan()
    {
        // T-219. Four vendors, remove one at a time, four valid plans. This is the claim the demo
        // makes out loud: any single vendor can be withdrawn and the exchange keeps working.
        foreach (var removed in AllVendors)
        {
            var approved = new HashSet<ModelVendor>(AllVendors.Where(v => v != removed));
            var maxClass = approved.ToDictionary(v => v, _ => DataClassification.Confidential);

            var decision = RoutingPlanner.Plan(
                new RoutingRequest
                {
                    Hints = new ComplexityHints { InputTokenEstimate = 8_000 },
                    CostCeilingUsd = 10.00m,
                    DataClassification = DataClassification.Internal,
                },
                FullCatalog(),
                Build(approved, maxClass));

            decision.Outcome.Should().BeOneOf(RoutingOutcome.Routed, RoutingOutcome.Downgraded);
            decision.SelectedVendor.Should().NotBe(removed,
                $"withdrawing {removed} must actually withdraw it");
            decision.PolicyExclusions.Should().Contain(e => e.Vendor == removed);
        }
    }

    [Fact]
    public void Plan_WhenOnlyRestrictedCapableVendorRemains_RoutesToManagedCompute()
    {
        var approved = new HashSet<ModelVendor>(AllVendors);
        var maxClass = new Dictionary<ModelVendor, DataClassification>
        {
            [ModelVendor.AzureOpenAI] = DataClassification.Confidential,
            [ModelVendor.Anthropic] = DataClassification.Internal,
            [ModelVendor.XAI] = DataClassification.Internal,
            [ModelVendor.OpenWeight] = DataClassification.Restricted,
        };

        var decision = RoutingPlanner.Plan(
            new RoutingRequest
            {
                Hints = new ComplexityHints { InputTokenEstimate = 20_000, RequiresMultiStep = true },
                CostCeilingUsd = 10.00m,
                DataClassification = DataClassification.Restricted,
            },
            FullCatalog(),
            Build(approved, maxClass));

        decision.SelectedVendor.Should().Be(ModelVendor.OpenWeight);
        decision.DataClassification.Should().Be(DataClassification.Restricted);
    }
}
