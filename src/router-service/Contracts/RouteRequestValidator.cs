using System.Text.Json;
using Fcmr.ServiceDefaults.Correlation;

namespace Fcmr.RouterService.Contracts;

/// <summary>
/// Validates an inbound route request before any decision is attempted.
///
/// This is transport validation only. It rejects requests the exchange cannot act on and requests
/// that try to name a model; it makes no judgement about cost, complexity, tier, or policy. Those
/// belong to Fcmr.Router.Decisions and are reached only once a request is well formed.
/// </summary>
public static class RouteRequestValidator
{
    /// <summary>
    /// Fragments that would amount to the caller choosing its own model.
    ///
    /// The request type has no such property, so the only way one arrives is inside the opaque
    /// lane payload. Principle IV says no application names a model, a vendor, or a deployment;
    /// a rule enforced only by the shape of a type that wraps a free-form JSON blob is a rule with
    /// a hole in it, and this closes it loudly rather than ignoring the field quietly.
    ///
    /// Matched as substrings of the normalised key rather than by equality, so <c>model-name</c>,
    /// <c>targetDeployment</c> and <c>azureOpenAIDeployment</c> are caught alongside <c>model</c>.
    /// ADR-009 accepts false positives as the right trade here: the cost of one is a clear error
    /// message, and the cost of a false negative is the central claim of the demo being false.
    /// </summary>
    private static readonly string[] ForbiddenPayloadKeyFragments =
    [
        "model", "deployment", "vendor", "provider", "tier", "engine", "llm",
    ];

    /// <summary>
    /// Keys that contain a forbidden fragment but do not name a model.
    ///
    /// Kept explicit and short. An allow-list that grows on request is how a substring screen
    /// becomes an equality screen one exception at a time, so anything added here needs the same
    /// justification a policy change would.
    /// </summary>
    private static readonly string[] PermittedDespiteFragment =
    [
        "modelling", "modeling", "modelled", "modeled", "remodel",
    ];

    /// <summary>
    /// Depth at which the screen stops descending and the request is refused.
    ///
    /// System.Text.Json accepts nesting to depth 64. Anything deeper than this in a lane payload
    /// is not a shape any lane produces, so refusing costs nothing real and removes the option of
    /// burying a model key below the screen.
    /// </summary>
    private const int MaxPayloadDepth = 8;

    public static IReadOnlyList<string> Validate(RouteRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var errors = new List<string>();

        if (request.Lane is null)
        {
            errors.Add("lane is required and must be one of Research, Surveillance, OrderRouting.");
        }

        if (string.IsNullOrWhiteSpace(request.TaskKind))
        {
            errors.Add("taskKind is required.");
        }

        if (request.CostCeilingUsd is null)
        {
            errors.Add("costCeilingUsd is required.");
        }
        else if (request.CostCeilingUsd <= 0m)
        {
            errors.Add("costCeilingUsd must be greater than zero.");
        }

        if (request.DataClassification is null)
        {
            errors.Add(
                "dataClassification is required and is never defaulted. Supply one of Public, " +
                "Internal, Confidential, Restricted.");
        }

        if (request.LatencyBudgetMs is <= 0)
        {
            errors.Add("latencyBudgetMs must be greater than zero when supplied.");
        }

        if (request.ComplexityHints is null)
        {
            errors.Add("complexityHints is required.");
        }
        else if (request.ComplexityHints.InputTokenEstimate < 0)
        {
            errors.Add("complexityHints.inputTokenEstimate must not be negative.");
        }

        if (request.CorrelationId is not null &&
            !CorrelationIdFormat.IsAcceptable(request.CorrelationId))
        {
            errors.Add(
                $"correlationId must be 1 to {CorrelationIdFormat.MaxLength} characters of " +
                "letters, digits, hyphen, underscore, dot, or colon.");
        }

        if (request.Payload is { } payload)
        {
            ScreenPayload(payload, depth: 0, errors);
        }

        return errors;
    }

    private static void ScreenPayload(JsonElement element, int depth, List<string> errors)
    {
        if (depth > MaxPayloadDepth)
        {
            // Refuse rather than return. A screen that quietly stops screening is worse than one
            // that is absent, because the 200 that follows reads as clearance.
            errors.Add(
                $"payload is nested deeper than {MaxPayloadDepth} levels and cannot be screened for " +
                "model selection. Flatten the payload; the router refuses what it cannot inspect.");
            return;
        }

        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (NamesAModel(property.Name))
                    {
                        errors.Add(
                            $"payload field '{property.Name}' is not permitted. Applications state what they " +
                            "need done and what they may spend; the router decides what executes it.");
                    }

                    ScreenPayload(property.Value, depth + 1, errors);
                }

                break;

            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    ScreenPayload(item, depth + 1, errors);
                }

                break;

            default:
                break;
        }
    }

    /// <summary>
    /// Whether a payload key amounts to naming a model.
    ///
    /// Separators are stripped before matching so <c>model_name</c>, <c>model-name</c> and
    /// <c>model.name</c> are one key rather than three, and matching is by substring so a
    /// forbidden fragment cannot be hidden behind a prefix or suffix.
    /// </summary>
    private static bool NamesAModel(string key)
    {
        var normalised = new string(Array.FindAll(key.ToCharArray(), char.IsAsciiLetterOrDigit))
            .ToLowerInvariant();

        if (Array.Exists(PermittedDespiteFragment, p => normalised.Contains(p, StringComparison.Ordinal)))
        {
            return false;
        }

        return Array.Exists(
            ForbiddenPayloadKeyFragments,
            f => normalised.Contains(f, StringComparison.Ordinal));
    }
}
