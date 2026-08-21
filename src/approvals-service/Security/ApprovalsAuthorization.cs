using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Fcmr.ServiceDefaults.Security;
using Microsoft.Identity.Web;

namespace Fcmr.ApprovalsService.Security;

/// <summary>
/// App roles published by <c>contracts/approval-api.md</c>.
///
/// Two roles, not one. An identity holding both may propose and approve different proposals; what
/// it may never do is decide its own, because segregation of duties compares object ids and not
/// roles. Splitting the roles is what makes the two populations separable in Entra; comparing ids
/// is what makes the control hold when someone is in both.
/// </summary>
public static class ApprovalRoles
{
    public const string Proposer = "Proposer";
    public const string Approver = "Approver";
}

/// <summary>
/// Reads the caller's Entra object id, and enforces the two app roles.
///
/// The object id is taken from the validated token and from nowhere else. See ADR-011: the
/// contract previously left this unstated and the contract suite carried the identity in an
/// <c>X-Fcmr-Caller-Object-Id</c> header, which meant a caller supplying the value that
/// segregation of duties compares could present one id when proposing and another when approving.
/// The control would have returned 200 for a caller that read the contract.
/// </summary>
public static class ApprovalsAuthorization
{
    /// <summary>
    /// Claim types that carry an Entra object id, in the order they are preferred.
    ///
    /// <c>oid</c> is what an Entra v2 access token carries. The schema-qualified form is what
    /// <c>Microsoft.Identity.Web</c> maps it to when claim mapping is left on. Both are accepted
    /// so the service does not depend on a mapping setting elsewhere in the pipeline.
    /// </summary>
    private static readonly string[] ObjectIdClaims =
    [
        "oid",
        "http://schemas.microsoft.com/identity/claims/objectidentifier",
        ClaimConstants.ObjectId,
    ];

    public static IServiceCollection AddApprovalsAuthorization(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        GuardAgainstUnauthenticatedDeployment(configuration, environment, Environment.GetEnvironmentVariable);

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
    /// The approvals service is the only thing standing between a proposal and a consequential
    /// action (Hard Rule 1). Running it with authorisation off is not a degraded mode; it is the
    /// approval gate standing open while still reporting 200s that look like approvals.
    /// </summary>
    public static void GuardAgainstUnauthenticatedDeployment(
        IConfiguration configuration,
        IHostEnvironment environment,
        Func<string, string?> lookup)
    {
        ArgumentNullException.ThrowIfNull(lookup);

        ManagedPlatform.GuardAgainstUnauthenticatedDeployment(
            isEnforced: IsEnforced(configuration, environment),
            disabledControl: "Approval role enforcement",
            consequence:
                "No consequential action may execute without a recorded human approval " +
                "(Principle I), and an unauthenticated approvals service records approvals nobody " +
                "made.",
            settingPath: "Approvals:Authorization:Enabled",
            lookup: lookup);
    }

    /// <summary>True unless enforcement is switched off <em>and</em> the host is Development.</summary>
    public static bool IsEnforced(IConfiguration configuration, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        var enabled = configuration
            .GetSection("Approvals:Authorization:Enabled")
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

    /// <summary>
    /// The caller's Entra object id, or null if the token carries none.
    ///
    /// Null is returned rather than a placeholder. A proposal whose proposer is a stand-in value
    /// is a proposal segregation of duties cannot be evaluated against, and the domain refuses one
    /// outright (<c>ApprovalRefusalKind.ProposerIdentityRequired</c>).
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
