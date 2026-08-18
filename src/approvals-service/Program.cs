using System.Text.Json.Serialization;
using Fcmr.ApprovalsService.Correlation;
using Fcmr.ApprovalsService.Endpoints;
using Fcmr.ApprovalsService.Persistence;
using Fcmr.ApprovalsService.Security;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();

// Enums cross the wire as names. An audit record holding "2" where it should hold "Rejected" is
// one enum reorder away from being wrong.
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddCorrelationId();
builder.Services.AddApprovalsAuthorization(builder.Configuration, builder.Environment);

// T-019 replaces this registration with the Cosmos adapter. Nothing above the port changes when
// it does, which is why the port exists before the adapter.
builder.Services.AddSingleton<IApprovalStore, InMemoryApprovalStore>();

var app = builder.Build();

// Before everything, so a request that fails authentication or model binding still carries an id
// the audit trail can be searched by.
app.UseCorrelationId();

if (ApprovalsAuthorization.IsEnforced(app.Configuration, app.Environment))
{
    app.UseAuthentication();
    app.UseAuthorization();
}

// Liveness answers "is this process running", and nothing more. It must not consult a dependency:
// a liveness probe that fails on a downstream outage causes Container Apps to restart a healthy
// replica, turning a recoverable blip into a rolling outage.
app.MapGet("/healthz/live", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapGet("/healthz/ready", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapGet("/healthz", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

app.MapApprovalEndpoints();

app.Run();

/// <summary>Present so a test host can reference the composition root.</summary>
public partial class Program;
