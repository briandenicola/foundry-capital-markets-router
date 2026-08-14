namespace Fcmr.Approvals.Domain;

/// <summary>Event types this domain emits. Subset of the auditEvents enum in data-model.md.</summary>
public enum ApprovalAuditEventType
{
    ApprovalRequested,
    ApprovalDecided,
    ApprovalExpired,

    /// <summary>A refused decision. Recorded because a refused approval attempt is itself evidence.</summary>
    ApprovalRefused,

    /// <summary>Execution authorised against an approval. Not execution itself.</summary>
    ExecutionAuthorized,
}

/// <summary>
/// The audit record a transition produces.
///
/// Every transition result carries one, accepted or refused, and it is non-null in both cases.
/// approval-api.md invariant 3 requires the record to be written <em>before</em> the call returns;
/// modelling it as part of the result rather than as a side effect means T-018 cannot return a
/// decision it forgot to record — it would have to discard the audit event deliberately, which is
/// visible in review, unlike an omission.
/// </summary>
public sealed record ApprovalAuditEvent
{
    public required ApprovalAuditEventType EventType { get; init; }
    public required string CorrelationId { get; init; }
    public required string ApprovalId { get; init; }

    /// <summary>Null for expiry, which no identity performs.</summary>
    public string? ActorObjectId { get; init; }

    public required ApprovalState ResultingState { get; init; }
    public required DateTimeOffset OccurredAt { get; init; }

    /// <summary>The packet hash in force at the time of the event. Ties the record to the evidence.</summary>
    public required string EvidencePacketHash { get; init; }

    /// <summary>Set on a refusal, null otherwise.</summary>
    public ApprovalRefusalKind? RefusalKind { get; init; }

    /// <summary>Prose for the audit reader: the decision reason, or the refusal reason.</summary>
    public required string Detail { get; init; }
}
