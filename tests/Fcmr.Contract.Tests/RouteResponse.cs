using System.Net;
using System.Text.Json;

namespace Fcmr.Contract.Tests;

/// <summary>
/// A parsed <c>POST /v1/route</c> response, read as JSON rather than deserialised into a type the
/// service also owns. Accessors return null for absent fields so a test can assert on absence
/// explicitly instead of failing with a parser exception that hides which clause was violated.
/// </summary>
public sealed class RouteResponse : IDisposable
{
    private readonly JsonDocument document;

    private RouteResponse(HttpStatusCode status, JsonDocument document, string raw)
    {
        Status = status;
        this.document = document;
        Raw = raw;
    }

    public HttpStatusCode Status { get; }

    public string Raw { get; }

    public JsonElement Root => document.RootElement;

    public static async Task<RouteResponse> ReadAsync(HttpResponseMessage response)
    {
        ArgumentNullException.ThrowIfNull(response);

        var raw = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        JsonDocument parsed;
        try
        {
            parsed = JsonDocument.Parse(string.IsNullOrWhiteSpace(raw) ? "{}" : raw);
        }
        catch (JsonException)
        {
            parsed = JsonDocument.Parse("{}");
        }

        return new RouteResponse(response.StatusCode, parsed, raw);
    }

    public string? CorrelationId => Property(Root, "correlationId")?.GetString();

    public string? Error => Property(Root, "error")?.GetString();

    public JsonElement? Decision => Property(Root, "decision");

    public string? Outcome => Decision is { } d ? Property(d, "outcome")?.GetString() : null;

    public string? SelectedDeployment
    {
        get
        {
            var value = Decision is { } d ? Property(d, "selectedDeployment") : null;
            return value is null || value.Value.ValueKind == JsonValueKind.Null
                ? null
                : value.Value.GetString();
        }
    }

    public string? SelectedTier
    {
        get
        {
            var value = Decision is { } d ? Property(d, "selectedTier") : null;
            if (value is null || value.Value.ValueKind == JsonValueKind.Null)
            {
                return null;
            }

            // The wire form may be a string name or the numeric enum value; both are read here so
            // the test asserts on the contract's meaning rather than on a serialiser setting.
            return value.Value.ValueKind == JsonValueKind.Number
                ? value.Value.GetInt32().ToString(System.Globalization.CultureInfo.InvariantCulture)
                : value.Value.GetString();
        }
    }

    public string? Rationale => Decision is { } d ? Property(d, "rationale")?.GetString() : null;

    public IReadOnlyList<JsonElement> CandidateTiers => Array(Decision, "candidateTiers");

    public JsonElement? Result => Property(Root, "result");

    /// <summary>
    /// Whether the response claims a model actually ran.
    ///
    /// The published contract has no field for this, which is gap 3 in CONTRACT-FINDINGS.md: its
    /// 200 example always carries a result, and there is no contract-sanctioned way to say
    /// "routed, decision recorded, model not yet invoked". Until the contract grows one, the
    /// honest reading is that a response only claims an invocation when it reports usage that
    /// only a real call could produce.
    /// </summary>
    public bool WasModelInvoked
    {
        get
        {
            var inference = Property(Root, "inference");
            var state = inference is { } i ? Property(i, "state")?.GetString() : null;
            if (state is not null)
            {
                return string.Equals(state, "Invoked", StringComparison.OrdinalIgnoreCase) ||
                       string.Equals(state, "Succeeded", StringComparison.OrdinalIgnoreCase);
            }

            var metrics = Property(Root, "metrics");
            var tokens = metrics is { } m ? Property(m, "promptTokens") : null;
            return tokens is not null && tokens.Value.ValueKind == JsonValueKind.Number;
        }
    }

    public IReadOnlyList<JsonElement> PolicyExclusions => Array(Decision, "policyExclusions");

    public IReadOnlyList<string> DeploymentsMentioned
    {
        get
        {
            var names = new List<string>();
            Walk(Root, names);
            return names;
        }
    }

    public void Dispose() => document.Dispose();

    private static void Walk(JsonElement element, List<string> names)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (property.Value.ValueKind == JsonValueKind.String &&
                        property.NameEquals("deployment"))
                    {
                        names.Add(property.Value.GetString()!);
                    }

                    Walk(property.Value, names);
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    Walk(item, names);
                }

                break;
            default:
                break;
        }
    }

    private static List<JsonElement> Array(JsonElement? owner, string name)
    {
        if (owner is not { } element)
        {
            return [];
        }

        var value = Property(element, name);
        return value is null || value.Value.ValueKind != JsonValueKind.Array
            ? []
            : value.Value.EnumerateArray().ToList();
    }

    private static JsonElement? Property(JsonElement owner, string name)
    {
        if (owner.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var property in owner.EnumerateObject())
        {
            // Case-insensitive because the contract publishes camelCase but a handler that
            // serialises PascalCase is a serialisation defect, not a contract violation worth
            // failing every unrelated assertion over. The casing itself is asserted once, in
            // RouteWireShapeTests.
            if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                return property.Value;
            }
        }

        return null;
    }
}
