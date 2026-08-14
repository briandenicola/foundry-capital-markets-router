using System.Text.Json;
using System.Text.Json.Serialization;
using Fcmr.Router.Decisions;

namespace Fcmr.RouterService.Contracts;

/// <summary>Which demo lane raised the request. Recorded on the decision; never routed on.</summary>
public enum Lane
{
    Research,
    Surveillance,
    OrderRouting,
}

public sealed record ComplexityHintsDto
{
    public int InputTokenEstimate { get; init; }
    public bool RequiresMultiStep { get; init; }
    public bool RequiresRetrieval { get; init; }
    public bool RequiresToolCalls { get; init; }
}

/// <summary>
/// The wire shape of POST /v1/route, per contracts/router-api.md.
///
/// Note what is absent, and must stay absent: no model, vendor, deployment, or tier field.
/// Principle IV is enforced at the edge by this type having nowhere to put one, mirroring
/// <see cref="RoutingRequest"/> in the decisions assembly. A caller states what it needs done and
/// what it may spend; the exchange decides what executes it.
///
/// Every property is nullable so that a missing one is a validated 400 carrying a correlation id
/// rather than a deserialiser exception carrying nothing.
/// </summary>
public sealed record RouteRequest
{
    public string? CorrelationId { get; init; }

    public Lane? Lane { get; init; }

    public string? TaskKind { get; init; }

    /// <summary>Lane-specific and opaque to the router. Screened for smuggled model selection.</summary>
    public JsonElement? Payload { get; init; }

    public decimal? CostCeilingUsd { get; init; }

    public int? LatencyBudgetMs { get; init; }

    /// <summary>
    /// Required, and never defaulted. Omission is a 400.
    ///
    /// Not in the contract's request example, which is a gap in the contract rather than a licence
    /// to assume: <see cref="RoutingRequest.DataClassification"/> is <c>required</c> precisely
    /// because defaulting an omitted classification to Public is how Restricted data reaches a
    /// vendor governance never cleared for it.
    /// </summary>
    public DataClassification? DataClassification { get; init; }

    /// <summary>Region execution would occur in, when the policy set constrains regions.</summary>
    public string? ExecutionRegion { get; init; }

    public ComplexityHintsDto? ComplexityHints { get; init; }
}

public sealed record QualitySignalDto
{
    public required string Method { get; init; }
    public required double Score { get; init; }
}

/// <summary>
/// Measurements of the request. Fields that depend on a model call are null until one happens.
///
/// A null here states that a number was not measured. It is never a placeholder value, because a
/// plausible-looking token count on the scoreboard is indistinguishable from a real one, and the
/// scoreboard's whole job is to be believed.
/// </summary>
public sealed record RouteMetricsDto
{
    public required int LatencyMs { get; init; }
    public int? PromptTokens { get; init; }
    public int? CompletionTokens { get; init; }
    public decimal? ActualCostUsd { get; init; }
    public decimal? BaselineCostUsd { get; init; }
    public QualitySignalDto? QualitySignal { get; init; }
}

/// <summary>Whether a model actually ran, stated rather than implied. See ADR-007 and ADR-008.</summary>
public enum InferenceState
{
    /// <summary>The decision was made and recorded; no model call was attempted.</summary>
    NotInvoked,

    /// <summary>Policy or the cost ceiling ended the request before any model call.</summary>
    NotReached,
}

public sealed record InferenceStatusDto
{
    public required InferenceState State { get; init; }
    public required string Detail { get; init; }
}

public sealed record RouteResponse
{
    public required string CorrelationId { get; init; }
    public required RoutingDecision Decision { get; init; }

    /// <summary>Lane-specific output. Null whenever no model produced one.</summary>
    public JsonElement? Result { get; init; }

    public required RouteMetricsDto Metrics { get; init; }

    public required InferenceStatusDto Inference { get; init; }
}

/// <summary>
/// The 402, 403, and 503 bodies. Carries the decision when one was reached, because a denial the
/// caller cannot explain to a compliance officer is a denial that gets worked around.
/// </summary>
public sealed record RouteErrorResponse
{
    public required string CorrelationId { get; init; }
    public required string Error { get; init; }
    public required string Message { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public RoutingDecision? Decision { get; init; }

    /// <summary>Populated on 400 so the caller learns every problem at once, not one per round trip.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? Details { get; init; }
}
