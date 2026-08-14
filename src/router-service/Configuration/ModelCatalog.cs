using Fcmr.Router.Decisions;
using Microsoft.Extensions.Options;

namespace Fcmr.RouterService.Configuration;

/// <summary>
/// The set of model deployments the router may consider.
///
/// Supplied by configuration because which deployments exist is an operational fact that Terraform
/// knows and the code does not. It is read once per request rather than cached so that a catalog
/// change takes effect without a redeploy — the same property Principle IV demands of policy.
/// </summary>
public interface IModelCatalog
{
    IReadOnlyList<TierPricing> Current();
}

public sealed class ConfiguredModelCatalog(IOptionsMonitor<RouterOptions> options) : IModelCatalog
{
    public IReadOnlyList<TierPricing> Current() =>
        options.CurrentValue.Catalog
            .Where(e => !string.IsNullOrWhiteSpace(e.Deployment))
            .Select(e => new TierPricing
            {
                Tier = e.Tier,
                Deployment = e.Deployment,
                CostPerRequestUsd = e.CostPerRequestUsd,
                Vendor = e.Vendor,
                Serving = e.Serving,
                Available = e.Available,
            })
            .ToList();
}
