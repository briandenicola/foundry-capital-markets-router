using System.Security.Claims;
using Fcmr.RouterService.Security;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Fcmr.RouterService.Tests;

public sealed class RouterAuthorizationTests
{
    private sealed class Environment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "Fcmr.RouterService";
        public string ContentRootPath { get; set; } = ".";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    private static IConfiguration Config(bool? enabled) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(enabled is null
                ? []
                : new Dictionary<string, string?>
                {
                    ["Router:Authorization:Enabled"] = enabled.Value.ToString(),
                })
            .Build();

    [Fact]
    public void Enforces_by_default()
    {
        RouterAuthorization.IsEnforced(Config(null), new Environment("Production")).Should().BeTrue();
    }

    /// <summary>
    /// The affordance is local only, checked against the environment rather than the flag alone —
    /// the same shape the constitution gives enable_private_networking, so a stray config value in
    /// the cloud stack cannot switch the app role off.
    /// </summary>
    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public void Cannot_be_disabled_outside_development(string environmentName)
    {
        RouterAuthorization.IsEnforced(Config(false), new Environment(environmentName)).Should().BeTrue();
    }

    [Fact]
    public void Can_be_disabled_in_development_only()
    {
        RouterAuthorization.IsEnforced(Config(false), new Environment("Development")).Should().BeFalse();
        RouterAuthorization.IsEnforced(Config(true), new Environment("Development")).Should().BeTrue();
    }

    [Fact]
    public void Rejects_an_unauthenticated_caller()
    {
        RouterAuthorization.HasRole(new ClaimsPrincipal(new ClaimsIdentity()), "Router.Invoke")
            .Should().BeFalse();
    }

    [Fact]
    public void Rejects_a_null_principal()
    {
        RouterAuthorization.HasRole(null, "Router.Invoke").Should().BeFalse();
    }

    [Fact]
    public void Rejects_an_authenticated_caller_holding_a_different_role()
    {
        var principal = new ClaimsPrincipal(
            new ClaimsIdentity([new Claim("roles", "Router.Read")], "Bearer"));

        RouterAuthorization.HasRole(principal, "Router.Invoke").Should().BeFalse();
    }

    [Theory]
    [InlineData("roles")]
    [InlineData(ClaimTypes.Role)]
    [InlineData("http://schemas.microsoft.com/identity/claims/roles")]
    public void Accepts_the_role_on_any_claim_type_entra_may_emit(string claimType)
    {
        var principal = new ClaimsPrincipal(
            new ClaimsIdentity([new Claim(claimType, "Router.Invoke")], "Bearer"));

        RouterAuthorization.HasRole(principal, "Router.Invoke").Should().BeTrue();
    }

    [Fact]
    public void Matches_the_role_exactly_and_case_sensitively()
    {
        var principal = new ClaimsPrincipal(
            new ClaimsIdentity([new Claim("roles", "router.invoke")], "Bearer"));

        RouterAuthorization.HasRole(principal, "Router.Invoke").Should().BeFalse();
    }

    // ---- The startup guard: enforcement off is a workstation affordance, nowhere else ----

    private static Func<string, string?> NoMarkers() => _ => null;

    private static Func<string, string?> Marker(string name) =>
        key => string.Equals(key, name, StringComparison.Ordinal) ? "set" : null;

    [Fact]
    public void Starts_unauthenticated_on_a_workstation()
    {
        var act = () => RouterAuthorization.GuardAgainstUnauthenticatedDeployment(
            Config(false), new Environment("Development"), NoMarkers());

        act.Should().NotThrow();
    }

    /// <summary>
    /// The hole Saul found. IsEnforced trusts the environment name, and the environment name is an
    /// environment variable — one Terraform env block or one portal revision edit turns
    /// authentication off in production. The CI policy script cannot see a portal edit, so the
    /// process refuses to start instead.
    /// </summary>
    [Theory]
    [InlineData("CONTAINER_APP_NAME")]
    [InlineData("CONTAINER_APP_REVISION")]
    [InlineData("CONTAINER_APP_ENV_DNS_SUFFIX")]
    [InlineData("WEBSITE_SITE_NAME")]
    [InlineData("KUBERNETES_SERVICE_HOST")]
    [InlineData("MSI_ENDPOINT")]
    [InlineData("IDENTITY_ENDPOINT")]
    public void Refuses_to_start_unauthenticated_on_a_managed_platform(string markerName)
    {
        var act = () => RouterAuthorization.GuardAgainstUnauthenticatedDeployment(
            Config(false), new Environment("Development"), Marker(markerName));

        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"*{markerName}*")
            .WithMessage("*sole path to a model*");
    }

    [Fact]
    public void Allows_a_managed_platform_when_enforcement_is_on()
    {
        // The guard is about the bypass, not about the platform. An enforcing router on Container
        // Apps is the normal case and must start.
        var act = () => RouterAuthorization.GuardAgainstUnauthenticatedDeployment(
            Config(true), new Environment("Development"), Marker("CONTAINER_APP_NAME"));

        act.Should().NotThrow();
    }

    [Fact]
    public void Allows_a_managed_platform_outside_development()
    {
        var act = () => RouterAuthorization.GuardAgainstUnauthenticatedDeployment(
            Config(false), new Environment("Production"), Marker("CONTAINER_APP_NAME"));

        act.Should().NotThrow();
    }
}
