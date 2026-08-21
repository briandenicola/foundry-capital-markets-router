using System.Text.Json.Serialization;
using Fcmr.ServiceDefaults.Correlation;
using Fcmr.ServiceDefaults.Health;
using Fcmr.ServiceDefaults.Telemetry;
using Fcmr.SurveillanceService.Endpoints;
using Fcmr.SurveillanceService.Hosting;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();

// Enums cross the wire as names. An audit record holding "1" where it should hold "Escalated" is
// one enum reorder away from being wrong.
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddCorrelationId();
builder.Services.AddFcmrTelemetry(builder.Configuration, SurveillanceActivitySource.Name);

var authorization = SurveillanceAuthorization.Create();
authorization.Register(builder.Services, builder.Configuration, builder.Environment);

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
app.MapSurveillanceEndpoints();

app.Run();

/// <summary>Present so a test host can reference the composition root.</summary>
public partial class Program;
