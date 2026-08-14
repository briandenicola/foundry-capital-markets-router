namespace Fcmr.Approvals.Domain;

/// <summary>
/// The outcome of a proposal being created. Refusals here are malformed-input failures, not
/// governance events, so they carry no audit record; nothing happened that anyone decided.
/// </summary>
public sealed record ApprovalProposalResult
{
    public Approval? Approval { get; private init; }
    public ApprovalRefusal? Refusal { get; private init; }

    /// <summary>
    /// Non-null when a new proposal was raised. Null on rehydration, which records nothing because
    /// nothing happened — reading a record is not a governance event.
    /// </summary>
    public ApprovalAuditEvent? AuditEvent { get; private init; }

    public bool IsAccepted => Refusal is null;

    internal static ApprovalProposalResult Accepted(Approval approval, ApprovalAuditEvent? auditEvent) =>
        new() { Approval = approval, AuditEvent = auditEvent };

    internal static ApprovalProposalResult Refused(ApprovalRefusal refusal) =>
        new() { Refusal = refusal };
}

/// <summary>
/// The outcome of a transition attempt.
///
/// <see cref="AuditEvent"/> is non-null in both directions on purpose: a refused approval attempt
/// is evidence too, and "someone tried to approve their own proposal and was stopped" is precisely
/// the record a compliance reviewer wants to find. Returning the event alongside the outcome, and
/// never as a side effect, is how approval-api.md invariant 3 — record before returning — becomes
/// something the type system nags about rather than something a handler remembers.
/// </summary>
public sealed record ApprovalTransitionResult
{
    /// <summary>The new approval state. Null when the transition was refused; the prior instance is unchanged.</summary>
    public Approval? Approval { get; private init; }

    public ApprovalRefusal? Refusal { get; private init; }

    public required ApprovalAuditEvent AuditEvent { get; init; }

    public bool IsAccepted => Refusal is null;

    internal static ApprovalTransitionResult Accepted(Approval approval, ApprovalAuditEvent auditEvent) =>
        new() { Approval = approval, AuditEvent = auditEvent };

    internal static ApprovalTransitionResult Refused(ApprovalRefusal refusal, ApprovalAuditEvent auditEvent) =>
        new() { Refusal = refusal, AuditEvent = auditEvent };
}
