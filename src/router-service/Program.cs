using System.Text.Json.Serialization;
using Fcmr.Router.Decisions;
using Fcmr.RouterService.Configuration;
using Fcmr.RouterService.Contracts;
using Fcmr.ServiceDefaults.Correlation;
using Fcmr.RouterService.Health;
using Fcmr.RouterService.Persistence;
using Fcmr.RouterService.Routing;
using Fcmr.RouterService.Security;
using Fcmr.RouterService.Telemetry;
using Fcmr.ServiceDefaults.Telemetry;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();

// Enums cross the wire as names. The UI's generated types are string unions, and an audit record
// holding "2" where it should hold "Denied" is one enum reorder away from being wrong.
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddOptions<RouterOptions>()
    .Bind(builder.Configuration.GetSection(RouterOptions.SectionName));

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddCorrelationId();
builder.Services.AddFcmrTelemetry(builder.Configuration, RouterActivitySource.Name);
builder.Services.AddRouterAuthorization(builder.Configuration, builder.Environment);

builder.Services.AddSingleton<IModelCatalog, ConfiguredModelCatalog>();

// T-014. The port has two adapters and the choice is a registration, exactly as designed --
// nothing above IRoutingDecisionStore knows which one it got.
//
// In-memory remains the default, and that is not laziness. A service that reaches for a Cosmos
// account nobody configured fails in a way that reads like a network fault; requiring the operator
// to say "yes, persist" makes the absence of persistence an explicit local choice rather than an
// accident someone discovers after the demo.
var cosmos = builder.Configuration.GetSection(CosmosOptions.SectionName).Get<CosmosOptions>() ?? new();

if (cosmos.Enabled)
{
    builder.Services.AddSingleton(cosmos);
    builder.Services.AddSingleton(_ => CosmosClientFactory.Create(cosmos, builder.Environment));
    builder.Services.AddSingleton<IRoutingDecisionStore, CosmosRoutingDecisionStore>();
}
else
{
    builder.Services.AddSingleton<IRoutingDecisionStore, InMemoryRoutingDecisionStore>();
}

builder.Services.AddSingleton<IPolicySetRepository>(sp =>
    new InMemoryPolicySetRepository(
        [DefaultPolicySet.From(sp.GetRequiredService<IOptions<RouterOptions>>().Value.Policy)],
        sp.GetRequiredService<TimeProvider>()));

builder.Services.AddScoped<RouteRequestHandler>();

builder.Services.AddHealthChecks()
    .AddCheck<DecisionStoreHealthCheck>("decision-store", tags: ["ready"]);

var app = builder.Build();

// Before everything, so a request that fails authentication, model binding, or routing still
// carries an id the audit trail can be searched by.
app.UseCorrelationId();

if (RouterAuthorization.IsEnforced(app.Configuration, app.Environment))
{
    app.UseAuthentication();
    app.UseAuthorization();
}

// Liveness answers "is this process running", and nothing more. It must not consult a dependency:
// a liveness probe that fails on a downstream outage causes Container Apps to restart a healthy
// replica, turning a recoverable dependency blip into a rolling outage.
app.MapHealthChecks("/healthz/live", new()
{
    Predicate = _ => false,
}).AllowAnonymous();

// Readiness answers "should traffic be sent here", and therefore does consult dependencies.
app.MapHealthChecks("/healthz/ready", new()
{
    Predicate = check => check.Tags.Contains("ready"),
}).AllowAnonymous();

// Retained because Container Apps probes and existing tooling already point at it. It is the
// liveness signal; readiness lives at /healthz/ready and the two are not interchangeable.
app.MapGet("/healthz", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

app.MapPost("/v1/route", async (RouteRequest request, RouteRequestHandler handler, CancellationToken ct) =>
    {
        var result = await handler.HandleAsync(request, ct);
        return Results.Json(result.Body, statusCode: result.StatusCode);
    })
    .AddEndpointFilter<RequireAppRoleFilter>()
    .WithName("Route");

app.Run();

/// <summary>
/// The governance baseline the router starts from when no policy set has been written yet.
///
/// Configuration supplies the identifiers only. The permissions themselves are deliberately the
/// most restrictive shape that can still serve the demo — one approved vendor, Confidential as the
/// ceiling, Restricted not permitted — because a baseline that is permissive by default is a
/// baseline nobody notices is permissive.
/// </summary>
internal static class DefaultPolicySet
{
    public static PolicySet From(RouterPolicyOptions options) => new()
    {
        Id = options.SetId,
        BusinessUnit = options.BusinessUnit,
        DisplayName = options.SetId,
        ApprovedVendors = new HashSet<ModelVendor> { ModelVendor.AzureOpenAI },
        MaxClassification = new Dictionary<ModelVendor, DataClassification>
        {
            [ModelVendor.AzureOpenAI] = DataClassification.Confidential,
        },
        MaxCostPerRequestUsd = 1.0m,
        PermitsRestrictedData = false,
    };
}

/// <summary>Present so a test host can reference the composition root.</summary>
public partial class Program;
