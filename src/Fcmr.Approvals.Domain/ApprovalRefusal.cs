namespace Fcmr.Approvals.Domain;

/// <summary>
/// Why a proposal, or a decision on one, was refused.
///
/// The transport status travels with the reason for the same motive as
/// <c>PolicyValidationFailure</c> in Fcmr.Router.Decisions: contracts/approval-api.md draws a
/// deliberate line between 409 SegregationOfDuties, 409 InvalidTransition, and 410 Expired, and a
/// governance audience is told those three mean different things. Mapping them here keeps the
/// distinction from drifting away from the published contract one handler at a time.
/// </summary>
public enum ApprovalRefusalKind
{
    /// <summary>
    /// decidedByObjectId equals proposedByObjectId. 409, per the contract.
    ///
    /// Realism Checklist item 6 in the constitution is exactly this refusal, and it is enforced at
    /// the transition rather than at the edge, because a rule enforced by a caller's good manners
    /// stops being enforced the moment a second caller appears — and this system has three lanes
    /// calling in.
    /// </summary>
    SegregationOfDuties,

    /// <summary>The proposal is in a terminal state, or the trigger has no edge from this state. 409.</summary>
    InvalidTransition,

    /// <summary>
    /// The proposal passed expiresAt. 410. It will never execute.
    ///
    /// Distinct from InvalidTransition because "you are too late" and "someone already decided" are
    /// materially different answers to a compliance question, and collapsing them loses the one
    /// fact that matters most: nobody approved this.
    /// </summary>
    Expired,

    /// <summary>The expiry job asked to expire a proposal that has not reached expiresAt. 409.</summary>
    NotYetExpired,

    /// <summary>A rejection arrived without a reason. 400. The contract requires one.</summary>
    ReasonRequired,

    /// <summary>The deciding identity was absent or blank. 400. An approval with no approver is not an approval.</summary>
    ApproverIdentityRequired,

    /// <summary>The proposing identity was absent or blank. 400.</summary>
    ProposerIdentityRequired,

    /// <summary>correlationId was absent. 400. Every audit record is keyed by it, so a proposal without one is unauditable.</summary>
    CorrelationIdRequired,

    /// <summary>expiresAt is not after createdAt. 400. A proposal born expired is a trap, not a control.</summary>
    ExpiryNotInFuture,

    /// <summary>
    /// The evidence recorded against the approval does not hash to the recorded hash, or the
    /// approver acknowledged a different hash from the one on the packet. 409.
    ///
    /// This is the refusal that answers "is the evidence you approved the evidence that got
    /// executed?" with something other than an assurance.
    /// </summary>
    EvidencePacketMismatch,

    /// <summary>Execution was sought for a proposal that is not Approved. 409.</summary>
    NotApproved,

    /// <summary>
    /// A stored record could not be rehydrated because its fields contradict its state — an
    /// Approved record with no approver, an Expired one carrying a decision, and so on. 409.
    ///
    /// Rehydration is the one route by which an approval this assembly did not author can enter,
    /// so it is also the one place a contradictory record can be caught rather than acted on.
    /// </summary>
    InconsistentRecord,
}

/// <summary>
/// A refused transition, in language safe to read aloud to a governance audience.
///
/// Follows the shape of <c>PolicyExclusion</c>: a machine-readable kind for the API layer, and
/// prose that names the deciding factor. "Rejected" on its own is not an answer this audience
/// accepts, and neither is a stack trace.
/// </summary>
public sealed record ApprovalRefusal
{
    public required ApprovalRefusalKind Kind { get; init; }

    /// <summary>Human-readable, shown in the UI and written to the audit record.</summary>
    public required string Reason { get; init; }

    /// <summary>Present on every refusal, because the audit trail is keyed by it.</summary>
    public required string CorrelationId { get; init; }

    /// <summary>Null only when the refusal happened before an approval existed.</summary>
    public string? ApprovalId { get; init; }

    /// <summary>The state the approval was in when the transition was refused, if it existed.</summary>
    public ApprovalState? CurrentState { get; init; }

    /// <summary>The status contracts/approval-api.md requires for this refusal.</summary>
    public int StatusCode => Kind switch
    {
        ApprovalRefusalKind.Expired => 410,
        ApprovalRefusalKind.SegregationOfDuties => 409,
        ApprovalRefusalKind.InvalidTransition => 409,
        ApprovalRefusalKind.NotYetExpired => 409,
        ApprovalRefusalKind.EvidencePacketMismatch => 409,
        ApprovalRefusalKind.NotApproved => 409,
        ApprovalRefusalKind.InconsistentRecord => 409,
        _ => 400,
    };
}
