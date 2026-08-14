namespace Fcmr.Approvals.Domain;

/// <summary>
/// A proposal awaiting, or having received, a human decision. Field names track data-model.md's
/// approvals container.
///
/// <para>
/// The type has no public constructor. An approval can only come into existence through
/// <see cref="Propose"/>, and can only change through <see cref="ApprovalStateMachine"/>. That is
/// deliberate: if callers could write <c>new Approval { State = Approved, DecidedByObjectId = me }</c>,
/// then segregation of duties would be a convention again, and a convention is exactly what this
/// control cannot be. Illegal approvals are not merely refused here; outside this assembly they
/// cannot be constructed at all.
/// </para>
/// </summary>
public sealed record Approval
{
    private Approval()
    {
    }

    public required string Id { get; init; }

    /// <summary>Spans the whole request lifecycle. Every audit record is keyed by it.</summary>
    public required string CorrelationId { get; init; }

    public required Lane Lane { get; init; }

    public required EvidencePacket EvidencePacket { get; init; }

    /// <summary>
    /// SHA-256 over the canonical form of <see cref="EvidencePacket"/>, pinned when the proposal
    /// was created. Recomputing and comparing detects a packet edited after the fact — see
    /// <see cref="VerifyEvidenceIntegrity"/>.
    /// </summary>
    public required string EvidencePacketHash { get; init; }

    /// <summary>Exposed separately because data-model.md carries it as its own field on the container.</summary>
    public ProposedAction ProposedAction => EvidencePacket.ProposedAction;

    public required ApprovalState State { get; init; }

    /// <summary>Entra object ID of the originating identity. Never null, or nothing can be segregated.</summary>
    public required string ProposedByObjectId { get; init; }

    /// <summary>Null until decided. Always null on <see cref="ApprovalState.Expired"/>.</summary>
    public string? DecidedByObjectId { get; init; }

    /// <summary>Required on rejection, optional on approval, always null on expiry.</summary>
    public string? DecisionReason { get; init; }

