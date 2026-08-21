using System.Text.Json.Serialization;
using Fcmr.Surveillance.Domain;

namespace Fcmr.SurveillanceService.Contracts;

/// <summary>
/// Wire shapes for the surveillance lane.
///
/// Kept separate from the domain records so that a caller-controlled shape is validated before it
/// reaches the tested governance logic, and so a future domain field is not silently published as
/// a contract change.
///
/// Note what has no wire shape at all: ground truth. <c>AlertUnderTriage</c> omits it by design,
/// and there is deliberately no DTO field through which a caller could supply it either.
/// </summary>
public sealed record AlertDto
{
    public required string AlertId { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required string Symbol { get; init; }
    public required string TraderId { get; init; }
    public required string AlertType { get; init; }
    public IReadOnlyList<string> CommunicationIds { get; init; } = [];
    public IReadOnlyList<string> OrderIds { get; init; } = [];

    public AlertUnderTriage ToDomain() => new()
    {
        AlertId = AlertId,
        Timestamp = Timestamp,
        Symbol = Symbol,
        TraderId = TraderId,
        AlertType = AlertType,
        CommunicationIds = CommunicationIds,
        OrderIds = OrderIds,
    };
}

public sealed record EvidenceDto
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public required EvidenceKind Kind { get; init; }

    public required string ArtefactId { get; init; }
    public required string Excerpt { get; init; }

    public EvidenceItem ToDomain() => new()
    {
        Kind = Kind,
        ArtefactId = ArtefactId,
        Excerpt = Excerpt,
    };
}

public sealed record AssessmentDto
{
    public required string AlertId { get; init; }
    public required decimal RiskScore { get; init; }
    public string Rationale { get; init; } = string.Empty;
    public IReadOnlyList<EvidenceDto> Evidence { get; init; } = [];

    public AlertAssessment ToDomain() => new()
    {
        AlertId = AlertId,
        RiskScore = RiskScore,
        Rationale = Rationale,
        Evidence = [.. Evidence.Select(e => e.ToDomain())],
    };
}

public sealed record RankBatchRequest
{
    public string? CorrelationId { get; init; }
    public required IReadOnlyList<AlertDto> Alerts { get; init; }
    public IReadOnlyList<AssessmentDto>? Assessments { get; init; }
}

public sealed record DraftEscalationRequest
{
    public required int QueueRank { get; init; }
    public required AlertDto Alert { get; init; }
    public required AssessmentDto Assessment { get; init; }
}

public sealed record MemoDto
{
    public required string AlertId { get; init; }
    public required string CorrelationId { get; init; }
    public required int QueueRank { get; init; }
    public required decimal RiskScore { get; init; }
    public required string Symbol { get; init; }
    public required string TraderId { get; init; }
    public required string AlertType { get; init; }
    public required string Rationale { get; init; }
    public IReadOnlyList<EvidenceDto> Evidence { get; init; } = [];
    public required string ProposedBy { get; init; }
    public required DateTimeOffset DraftedAt { get; init; }

    public EscalationMemo ToDomain() => new()
    {
        AlertId = AlertId,
        CorrelationId = CorrelationId,
        QueueRank = QueueRank,
        RiskScore = RiskScore,
        Symbol = Symbol,
        TraderId = TraderId,
        AlertType = AlertType,
        Rationale = Rationale,
        Evidence = [.. Evidence.Select(e => e.ToDomain())],
        ProposedBy = ProposedBy,
        DraftedAt = DraftedAt,
    };
}

public sealed record EscalationApprovalDto
{
    public required string AlertId { get; init; }
    public required string CorrelationId { get; init; }
    public required string ApprovedBy { get; init; }
    public required DateTimeOffset ApprovedAt { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public required AlertState AuthorisedState { get; init; }
}

public sealed record ApplyEscalationRequest
{
    public required MemoDto Memo { get; init; }
    public required EscalationApprovalDto Approval { get; init; }
}
