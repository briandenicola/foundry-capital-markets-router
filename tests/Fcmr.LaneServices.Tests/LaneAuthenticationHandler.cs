using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Fcmr.LaneServices.Tests;

/// <summary>
/// A test authentication scheme for the lane hosts, mirroring the contract suite's handler.
///
/// A double for the identity provider, never for the control: the lane's own
/// <c>RequireAppRoleFilter</c> still evaluates a real <see cref="ClaimsPrincipal"/>. No Entra token
/// is minted because no signing key exists in this repository and none may (Principle VIII).
/// </summary>
public sealed class LaneAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "LaneTestRoles";
    public const string RolesHeader = "X-Test-Roles";

    /// <summary>
    /// The object id this principal presents. Segregation of duties compares two of these, so a
    /// suite that wants a distinguishable proposer and approver has to mint two principals rather
    /// than send two strings in a body.
    /// </summary>
    public const string ObjectIdHeader = "X-Test-Object-Id";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(RolesHeader, out var header))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var objectId = Request.Headers.TryGetValue(ObjectIdHeader, out var oid)
            ? oid.ToString()
            : "lane-test-caller";

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, objectId),
            new("oid", objectId),
        };

        claims.AddRange(header
            .ToString()
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(role => new Claim("roles", role)));

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        return Task.FromResult(AuthenticateResult.Success(
            new AuthenticationTicket(principal, SchemeName)));
    }
}
