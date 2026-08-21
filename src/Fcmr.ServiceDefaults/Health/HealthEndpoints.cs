using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Fcmr.ServiceDefaults.Health;

/// <summary>
/// The probe endpoints every service in this repository exposes.
/// </summary>
public static class HealthEndpoints
{
    /// <summary>
    /// Maps liveness and readiness.
    ///
    /// Liveness answers "is this process running", and nothing more. It must not consult a
    /// dependency: a liveness probe that fails on a downstream outage causes Container Apps to
    /// restart a healthy replica, turning a recoverable blip into a rolling outage.
    ///
    /// Readiness may consult dependencies, which is what <paramref name="readiness"/> is for.
    /// A service with no external dependency passes null and reports ready as soon as it is up.
    /// </summary>
    public static IEndpointRouteBuilder MapFcmrHealthEndpoints(
        this IEndpointRouteBuilder endpoints,
        Func<CancellationToken, Task<IResult>>? readiness = null)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/healthz/live", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
        endpoints.MapGet("/healthz", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

        if (readiness is null)
        {
            endpoints.MapGet("/healthz/ready", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
        }
        else
        {
            endpoints.MapGet("/healthz/ready", (CancellationToken ct) => readiness(ct)).AllowAnonymous();
        }

        return endpoints;
    }
}
