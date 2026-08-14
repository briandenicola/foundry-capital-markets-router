using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Fcmr.Contract.Tests;

/// <summary>
/// Builds <c>POST /v1/route</c> request bodies as loose JSON objects.
///
/// Loose on purpose. The contract's request is a wire shape, not a C# record, and binding these
/// tests to a DTO would (a) couple them to the implementation and (b) make it impossible to send
/// the fields a hostile or lazy caller would send — which is precisely what the
/// "a caller cannot name a model" tests need to do.
/// </summary>
public sealed class RouteRequestBuilder
{
    private readonly Dictionary<string, object?> body = new(StringComparer.Ordinal);

    private RouteRequestBuilder()
    {
    }

    /// <summary>
    /// The canonical request from <c>contracts/router-api.md</c>: multi-step retrieval synthesis
    /// under a 0.25 USD ceiling.
    /// </summary>
    public static RouteRequestBuilder Canonical() => new RouteRequestBuilder()
        .With("correlationId", Guid.NewGuid().ToString())
        .With("lane", "Research")
        .With("taskKind", "synthesize")
        .With("payload", new Dictionary<string, object?> { ["question"] = "Summarise the desk's overnight risk." })
        .With("costCeilingUsd", 0.25m)
        .With("latencyBudgetMs", 8000)
        .With("dataClassification", "Internal")
        .With("complexityHints", Hints(inputTokens: 12000, multiStep: true, retrieval: true, toolCalls: false));

    public static Dictionary<string, object?> Hints(
        int inputTokens, bool multiStep, bool retrieval, bool toolCalls) =>
        new(StringComparer.Ordinal)
        {
            ["inputTokenEstimate"] = inputTokens,
            ["requiresMultiStep"] = multiStep,
            ["requiresRetrieval"] = retrieval,
            ["requiresToolCalls"] = toolCalls,
        };

    public RouteRequestBuilder With(string field, object? value)
    {
        body[field] = value;
        return this;
    }

    public RouteRequestBuilder Without(string field)
    {
        body.Remove(field);
        return this;
    }

    public string CorrelationId => (string)body["correlationId"]!;

    public HttpContent AsContent() => new StringContent(
        JsonSerializer.Serialize(body),
        Encoding.UTF8,
        "application/json");

    public override string ToString() =>
        body.TryGetValue("taskKind", out var kind) && kind is string s
            ? string.Create(CultureInfo.InvariantCulture, $"{s}/{body.GetValueOrDefault("costCeilingUsd")}")
            : "route-request";
}
