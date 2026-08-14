namespace Fcmr.Approvals.Domain;

/// <summary>
/// A command attempted against an approval.
///
/// Sealed hierarchy so the state machine's dispatch is total and a new command cannot be added
/// without the compiler pointing at every place that must handle it.
/// </summary>
public abstract record ApprovalCommand
{
    private protected ApprovalCommand()
    {
    }

    public abstract ApprovalTrigger Trigger { get; }

    /// <summary>
    /// The identity acting. Null only for <see cref="ExpireCommand"/>, which no human performs —
    /// expiry is the absence of a decision, so attributing it to a person would be a lie in the
    /// audit trail.
    /// </summary>
    public abstract string? ActorObjectId { get; }
}

/// <summary>
/// A human approving. Segregation of duties is checked against
/// <see cref="Approval.ProposedByObjectId"/> at the moment of the transition, not by the caller.
/// </summary>
public sealed record ApproveCommand : ApprovalCommand
{
    /// <summary>Entra object ID of the approver. Must differ from the proposer.</summary>
    public required string DecidedByObjectId { get; init; }

    /// <summary>Optional on approval, required on rejection. Recorded verbatim.</summary>
    public string? Reason { get; init; }

    /// <summary>
    /// The evidence hash the approver saw, echoed back from GET /v1/approvals/{id}.
    ///
    /// Optional because contracts/approval-api.md defines no field for it; when supplied it is
    /// verified and a mismatch refuses the decision. See ADR-008 — the recommendation is that
    /// T-018 adds the echo, at which point this stops being an optional strengthening and becomes
    /// the ordinary path. Absent means no claim is made about what the approver saw, which is
    /// weaker but honest; guessing it here would defeat the entire point of the check.
    /// </summary>
    public string? AcknowledgedEvidencePacketHash { get; init; }

    public override ApprovalTrigger Trigger => ApprovalTrigger.Approve;

    public override string? ActorObjectId => DecidedByObjectId;
}

/// <summary>A human rejecting. The reason is required by the contract and enforced by the machine.</summary>
public sealed record RejectCommand : ApprovalCommand
{
    public required string DecidedByObjectId { get; init; }

    /// <summary>Required. A rejection with no reason is unreviewable.</summary>
    public required string Reason { get; init; }

    public string? AcknowledgedEvidencePacketHash { get; init; }

    public override ApprovalTrigger Trigger => ApprovalTrigger.Reject;

    public override string? ActorObjectId => DecidedByObjectId;
}

/// <summary>
/// The expiry job observing that expiresAt has passed.
///
/// Carries no identity and no reason field that could be repurposed. There is no variant of this
/// command that approves anything, and none can be added without adding an edge to the transition
/// table, which the exhaustive test would immediately fail.
/// </summary>
public sealed record ExpireCommand : ApprovalCommand
{
    public override ApprovalTrigger Trigger => ApprovalTrigger.Expire;

    public override string? ActorObjectId => null;
}
