using System.Security.Claims;
using Fcmr.RouterService.Configuration;
using Fcmr.RouterService.Contracts;
using Fcmr.ServiceDefaults.Correlation;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Fcmr.ServiceDefaults.Security;
using Microsoft.Identity.Web;

namespace Fcmr.RouterService.Security;

/// <summary>
/// Enforces the Router.Invoke app role on the routing endpoint.
///
/// The router is the single chokepoint through which all model access passes, so "who may ask"
/// is part of the control, not part of the plumbing. The 403 is a first-class contract response
/// with a body and a correlation id, the same as every other outcome.
///
/// Missing token and wrong role both answer 403. The contract names one status for "not permitted
/// to invoke", and telling an unauthenticated caller which of the two it got helps nobody except
/// someone probing for the difference.
/// </summary>
public static class RouterAuthorization
{
    public static IServiceCollection AddRouterAuthorization(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        GuardAgainstUnauthenticatedDeployment(configuration, environment);

        if (!IsEnforced(configuration, environment))
        {
            return services;
        }

        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddMicrosoftIdentityWebApi(configuration.GetSection("AzureAd"));

        services.AddAuthorization();
        return services;
    }

    /// <summary>
    /// Refuses to start unauthenticated on a host that is demonstrably not a workstation.
    ///
    /// <see cref="IsEnforced"/> trusts the environment name, and the environment name is an
    /// environment variable — one <c>env</c> block in Terraform, or one revision edit in the
    /// portal, and enforcement is off in production with nothing failing. The CI policy script
    /// <c>scripts/policy-no-development-environment.sh</c> catches the Terraform path at PR time;
    /// it cannot see a portal edit, because a portal edit never opens a pull request.
    ///
    /// So the process refuses to run. Throwing at composition is deliberate: the alternative is a
    /// warning in a log nobody reads on a service that is, at that moment, the unauthenticated
    /// sole path to every model in the estate. Failing to start is loud, immediate, and cannot be
    /// mistaken for working.
    /// </summary>
    private static void GuardAgainstUnauthenticatedDeployment(
        IConfiguration configuration,
        IHostEnvironment environment)
        => GuardAgainstUnauthenticatedDeployment(configuration, environment, Environment.GetEnvironmentVariable);

    /// <inheritdoc cref="GuardAgainstUnauthenticatedDeployment(IConfiguration, IHostEnvironment)"/>
    /// <param name="lookup">
    /// Environment variable reader. Injected so the guard can be tested without mutating the
    /// process environment, which would make the suite order-dependent.
    /// </param>
    public static void GuardAgainstUnauthenticatedDeployment(
        IConfiguration configuration,
        IHostEnvironment environment,
        Func<string, string?> lookup)
    {
        ArgumentNullException.ThrowIfNull(lookup);

        ManagedPlatform.GuardAgainstUnauthenticatedDeployment(
            isEnforced: IsEnforced(configuration, environment),
            disabledControl: "Router.Invoke enforcement",
            consequence:
                "Disabling app-role enforcement is a local development affordance only. The router " +
                "is the sole path to a model (Principle IV), so an unauthenticated router is that " +
                "path standing open.",
            settingPath: "Router:Authorization:Enabled",
            lookup: lookup);
    }

    /// <summary>
    /// True unless enforcement is switched off <em>and</em> the host is Development.
    ///
    /// Shaped like the constitution's <c>enable_private_networking</c>, and — as that comparison
    /// demands — enforced rather than asserted: a CI policy job fails the build if any deployment
    /// artefact selects Development, and
    /// <see cref="GuardAgainstUnauthenticatedDeployment"/> refuses to start if one reaches a
    /// managed platform anyway.
    /// </summary>
    public static bool IsEnforced(IConfiguration configuration, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        var enabled = configuration
            .GetSection($"{RouterOptions.SectionName}:Authorization:Enabled")
            .Get<bool?>() ?? true;

        return enabled || !environment.IsDevelopment();
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
}

/// <summary>Applies <see cref="RouterAuthorization"/> to a single endpoint.</summary>
public sealed class RequireAppRoleFilter(
    IOptionsMonitor<RouterOptions> options,
    IConfiguration configuration,
    IHostEnvironment environment) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        if (!RouterAuthorization.IsEnforced(configuration, environment))
        {
            return await next(context).ConfigureAwait(false);
        }

        var required = options.CurrentValue.Authorization.RequiredRole;

        if (RouterAuthorization.HasRole(context.HttpContext.User, required))
        {
            return await next(context).ConfigureAwait(false);
        }

        var correlation = context.HttpContext.RequestServices.GetRequiredService<ICorrelationIdAccessor>();

        return Results.Json(
            new RouteErrorResponse
            {
                CorrelationId = correlation.Value,
                Error = "Forbidden",
                Message = $"The caller does not carry the {required} app role.",
            },
            statusCode: StatusCodes.Status403Forbidden);
    }
}
