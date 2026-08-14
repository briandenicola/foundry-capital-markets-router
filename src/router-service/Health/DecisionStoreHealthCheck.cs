using Fcmr.RouterService.Persistence;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Fcmr.RouterService.Health;

/// <summary>
/// Readiness gate on the decision store.
///
/// Reports unhealthy when the system of record is unreachable, which takes the replica out of
/// rotation rather than letting it accept requests whose decisions it cannot record. A readiness
/// probe that answers healthy while a dependency is down hides precisely the failure ADR-007 says
/// must be surfaced, and it is the easiest kind of masking to introduce by accident.
/// </summary>
public sealed class DecisionStoreHealthCheck(IRoutingDecisionStore store) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var reachable = await store.IsReachableAsync(cancellationToken).ConfigureAwait(false);

            return reachable
                ? HealthCheckResult.Healthy("Decision store is reachable.")
                : HealthCheckResult.Unhealthy("Decision store is not reachable; decisions could not be recorded.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HealthCheckResult.Unhealthy("Decision store probe failed.", ex);
        }
    }
}
