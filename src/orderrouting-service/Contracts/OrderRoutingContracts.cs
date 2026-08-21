using System.Text.Json.Serialization;
using Fcmr.OrderRouting.Domain;

namespace Fcmr.OrderRoutingService.Contracts;

/// <summary>
/// Wire shapes for the order routing lane.
///
/// These are separate from the domain records on purpose. The domain types are the tested
/// governance logic; a wire type is a caller-controlled shape that must be validated before it is
/// allowed anywhere near them. Serialising the domain records directly would make every future
/// field addition a silent contract change.
/// </summary>
public sealed record RouteProposalRequest
{
    public string? CorrelationId { get; init; }

    public required string OrderId { get; init; }
    public required string Symbol { get; init; }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public required OrderSide Side { get; init; }

    public required int Quantity { get; init; }
    public required decimal ArrivalMidPrice { get; init; }
    public decimal? LimitPrice { get; init; }

    public required IReadOnlyList<VenueQuoteDto> Quotes { get; init; }
}

public sealed record VenueQuoteDto
{
    public required string VenueCode { get; init; }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public required VenueType Type { get; init; }

    public required decimal MidPrice { get; init; }
    public required decimal Spread { get; init; }
    public required int DisplayedLiquidity { get; init; }
    public decimal FeeBps { get; init; }
}

/// <summary>A refusal, carrying the correlation id so a rejection is as traceable as a success.</summary>
public sealed record OrderRoutingError
{
    public required string Error { get; init; }
    public required string Detail { get; init; }
    public required string CorrelationId { get; init; }
    public IReadOnlyList<string>? Details { get; init; }
}

public sealed record ExecuteRouteRequest
{
    public required string ProposalId { get; init; }
    public required string CorrelationId { get; init; }

    /// <summary>
    /// The approval authorising this execution.
    ///
    /// Carried in the request rather than looked up, because this service does not own approvals —
    /// the approvals service does. What this service owns is the refusal to execute without one.
    ///
    /// Nullable, deliberately. Marking it required would make an omitted approval a model-binding
    /// 400 before the handler ever ran, and "you sent malformed JSON" is the wrong sentence for
    /// "you tried to execute an order nobody approved". The refusal has to come from the gate.
    /// </summary>
    public ApprovalDto? Approval { get; init; }
}

public sealed record ApprovalDto
{
    public required string ApprovalId { get; init; }
    public required string ApprovedBy { get; init; }
    public required DateTimeOffset ApprovedAt { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
}
