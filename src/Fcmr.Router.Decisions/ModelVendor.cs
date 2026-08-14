namespace Fcmr.Router.Decisions;

/// <summary>
/// Model vendors in the approved catalog.
///
/// Vendor is an explicit, first-class property rather than something inferred from a deployment
/// name, because the whole argument of the exchange is that vendors are interchangeable. A
/// concept you cannot name is a concept you cannot swap by policy.
/// </summary>
public enum ModelVendor
{
    AzureOpenAI,
    Anthropic,
    XAI,

    /// <summary>Open-weight models served on Foundry managed compute.</summary>
    OpenWeight,
}

/// <summary>How a model is served.</summary>
public enum ServingMode
{
    /// <summary>Azure-hosted endpoint. Provisioned quickly, billed per token.</summary>
    Serverless,

    /// <summary>
    /// Dedicated GPU capacity in the Foundry project. PREVIEW.
    /// Subject to quota, slow to provision, and cheap per request once warm.
    /// </summary>
    ManagedCompute,
}

/// <summary>
/// Sensitivity of the data accompanying a request. Drives which models may see it.
/// </summary>
public enum DataClassification
{
    Public = 0,
    Internal = 1,
    Confidential = 2,
    Restricted = 3,
}
