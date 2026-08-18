using System.Reflection;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Fcmr.Contract.Tests;

/// <summary>
/// Hosts approvals-service in process so the contract suite talks real HTTP to the real pipeline.
///
/// The host runs with authorisation <em>enforced</em>. The service switches enforcement off in the
/// Development environment, which is reasonable for a developer's F5 and unreasonable for a
/// contract suite to inherit: a 403 that cannot fire is a control nobody has tested, and this is
/// the service where that control is the product.
///
/// Callers are produced as principals, not as headers. ADR-011 closed the two gaps this class used
/// to document: <c>POST /v1/approvals</c> now exists, so PendingApproval is reachable from the
/// contract, and identity comes from the token's <c>oid</c> claim, so the proposer and the
/// approver are two genuinely distinguishable callers rather than two values of a header the
/// caller chose.
/// </summary>
public sealed class ApprovalApiFactory : IDisposable
{
    private const string ApprovalsAssemblyName = "Fcmr.ApprovalsService";

    private readonly IDisposable root;
    private readonly IDisposable configured;
    private readonly MethodInfo createClient;
    private readonly List<HttpClient> issued = [];

    public ApprovalApiFactory()
    {
        Assembly assembly;
        try
        {
            assembly = Assembly.Load(ApprovalsAssemblyName);
        }
        catch (Exception ex) when (ex is FileNotFoundException or BadImageFormatException)
        {
            throw new ContractSurfaceMissingException(
                $"The approvals-service assembly '{ApprovalsAssemblyName}' could not be loaded, so " +
                "contracts/approval-api.md cannot be exercised over HTTP (T-018).", ex);
        }

        var entryPoint = assembly.EntryPoint?.DeclaringType
            ?? throw new ContractSurfaceMissingException(
                $"'{ApprovalsAssemblyName}' exposes no entry point to host (T-018).");

        var factoryType = typeof(WebApplicationFactory<>).MakeGenericType(entryPoint);
        root = (IDisposable)Activator.CreateInstance(factoryType)!;

        var withWebHostBuilder = factoryType.GetMethod(
            nameof(WebApplicationFactory<object>.WithWebHostBuilder),
            [typeof(Action<IWebHostBuilder>)])!;

        configured = (IDisposable)withWebHostBuilder.Invoke(root, [(Action<IWebHostBuilder>)Configure])!;

        createClient = factoryType.GetMethod(
            nameof(WebApplicationFactory<object>.CreateClient), Type.EmptyTypes)!;

        Anonymous = Client();
    }

    /// <summary>A caller presenting no credential at all. Must never receive a 2xx.</summary>
    public HttpClient Anonymous { get; }

    /// <summary>A caller holding <paramref name="roles"/> and presenting <paramref name="objectId"/> as its oid.</summary>
    public HttpClient As(string objectId, params string[] roles)
    {
        var client = Client();
        client.DefaultRequestHeaders.Add(TestRoleAuthenticationHandler.RolesHeader, string.Join(',', roles));
        client.DefaultRequestHeaders.Add(TestRoleAuthenticationHandler.ObjectIdHeader, objectId);
        return client;
    }

    public void Dispose()
    {
        foreach (var client in issued)
        {
            client.Dispose();
        }

        configured.Dispose();
        root.Dispose();
    }

    private HttpClient Client()
    {
        var client = (HttpClient)createClient.Invoke(configured, null)!;
        issued.Add(client);
        return client;
    }

    private static void Configure(IWebHostBuilder builder)
    {
        // Enforcement on, in every environment the suite might run in.
        builder.UseSetting("Approvals:Authorization:Enabled", "true");

        builder.ConfigureTestServices(services =>
        {
            // Replaces the identity provider, not the authorisation decision. The role checks and
            // the segregation-of-duties comparison still run in the service.
            services
                .AddAuthentication(TestRoleAuthenticationHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, TestRoleAuthenticationHandler>(
                    TestRoleAuthenticationHandler.SchemeName, _ => { });
        });
    }
}
