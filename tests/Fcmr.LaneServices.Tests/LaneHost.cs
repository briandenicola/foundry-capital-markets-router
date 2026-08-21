using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Fcmr.LaneServices.Tests;

/// <summary>
/// Hosts one lane service in process, with authorisation <em>enforced</em>.
///
/// Enforcement is forced on regardless of environment. The services switch it off under
/// Development so an SE can F5 without an Entra tenant; inheriting that here would leave every
/// 403 in the lane untested, and an approval gate nobody has exercised is not a control.
/// </summary>
/// <typeparam name="TEntryPoint">Any public type from the service assembly to host.</typeparam>
public sealed class LaneHost<TEntryPoint> : WebApplicationFactory<TEntryPoint>
    where TEntryPoint : class
{
    private readonly string enabledKey;

    public LaneHost(string enabledConfigurationKey) => enabledKey = enabledConfigurationKey;

    /// <summary>A client presenting the given roles, and optionally a specific object id.</summary>
    public HttpClient CallerWith(string roles, string? objectId = null)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add(LaneAuthenticationHandler.RolesHeader, roles);

        if (objectId is not null)
        {
            client.DefaultRequestHeaders.Add(LaneAuthenticationHandler.ObjectIdHeader, objectId);
        }

        return client;
    }

    /// <summary>A caller presenting no credential at all.</summary>
    public HttpClient Anonymous() => CreateClient();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.UseSetting(enabledKey, "true");

        builder.ConfigureTestServices(services =>
        {
            services
                .AddAuthentication(LaneAuthenticationHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, LaneAuthenticationHandler>(
                    LaneAuthenticationHandler.SchemeName, _ => { });
        });
    }
}
