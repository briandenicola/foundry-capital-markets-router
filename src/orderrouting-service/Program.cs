using System.Text.Json.Serialization;
using Fcmr.OrderRoutingService.Endpoints;
using Fcmr.OrderRoutingService.Hosting;
using Fcmr.OrderRoutingService.Persistence;
using Fcmr.ServiceDefaults.Correlation;
using Fcmr.ServiceDefaults.Health;
using Fcmr.ServiceDefaults.Security;
using Fcmr.ServiceDefaults.Telemetry;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();

// Enums cross the wire as names. An audit record holding "2" where it should hold "Halted" is one
// enum reorder away from being wrong.
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddCorrelationId();
builder.Services.AddFcmrTelemetry(builder.Configuration, OrderRoutingActivitySource.Name);

var authorization = OrderRoutingAuthorization.Create();
authorization.Register(builder.Services, builder.Configuration, builder.Environment);

builder.Services.AddSingleton<IProposalStore, InMemoryProposalStore>();

var app = builder.Build();

// Before everything, so a request that fails authentication or model binding still carries an id
// the audit trail can be searched by.
app.UseCorrelationId();

if (authorization.IsEnforced(app.Configuration, app.Environment))
{
    app.UseAuthentication();
    app.UseAuthorization();
}

app.MapFcmrHealthEndpoints();
app.MapOrderRoutingEndpoints();

app.Run();

/// <summary>Present so a test host can reference the composition root.</summary>
public partial class Program;
