using Fcmr.Router.Decisions;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();

// T-011: Application Insights wiring, correlation-ID middleware.
// T-014: Cosmos decision persistence and the change-feed scoreboard fallback.
// T-015: full POST /v1/route implementation against contracts/router-api.md.

var app = builder.Build();

app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));

// Placeholder. The real implementation invokes Foundry through APIM after the decision is made
// and persisted. No other service may reach a model deployment; see Principle V.
app.MapPost("/v1/route", (RouteRequest request) =>
{
    var score = ComplexityScorer.Score(new ComplexityHints
    {
        InputTokenEstimate = request.ComplexityHints?.InputTokenEstimate ?? 0,
        RequiresMultiStep = request.ComplexityHints?.RequiresMultiStep ?? false,
        RequiresRetrieval = request.ComplexityHints?.RequiresRetrieval ?? false,
        RequiresToolCalls = request.ComplexityHints?.RequiresToolCalls ?? false,
    });

    var pricing = TierPricingCatalog.FromEnvironment();
    var decision = TierSelector.Select(score, request.CostCeilingUsd, pricing);

    return decision.Outcome == RoutingOutcome.Denied
        ? Results.Json(new { request.CorrelationId, error = "CostCeilingExceeded", decision }, statusCode: 402)
        : Results.Ok(new { request.CorrelationId, decision });
});

app.Run();

internal sealed record RouteRequest(
    string CorrelationId,
    string Lane,
    string TaskKind,
    decimal CostCeilingUsd,
    int LatencyBudgetMs,
    ComplexityHintsDto? ComplexityHints);

internal sealed record ComplexityHintsDto(
    int InputTokenEstimate,
    bool RequiresMultiStep,
    bool RequiresRetrieval,
    bool RequiresToolCalls);

internal static class TierPricingCatalog
{
    // Placeholder pricing. T-013 replaces this with gateway-reported rates.
    public static List<TierPricing> FromEnvironment() =>
    [
        new()
        {
            Tier = ModelTier.Economy,
            Deployment = Environment.GetEnvironmentVariable("MODEL_TIER_ECONOMY") ?? "gpt-5.4-mini",
            CostPerRequestUsd = 0.004m,
        },
        new()
        {
            Tier = ModelTier.Standard,
            Deployment = Environment.GetEnvironmentVariable("MODEL_TIER_STANDARD") ?? "gpt-5.4",
            CostPerRequestUsd = 0.031m,
        },
        new()
        {
            Tier = ModelTier.Premium,
            Deployment = Environment.GetEnvironmentVariable("MODEL_TIER_PREMIUM") ?? "gpt-5.6-sol",
            CostPerRequestUsd = 0.180m,
        },
    ];
}
