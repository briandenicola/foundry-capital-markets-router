using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

public class PolicyGateTests
{
    private static List<TierPricing> Catalog() =>
    [
        new()
        {
            Tier = ModelTier.Economy, Deployment = "mistral-small", CostPerRequestUsd = 0.002m,
            Vendor = ModelVendor.OpenWeight, Serving = ServingMode.ManagedCompute,
        },
        new()
        {
            Tier = ModelTier.Standard, Deployment = "gpt-5.4", CostPerRequestUsd = 0.031m,
            Vendor = ModelVendor.AzureOpenAI, Serving = ServingMode.Serverless,
        },
        new()
        {
            Tier = ModelTier.Standard, Deployment = "grok-4.3", CostPerRequestUsd = 0.075m,
            Vendor = ModelVendor.XAI, Serving = ServingMode.Serverless,
        },
        new()
        {
            Tier = ModelTier.Premium, Deployment = "claude-sonnet-4-5", CostPerRequestUsd = 0.090m,
            Vendor = ModelVendor.Anthropic, Serving = ServingMode.Serverless,
        },
    ];

    private static PolicySet CapitalMarkets(params ModelVendor[] approved) => new()
    {
        Id = "CapitalMarkets-US",
        BusinessUnit = "CapitalMarkets",
        DisplayName = "Capital Markets — US",
        ApprovedVendors = approved.Length > 0
            ? new HashSet<ModelVendor>(approved)
            : new HashSet<ModelVendor>
            {
                ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI, ModelVendor.OpenWeight,
            },
        MaxClassification = new Dictionary<ModelVendor, DataClassification>
        {
            [ModelVendor.AzureOpenAI] = DataClassification.Confidential,
            [ModelVendor.Anthropic] = DataClassification.Internal,
            [ModelVendor.XAI] = DataClassification.Internal,
            [ModelVendor.OpenWeight] = DataClassification.Restricted,
        },
    };

    [Fact]
    public void Evaluate_WithAllVendorsApproved_ReturnsWholeCatalog()
    {
        var result = PolicyGate.Evaluate(Catalog(), CapitalMarkets(), DataClassification.Internal);

        result.Eligible.Should().HaveCount(4);
        result.Excluded.Should().BeEmpty();
        result.NoEligibleModels.Should().BeFalse();
    }

    [Fact]
    public void Evaluate_WhenVendorIsDisabledByPolicy_ExcludesItWithAReason()
    {
        // Demo beat: governance disables Anthropic. The application and prompt are unchanged.
        var policy = CapitalMarkets(ModelVendor.AzureOpenAI, ModelVendor.XAI, ModelVendor.OpenWeight);

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal);

        result.Eligible.Should().NotContain(c => c.Vendor == ModelVendor.Anthropic);
        result.Excluded.Should().ContainSingle(e => e.Vendor == ModelVendor.Anthropic)
            .Which.Reason.Should().Contain("not approved");
    }

    [Fact]
    public void Evaluate_WhenClassificationExceedsVendorMaximum_ExcludesThatVendor()
    {
        var result = PolicyGate.Evaluate(Catalog(), CapitalMarkets(), DataClassification.Confidential);

        result.Eligible.Should().OnlyContain(c =>
            c.Vendor == ModelVendor.AzureOpenAI || c.Vendor == ModelVendor.OpenWeight);

        result.Excluded.Should().Contain(e => e.Reason.Contains("Data classification"));
    }

    [Fact]
    public void Evaluate_WithRestrictedData_LeavesOnlyTheOnPremiseCapableVendor()
    {
        var result = PolicyGate.Evaluate(Catalog(), CapitalMarkets(), DataClassification.Restricted);

        result.Eligible.Should().ContainSingle()
            .Which.Serving.Should().Be(ServingMode.ManagedCompute,
                "restricted data is the argument for open-weight models on dedicated capacity");
    }

    [Fact]
    public void Evaluate_WhenPolicyCeilingExcludesEverything_ReportsNoEligibleModels()
    {
        var policy = CapitalMarkets() with { MaxCostPerRequestUsd = 0.001m };

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal);

        result.NoEligibleModels.Should().BeTrue();
        result.Excluded.Should().HaveCount(4);
    }

    [Fact]
    public void Evaluate_WhenRegionIsNotPermitted_ExcludesEverythingWithTheRegionNamed()
    {
        var policy = CapitalMarkets() with { AllowedRegions = new HashSet<string> { "eastus2" } };

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal, "westeurope");

        result.NoEligibleModels.Should().BeTrue();
        result.Excluded.Should().OnlyContain(e => e.Reason.Contains("westeurope"));
    }

    [Fact]
    public void Evaluate_WhenRegionIsPermitted_ProceedsNormally()
    {
        var policy = CapitalMarkets() with { AllowedRegions = new HashSet<string> { "eastus2" } };

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal, "eastus2");

        result.Eligible.Should().HaveCount(4);
    }

    [Fact]
    public void Evaluate_EveryExclusionCarriesAReasonFitToShowAGovernanceAudience()
    {
        var policy = CapitalMarkets(ModelVendor.AzureOpenAI);

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal);

        result.Excluded.Should().OnlyContain(e => !string.IsNullOrWhiteSpace(e.Reason));
        result.Excluded.Should().OnlyContain(e => e.Reason.EndsWith('.'));
    }

    [Fact]
    public void Evaluate_CarriesThePolicySetIdentityAndVersionForPinning()
    {
        var policy = CapitalMarkets() with { Version = 7 };

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal);

        result.PolicySetId.Should().Be("CapitalMarkets-US");
        result.PolicySetVersion.Should().Be(7,
            "the version in force is pinned onto the decision so a later edit cannot rewrite history");
    }
}
