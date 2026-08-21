using System.Text.Json.Serialization;
using Fcmr.ResearchService.Endpoints;
using Fcmr.ResearchService.Hosting;
using Fcmr.ServiceDefaults.Correlation;
using Fcmr.ServiceDefaults.Health;
using Fcmr.ServiceDefaults.Telemetry;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();

builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddCorrelationId();
builder.Services.AddFcmrTelemetry(builder.Configuration, ResearchActivitySource.Name);

var authorization = ResearchAuthorization.Create();
authorization.Register(builder.Services, builder.Configuration, builder.Environment);

var app = builder.Build();

app.UseCorrelationId();

if (authorization.IsEnforced(app.Configuration, app.Environment))
{
    app.UseAuthentication();
    app.UseAuthorization();
}

app.MapFcmrHealthEndpoints();
app.MapResearchEndpoints();

app.Run();

/// <summary>Present so a test host can reference the composition root.</summary>
public partial class Program;
