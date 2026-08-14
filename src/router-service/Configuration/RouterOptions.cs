using Fcmr.Router.Decisions;

namespace Fcmr.RouterService.Configuration;

public sealed class ModelCatalogEntryOptions
{
    public ModelTier Tier { get; set; }
    public string Deployment { get; set; } = string.Empty;
    public decimal CostPerRequestUsd { get; set; }
    public ModelVendor Vendor { get; set; } = ModelVendor.AzureOpenAI;
    public ServingMode Serving { get; set; } = ServingMode.Serverless;
    public bool Available { get; set; } = true;
}

public sealed class RouterPolicyOptions
{
    /// <summary>Cosmos partition key for policy sets. Governance is scoped per business unit.</summary>
    public string BusinessUnit { get; set; } = "CapitalMarkets";

    public string SetId { get; set; } = "CapitalMarkets-US";
}

public sealed class RouterAuthorizationOptions
{
    /// <summary>
    /// Whether the Router.Invoke app role is enforced.
    ///
    /// Defaults to true and is honoured as false only in the Development environment, following the
    /// same shape the constitution gives <c>enable_private_networking</c>: a local development
    /// affordance that must be impossible in the cloud stack.
    /// </summary>
    public bool Enabled { get; set; } = true;

    public string RequiredRole { get; set; } = "Router.Invoke";
}

/// <summary>
/// Everything the router needs that is deployment configuration rather than a decision.
///
/// The catalog lives here because which deployments exist is an operational fact, supplied by
/// Terraform at deploy time. What to do with them is not configuration, and is not decided here.
/// </summary>
public sealed class RouterOptions
{
    public const string SectionName = "Router";

    public IList<ModelCatalogEntryOptions> Catalog { get; } = [];

    public RouterPolicyOptions Policy { get; set; } = new();

    public RouterAuthorizationOptions Authorization { get; set; } = new();
}
