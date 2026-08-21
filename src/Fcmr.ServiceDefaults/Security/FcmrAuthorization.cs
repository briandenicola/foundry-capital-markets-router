using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Identity.Web;

namespace Fcmr.ServiceDefaults.Security;

/// <summary>
/// App-role enforcement for the lane services.
///
/// The router and the approvals service each keep their own class, because each carries a
/// service-specific argument in its refusal messages that is worth stating precisely. The three
/// lane services have no such distinction between them, so they share one implementation rather
/// than three that will drift.
/// </summary>
public sealed class FcmrAuthorization(string enabledConfigurationKey, string disabledControl, string consequence)
{
    /// <summary>
    /// Claim types that carry an Entra object id, in the order they are preferred.
    ///
    /// <c>oid</c> is what an Entra v2 access token carries. The schema-qualified form is what
    /// <c>Microsoft.Identity.Web</c> maps it to when claim mapping is left on. Both are accepted so
    /// the service does not depend on a mapping setting elsewhere in the pipeline.
    /// </summary>
    private static readonly string[] ObjectIdClaims =
    [
        "oid",
        "http://schemas.microsoft.com/identity/claims/objectidentifier",
        ClaimConstants.ObjectId,
    ];

    public string EnabledConfigurationKey { get; } = enabledConfigurationKey;

    /// <summary>True unless enforcement is switched off <em>and</em> the host is Development.</summary>
    public bool IsEnforced(IConfiguration configuration, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        var enabled = configuration.GetSection(EnabledConfigurationKey).Get<bool?>() ?? true;
        return enabled || !environment.IsDevelopment();
    }

    public IServiceCollection Register(
        IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment,
        Func<string, string?>? lookup = null)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        ManagedPlatform.GuardAgainstUnauthenticatedDeployment(
            isEnforced: IsEnforced(configuration, environment),
            disabledControl: disabledControl,
            consequence: consequence,
            settingPath: EnabledConfigurationKey,
            lookup: lookup ?? Environment.GetEnvironmentVariable);

        if (!IsEnforced(configuration, environment))
        {
            return services;
        }

        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddMicrosoftIdentityWebApi(configuration.GetSection("AzureAd"));

        services.AddAuthorization();
        services.AddSingleton(this);
        return services;
    }

    public static bool HasRole(ClaimsPrincipal? principal, string requiredRole)
    {
        if (principal?.Identity?.IsAuthenticated != true)
        {
            return false;
        }

        return principal.Claims.Any(c =>
            (string.Equals(c.Type, "roles", StringComparison.Ordinal) ||
             string.Equals(c.Type, ClaimTypes.Role, StringComparison.Ordinal) ||
             string.Equals(c.Type, "http://schemas.microsoft.com/identity/claims/roles", StringComparison.Ordinal)) &&
            string.Equals(c.Value, requiredRole, StringComparison.Ordinal));
    }

    /// <summary>
    /// The caller's Entra object id, or null if the token carries none.
    ///
    /// Null rather than a placeholder. An identity that proposes under a stand-in value is an
    /// identity segregation of duties cannot be evaluated against, and every gate in this
    /// repository refuses that case outright rather than approximating it. See ADR-011.
    /// </summary>
    public static string? ObjectId(ClaimsPrincipal? principal)
    {
        if (principal?.Identity?.IsAuthenticated != true)
        {
            return null;
        }

        foreach (var claimType in ObjectIdClaims)
        {
            var value = principal.FindFirst(claimType)?.Value;
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value;
            }
        }

        return null;
    }
}

/// <summary>
/// Enforces one app role on one endpoint.
///
/// Missing token and wrong role both answer 403. Telling an unauthenticated caller which of the
/// two it got helps nobody except someone probing for the difference.
/// </summary>
public sealed class RequireAppRoleFilter(string requiredRole) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var services = context.HttpContext.RequestServices;
        var authorization = services.GetService<FcmrAuthorization>();

        // No FcmrAuthorization in the container means Register decided enforcement was off, which
        // it will only do on a workstation — ManagedPlatform throws otherwise.
        if (authorization is null)
        {
            return await next(context).ConfigureAwait(false);
        }

        if (!FcmrAuthorization.HasRole(context.HttpContext.User, requiredRole))
        {
            return Results.Json(
                new
                {
                    error = "Forbidden",
                    detail = $"The caller does not hold the {requiredRole} app role.",
                },
                statusCode: StatusCodes.Status403Forbidden);
        }

        return await next(context).ConfigureAwait(false);
    }
}
