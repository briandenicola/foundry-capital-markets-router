using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Fcmr.Contract.Tests;

/// <summary>
/// A test authentication scheme that turns the <c>X-Test-Roles</c> header into app roles.
///
/// This is a test double for the identity provider, not for the control. Authorisation still runs
/// in Rusty's <c>RequireAppRoleFilter</c> against a real <see cref="ClaimsPrincipal"/>; all this
/// does is put a principal in front of it without minting an Entra token, which a test cannot do
/// and must not try to — no signing key exists in this repository and none may (Hard Rule 5).
///
/// Absent header means an unauthenticated caller, so the anonymous case is expressed by sending
/// nothing rather than by a second host configuration.
/// </summary>
public sealed class TestRoleAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "ContractTestRoles";

    public const string RolesHeader = "X-Test-Roles";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(RolesHeader, out var header))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, "contract-test-caller") };
        claims.AddRange(header
            .ToString()
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(role => new Claim("roles", role)));

        var identity = new ClaimsIdentity(claims, SchemeName);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
