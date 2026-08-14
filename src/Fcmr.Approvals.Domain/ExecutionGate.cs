namespace Fcmr.Approvals.Domain;

/// <summary>
/// Evidence that a specific approved proposal may now be acted upon.
///
/// This is an authorisation, not an execution and not a receipt. Nothing in this assembly can
/// execute anything; the strongest statement it can make is this record, and whatever performs the
/// action must present it. Keeping the two apart is what lets the approval aggregate stay a
/// four-state answer to one question — see the note on <see cref="ApprovalState"/> and ADR-008.
/// </summary>
public sealed record ExecutionAuthorization
{
    public required string ApprovalId { get; init; }
    public required string CorrelationId { get; init; }
    public required Lane Lane { get; init; }
    public required ProposedAction ProposedAction { get; init; }

    /// <summary>
    /// The hash of the evidence as approved, re-verified at authorisation time. This is the value
    /// that answers "is the evidence they approved the evidence that got executed?" — the executor
    /// carries it onto the execution record, and the two are compared.
    /// </summary>
    public required string EvidencePacketHash { get; init; }

    public required string ApprovedByObjectId { get; init; }
    public required string ProposedByObjectId { get; init; }
    public required DateTimeOffset ApprovedAt { get; init; }
    public required DateTimeOffset AuthorizedAt { get; init; }
}

public sealed record ExecutionAuthorizationResult
{
    public ExecutionAuthorization? Authorization { get; private init; }
    public ApprovalRefusal? Refusal { get; private init; }
    public required ApprovalAuditEvent AuditEvent { get; init; }

    public bool IsAuthorized => Refusal is null;

    internal static ExecutionAuthorizationResult Authorized(
        ExecutionAuthorization authorization,
        ApprovalAuditEvent auditEvent) =>
        new() { Authorization = authorization, AuditEvent = auditEvent };

    internal static ExecutionAuthorizationResult Refused(
        ApprovalRefusal refusal,
        ApprovalAuditEvent auditEvent) =>
        new() { Refusal = refusal, AuditEvent = auditEvent };
}

/// <summary>
/// The last gate before a consequential action.
///
/// Every check here has already been made at decision time, and every one is made again. That is
/// not belt and braces for its own sake: the approval record travels through persistence between
/// those two moments, and the whole point of the evidence hash is that we do not assume records
/// survive round-trips unaltered. Re-checking segregation of duties costs one string comparison
/// and closes the case where an approval was written by something other than this state machine.
/// </summary>
public static class ExecutionGate
{
    public static ExecutionAuthorizationResult Authorize(Approval approval, TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(approval);
        ArgumentNullException.ThrowIfNull(clock);

        var now = clock.GetUtcNow();

        if (approval.State is ApprovalState.Expired)
        {
            return Refuse(approval, now, ApprovalRefusalKind.Expired,
                "This proposal expired without a decision. Expiry is not approval, so there is nothing to execute.");
        }

        if (approval.State is not ApprovalState.Approved)
        {
            return Refuse(approval, now, ApprovalRefusalKind.NotApproved,
                $"This proposal is {approval.State}, not Approved. No consequential action executes without a " +
                "recorded human approval.");
        }

        if (string.IsNullOrWhiteSpace(approval.DecidedByObjectId))
        {
            return Refuse(approval, now, ApprovalRefusalKind.ApproverIdentityRequired,
                "The approval records no approver identity, so the approval cannot be attributed to anyone. " +
                "Execution was refused rather than performed on an unattributable authorisation.");
        }

        if (string.Equals(
                approval.DecidedByObjectId.Trim(),
                approval.ProposedByObjectId.Trim(),
                StringComparison.OrdinalIgnoreCase))
        {
            return Refuse(approval, now, ApprovalRefusalKind.SegregationOfDuties,
                "The recorded approver is the identity that raised this proposal. Segregation of duties requires " +
                "a second person, so execution was refused.");
        }

        if (!approval.VerifyEvidenceIntegrity())
        {
            return Refuse(approval, now, ApprovalRefusalKind.EvidencePacketMismatch,
                "The stored evidence does not match the hash approved, so the evidence about to be acted on cannot " +
                "be shown to be the evidence that was approved. Execution was refused.");
        }

        var authorization = new ExecutionAuthorization
        {
            ApprovalId = approval.Id,
            CorrelationId = approval.CorrelationId,
            Lane = approval.Lane,
            ProposedAction = approval.ProposedAction,
            EvidencePacketHash = approval.EvidencePacketHash,
            ApprovedByObjectId = approval.DecidedByObjectId,
            ProposedByObjectId = approval.ProposedByObjectId,
            ApprovedAt = approval.DecidedAt ?? approval.CreatedAt,
            AuthorizedAt = now,
        };

        return ExecutionAuthorizationResult.Authorized(authorization, new ApprovalAuditEvent
        {
            EventType = ApprovalAuditEventType.ExecutionAuthorized,
            CorrelationId = approval.CorrelationId,
            ApprovalId = approval.Id,
            ActorObjectId = approval.DecidedByObjectId,
            ResultingState = approval.State,
            OccurredAt = now,
            EvidencePacketHash = approval.EvidencePacketHash,
            Detail =
                $"Execution of '{approval.ProposedAction.Kind}' authorised under the approval recorded by " +
                $"{approval.DecidedByObjectId} against evidence packet {approval.EvidencePacketHash}.",
        });
    }

    private static ExecutionAuthorizationResult Refuse(
        Approval approval,
        DateTimeOffset now,
        ApprovalRefusalKind kind,
        string reason)
    {
        var refusal = new ApprovalRefusal
        {
            Kind = kind,
            Reason = reason,
            CorrelationId = approval.CorrelationId,
            ApprovalId = approval.Id,
            CurrentState = approval.State,
        };

        return ExecutionAuthorizationResult.Refused(refusal, new ApprovalAuditEvent
        {
            EventType = ApprovalAuditEventType.ApprovalRefused,
            CorrelationId = approval.CorrelationId,
            ApprovalId = approval.Id,
            ActorObjectId = approval.DecidedByObjectId,
            ResultingState = approval.State,
            OccurredAt = now,
            EvidencePacketHash = approval.EvidencePacketHash,
            RefusalKind = kind,
            Detail = $"Execution refused ({kind}): {reason}",
        });
    }
}