    public required DateTimeOffset ExpiresAt { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset? DecidedAt { get; init; }

    /// <summary>True once the approval can no longer change. All three terminal states are final.</summary>
    public bool IsTerminal => State is not ApprovalState.PendingApproval;

    /// <summary>
    /// Whether expiresAt has passed, according to the injected clock.
    ///
    /// Note what this is not: it is not a state change, and it never becomes one on its own. A
    /// proposal past its expiry is refused with 410 and stays PendingApproval until the expiry job
    /// records the transition, so the fact that it expired is written down by something, rather
    /// than inferred every time somebody reads the record.
    /// </summary>
    public bool HasPassedExpiry(TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(clock);
        return clock.GetUtcNow() >= ExpiresAt;
    }

    /// <summary>
    /// Recomputes the hash of the stored packet and compares it with the hash recorded at proposal
    /// time. False means the evidence changed after the approver saw it.
    /// </summary>
    public bool VerifyEvidenceIntegrity() =>
        string.Equals(
            EvidencePacketHasher.ComputeHash(EvidencePacket),
            EvidencePacketHash,
            StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Creates a proposal in <see cref="ApprovalState.PendingApproval"/>.
    ///
    /// The evidence packet must be supplied by the lane that actually assembled it. There is no
    /// overload that fabricates one, defaults one, or accepts a null — per ADR-007 and Principle
    /// III, evidence that does not exist is reported as missing, never manufactured to make a
    /// record well-formed.
    /// </summary>
    public static ApprovalProposalResult Propose(
        string id,
        Lane lane,
        EvidencePacket evidencePacket,
        string proposedByObjectId,
        DateTimeOffset expiresAt,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(evidencePacket);
        ArgumentNullException.ThrowIfNull(clock);

        var correlationId = evidencePacket.CorrelationId;

        if (string.IsNullOrWhiteSpace(correlationId))
        {
            return ApprovalProposalResult.Refused(new ApprovalRefusal
            {
                Kind = ApprovalRefusalKind.CorrelationIdRequired,
                CorrelationId = string.Empty,
                ApprovalId = id,
                Reason =
                    "The evidence packet carries no correlationId. The audit trail is keyed by it, so a " +
                    "proposal without one could not be reconstructed and is refused at creation.",
            });
        }

        if (string.IsNullOrWhiteSpace(proposedByObjectId))
        {
            return ApprovalProposalResult.Refused(new ApprovalRefusal
            {
                Kind = ApprovalRefusalKind.ProposerIdentityRequired,
                CorrelationId = correlationId,
                ApprovalId = id,
                Reason =
                    "The proposal names no proposing identity. Segregation of duties compares the approver " +
                    "against the proposer, and that comparison is meaningless without one.",
            });
        }

        var createdAt = clock.GetUtcNow();

        if (expiresAt <= createdAt)
        {
            return ApprovalProposalResult.Refused(new ApprovalRefusal
            {
                Kind = ApprovalRefusalKind.ExpiryNotInFuture,
                CorrelationId = correlationId,
                ApprovalId = id,
                Reason =
                    "expiresAt is not later than the creation time, so the proposal would be unapprovable " +
                    "from the moment it existed. That is a trap for the approver, not a control.",
            });
        }

        var approval = new Approval
        {
            Id = id,
            CorrelationId = correlationId,
            Lane = lane,
            EvidencePacket = evidencePacket,
            EvidencePacketHash = EvidencePacketHasher.ComputeHash(evidencePacket),
            State = ApprovalState.PendingApproval,
            ProposedByObjectId = proposedByObjectId,
            ExpiresAt = expiresAt,
            CreatedAt = createdAt,
        };

        var auditEvent = new ApprovalAuditEvent
        {
            EventType = ApprovalAuditEventType.ApprovalRequested,
            CorrelationId = correlationId,
            ApprovalId = approval.Id,
            ActorObjectId = proposedByObjectId,
            ResultingState = ApprovalState.PendingApproval,
            OccurredAt = createdAt,
            EvidencePacketHash = approval.EvidencePacketHash,
            Detail = $"Proposal '{approval.ProposedAction.Kind}' recorded for human approval. It does not execute until approved.",
        };

        return ApprovalProposalResult.Accepted(approval, auditEvent);
    }

    /// <summary>
    /// Reconstitutes an approval from a stored record.
    ///
    /// This is the only route by which an approval that this assembly did not author can enter the
    /// domain, and it exists because persistence is real: T-018 and T-019 must be able to read a
    /// Cosmos document back. It is therefore also the only place a contradictory record can be
    /// caught, so the checks here are structural and strict — a state that disagrees with its own
    /// fields is refused rather than materialised.
    ///
    /// <para>
    /// Note what is deliberately <em>not</em> checked here: segregation of duties and evidence
    /// integrity. Both are re-verified at <see cref="ExecutionGate"/> instead, because a stored
    /// record that violates them must remain readable in order to be reported and audited.
    /// Refusing to load it would hide the very finding somebody needs to see.
    /// </para>
    /// The hash is taken from the store as written, never recomputed — recomputing it here would
    /// silently repair a tampered packet and destroy the only tamper evidence that exists.
    /// </summary>
    public static ApprovalProposalResult Rehydrate(
        string id,
        string correlationId,
        Lane lane,
        EvidencePacket evidencePacket,
        string evidencePacketHash,
        ApprovalState state,
        string proposedByObjectId,
        string? decidedByObjectId,
        string? decisionReason,
        DateTimeOffset expiresAt,
        DateTimeOffset createdAt,
        DateTimeOffset? decidedAt)
    {
        ArgumentNullException.ThrowIfNull(evidencePacket);

        if (string.IsNullOrWhiteSpace(correlationId))
        {
            return ApprovalProposalResult.Refused(new ApprovalRefusal
            {
                Kind = ApprovalRefusalKind.CorrelationIdRequired,
                CorrelationId = string.Empty,
                ApprovalId = id,
                CurrentState = state,
                Reason = "The stored record carries no correlationId and so cannot be tied to its audit trail.",
            });
        }

        if (string.IsNullOrWhiteSpace(proposedByObjectId))
        {
            return ApprovalProposalResult.Refused(new ApprovalRefusal
            {
                Kind = ApprovalRefusalKind.ProposerIdentityRequired,
                CorrelationId = correlationId,
                ApprovalId = id,
                CurrentState = state,
                Reason = "The stored record names no proposing identity, so segregation of duties cannot be evaluated.",
            });
        }

        var inconsistency = state switch
        {
            ApprovalState.Approved when string.IsNullOrWhiteSpace(decidedByObjectId) =>
                "an Approved record names no approver",
            ApprovalState.Rejected when string.IsNullOrWhiteSpace(decidedByObjectId) =>
                "a Rejected record names no decider",
            ApprovalState.Rejected when string.IsNullOrWhiteSpace(decisionReason) =>
                "a Rejected record carries no reason, which the contract requires",
            ApprovalState.Expired when !string.IsNullOrWhiteSpace(decidedByObjectId) =>
                "an Expired record names a decider, but expiry is the absence of a decision",
            ApprovalState.PendingApproval when !string.IsNullOrWhiteSpace(decidedByObjectId) =>
                "a PendingApproval record already names a decider",
            _ when state is not ApprovalState.PendingApproval && decidedAt is null =>
                "a terminal record carries no decision time",
            _ => null,
        };

        if (inconsistency is not null)
        {
            return ApprovalProposalResult.Refused(new ApprovalRefusal
            {
                Kind = ApprovalRefusalKind.InconsistentRecord,
                CorrelationId = correlationId,
                ApprovalId = id,
                CurrentState = state,
                Reason = $"The stored approval contradicts itself: {inconsistency}. It was refused rather than acted on.",
            });
        }

        var approval = new Approval
        {
            Id = id,
            CorrelationId = correlationId,
            Lane = lane,
            EvidencePacket = evidencePacket,
            EvidencePacketHash = evidencePacketHash,
            State = state,
            ProposedByObjectId = proposedByObjectId,
            DecidedByObjectId = decidedByObjectId,
            DecisionReason = decisionReason,
            ExpiresAt = expiresAt,
            CreatedAt = createdAt,
            DecidedAt = decidedAt,
        };

        return ApprovalProposalResult.Accepted(approval, null);
    }

    public ApprovalTransitionResult Apply(ApprovalCommand command, TimeProvider clock) =>
        ApprovalStateMachine.Apply(this, command, clock);

    /// <summary>Convenience over <see cref="Apply"/>. Same rules; there is no privileged path.</summary>
    public ApprovalTransitionResult Approve(string decidedByObjectId, TimeProvider clock, string? reason = null) =>
        Apply(new ApproveCommand { DecidedByObjectId = decidedByObjectId, Reason = reason }, clock);

    public ApprovalTransitionResult Reject(string decidedByObjectId, string reason, TimeProvider clock) =>
        Apply(new RejectCommand { DecidedByObjectId = decidedByObjectId, Reason = reason }, clock);

    public ApprovalTransitionResult Expire(TimeProvider clock) => Apply(new ExpireCommand(), clock);

    /// <summary>Used only by the state machine, which is the sole author of state changes.</summary>
    internal Approval WithDecision(
        ApprovalState state,
        string? decidedByObjectId,
        string? decisionReason,
        DateTimeOffset decidedAt) =>
        this with
        {
            State = state,
            DecidedByObjectId = decidedByObjectId,
            DecisionReason = decisionReason,
            DecidedAt = decidedAt,
        };
}
