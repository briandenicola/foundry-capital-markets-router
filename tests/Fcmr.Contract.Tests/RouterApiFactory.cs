using System.Reflection;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Fcmr.Contract.Tests;

/// <summary>
/// Hosts router-service in process so the contract suite talks real HTTP to the real pipeline.
///
/// The entry-point type is resolved by reflection rather than named directly. Top-level statements
/// emit an <c>internal</c> <c>Program</c> unless the service opts out, and although
/// <c>src/router-service/Program.cs</c> currently declares <c>public partial class Program</c>, this
/// suite does not depend on it doing so: a contract test that requires an edit to the code under
/// test has already begun negotiating with it.
///
/// The host runs with authorisation <em>enforced</em>. The service's local-development affordance
/// switches enforcement off in the Development environment, which is a reasonable thing for a
/// developer's F5 to do and an unreasonable thing for a contract suite to inherit: a 403 that
/// cannot fire is a control nobody has tested.
/// </summary>
public sealed class RouterApiFactory : IDisposable
{
    private const string RouterAssemblyName = "Fcmr.RouterService";

    /// <summary>The app role <c>contracts/router-api.md</c> requires for POST /v1/route.</summary>
    private const string RouterInvoke = "Router.Invoke";

    private readonly IDisposable root;
    private readonly IDisposable configured;

    public RouterApiFactory()
    {
        Assembly routerAssembly;
        try
        {
            routerAssembly = Assembly.Load(RouterAssemblyName);
        }
        catch (Exception ex) when (ex is FileNotFoundException or BadImageFormatException)
        {
            throw new ContractSurfaceMissingException(
                $"The router-service assembly '{RouterAssemblyName}' could not be loaded, so " +
                "POST /v1/route cannot be contract-tested in process (T-015).", ex);
        }

        var entryPoint = routerAssembly.EntryPoint?.DeclaringType
            ?? throw new ContractSurfaceMissingException(
                $"'{RouterAssemblyName}' exposes no entry point to host (T-015).");

        var factoryType = typeof(WebApplicationFactory<>).MakeGenericType(entryPoint);
        root = (IDisposable)Activator.CreateInstance(factoryType)!;

        var withWebHostBuilder = factoryType.GetMethod(
            nameof(WebApplicationFactory<object>.WithWebHostBuilder),
            [typeof(Action<IWebHostBuilder>)])!;

        configured = (IDisposable)withWebHostBuilder.Invoke(root, [(Action<IWebHostBuilder>)Configure])!;

        var createClient = factoryType.GetMethod(
            nameof(WebApplicationFactory<object>.CreateClient), Type.EmptyTypes)!;

        Anonymous = (HttpClient)createClient.Invoke(configured, null)!;

        Authorized = (HttpClient)createClient.Invoke(configured, null)!;
        Authorized.DefaultRequestHeaders.Add(TestRoleAuthenticationHandler.RolesHeader, RouterInvoke);

        WrongRole = (HttpClient)createClient.Invoke(configured, null)!;
        WrongRole.DefaultRequestHeaders.Add(TestRoleAuthenticationHandler.RolesHeader, "Router.Read");
    }

    /// <summary>A caller whose token carries the Router.Invoke app role.</summary>
    public HttpClient Authorized { get; }

    /// <summary>A caller presenting no credential at all. Must never receive a 200.</summary>
    public HttpClient Anonymous { get; }

    /// <summary>An authenticated caller holding a different app role. Must receive a 403.</summary>
    public HttpClient WrongRole { get; }

    public void Dispose()
    {
        Anonymous.Dispose();
        Authorized.Dispose();
        WrongRole.Dispose();
        configured.Dispose();
        root.Dispose();
    }

    private static void Configure(IWebHostBuilder builder)
    {
        // Enforcement on, in every environment the suite might run in.
        builder.UseSetting("Router:Authorization:Enabled", "true");

        builder.ConfigureTestServices(services =>
        {
            // Replaces the identity provider, not the authorisation decision. The Router.Invoke
            // check still runs in the service's own endpoint filter.
            services
                .AddAuthentication(TestRoleAuthenticationHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, TestRoleAuthenticationHandler>(
                    TestRoleAuthenticationHandler.SchemeName, _ => { });
        });
    }
}

/// <summary>
/// Thrown when a surface named by a published contract does not exist yet.
///
/// Distinct from an assertion failure on purpose. "The endpoint disagrees with the contract" and
/// "the endpoint has not been written" are different reports, and a suite that renders them
/// identically wastes the reader's morning.
/// </summary>
public sealed class ContractSurfaceMissingException : Exception
{
    public ContractSurfaceMissingException(string message)
        : base(message)
    {
    }

    public ContractSurfaceMissingException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    public ContractSurfaceMissingException()
    {
    }
}
