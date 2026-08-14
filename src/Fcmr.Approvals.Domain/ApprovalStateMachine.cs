namespace Fcmr.Approvals.Domain;

/// <summary>
/// The approval state machine. Total over (state, trigger): every one of the twelve pairs either
/// has an edge or has a refusal with a named reason, and there is no default that quietly allows.
///
/// <para><b>Transition table</b></para>
/// <list type="table">
///   <listheader><term>State</term><description>Approve / Reject / Expire</description></listheader>
///   <item>
///     <term>PendingApproval</term>
///     <description>
///       Approve and Reject are legal, subject to the guards below. Expire is legal once
///       <c>now &gt;= expiresAt</c>, and refused as NotYetExpired before that — an expiry job that
///       could expire early is an expiry job that could suppress an approvable proposal.
///     </description>
///   </item>
///   <item>
///     <term>Approved</term>
///     <description>All three refused, InvalidTransition. A decision is final.</description>
///   </item>
///   <item>
///     <term>Rejected</term>
///     <description>All three refused, InvalidTransition. A decision is final.</description>
///   </item>
///   <item>
///     <term>Expired</term>
///     <description>
///       Approve and Reject refused with Expired (410); Expire refused with InvalidTransition,
///       since it already happened. Note what is missing: <b>there is no edge from Expired to
///       Approved.</b> Not a guarded one, not a configurable one, not one behind a flag. Expiry is
///       the recorded absence of a decision, and an absence cannot be upgraded into a decision.
///     </description>
///   </item>
/// </list>
///
/// <para><b>Guards on a decision from PendingApproval</b>, evaluated in this order:</para>
/// <list type="number">
///   <item>The deciding identity must be present — ApproverIdentityRequired, 400.</item>
///   <item>expiresAt must not have passed — Expired, 410. Checked before identity comparisons so a
///     late approver is told the honest thing: nobody approved this and nobody now can.</item>
///   <item>The decider must differ from the proposer — SegregationOfDuties, 409.</item>
///   <item>A rejection must carry a reason — ReasonRequired, 400.</item>
///   <item>The stored packet must still hash to the recorded hash, and any hash the approver
///     acknowledged must match it — EvidencePacketMismatch, 409.</item>
/// </list>
/// </summary>
public static class ApprovalStateMachine
{
    public static ApprovalTransitionResult Apply(Approval approval, ApprovalCommand command, TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(approval);
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(clock);

        var now = clock.GetUtcNow();

        return approval.State switch
        {
            ApprovalState.PendingApproval => FromPending(approval, command, now),

            ApprovalState.Expired when command.Trigger is ApprovalTrigger.Expire =>
                Refuse(approval, command, now, ApprovalRefusalKind.InvalidTransition,
                    "This proposal is already recorded as Expired. The expiry was written once and is not rewritten."),

            ApprovalState.Expired =>
                Refuse(approval, command, now, ApprovalRefusalKind.Expired,
                    $"This proposal expired at {Iso(approval.ExpiresAt)} without a decision and can never execute. " +
                    "Expiry is not approval, and there is no path from an expired proposal to an approved one."),

            // Approved and Rejected. A recorded human decision is final; a second decision would
            // make the audit trail ambiguous about which one authorised the action.
            _ => Refuse(approval, command, now, ApprovalRefusalKind.InvalidTransition,
                $"This proposal is already in the terminal state {approval.State}, decided at " +
                $"{Iso(approval.DecidedAt)}. A recorded decision is final and cannot be revisited; " +
                "a new proposal must be raised instead."),
        };
    }

    private static ApprovalTransitionResult FromPending(Approval approval, ApprovalCommand command, DateTimeOffset now)
    {
        if (command is ExpireCommand)
        {
            if (now < approval.ExpiresAt)
            {
                return Refuse(approval, command, now, ApprovalRefusalKind.NotYetExpired,
                    $"This proposal does not expire until {Iso(approval.ExpiresAt)} and is still awaiting a decision.");
            }

            var expired = approval.WithDecision(ApprovalState.Expired, null, null, now);

            return ApprovalTransitionResult.Accepted(expired, new ApprovalAuditEvent
            {
                EventType = ApprovalAuditEventType.ApprovalExpired,
                CorrelationId = approval.CorrelationId,
                ApprovalId = approval.Id,

                // No actor. Expiry is the absence of a human decision, and naming an identity here
                // would put a person's object ID on a record they had nothing to do with.
                ActorObjectId = null,
                ResultingState = ApprovalState.Expired,
                OccurredAt = now,
                EvidencePacketHash = approval.EvidencePacketHash,
                Detail =
                    $"Expired at {Iso(approval.ExpiresAt)} with no decision recorded. The proposed action " +
                    "was not approved and will not execute.",
            });
        }

        var (decidedBy, reason, acknowledgedHash, targetState) = command switch
        {
            ApproveCommand a => (a.DecidedByObjectId, a.Reason, a.AcknowledgedEvidencePacketHash, ApprovalState.Approved),
            RejectCommand r => (r.DecidedByObjectId, r.Reason, r.AcknowledgedEvidencePacketHash, ApprovalState.Rejected),
            _ => throw new NotSupportedException($"Command {command.GetType().Name} has no entry in the transition table."),
        };

        if (string.IsNullOrWhiteSpace(decidedBy))
        {
            return Refuse(approval, command, now, ApprovalRefusalKind.ApproverIdentityRequired,
                "The decision names no deciding identity. An approval whose approver cannot be named is not an approval.");
        }

        if (now >= approval.ExpiresAt)
        {
            return Refuse(approval, command, now, ApprovalRefusalKind.Expired,
                $"This proposal expired at {Iso(approval.ExpiresAt)} and can no longer be decided. It will never execute.");
        }

        if (IsSameIdentity(decidedBy, approval.ProposedByObjectId))
        {
            return Refuse(approval, command, now, ApprovalRefusalKind.SegregationOfDuties,
                "The identity deciding this proposal is the identity that raised it. Segregation of duties " +
                "requires a second person, so the decision was not recorded and the proposal remains pending.");
        }

        if (targetState is ApprovalState.Rejected && string.IsNullOrWhiteSpace(reason))
        {
            return Refuse(approval, command, now, ApprovalRefusalKind.ReasonRequired,
                "A rejection must carry a reason. A refusal nobody can account for is not reviewable.");
        }

        if (!approval.VerifyEvidenceIntegrity())
        {
            return Refuse(approval, command, now, ApprovalRefusalKind.EvidencePacketMismatch,
                "The stored evidence no longer matches the hash recorded when this proposal was raised, so " +
                "the evidence presented for decision cannot be shown to be the evidence originally assembled. " +
                "The decision was refused rather than recorded against unverifiable evidence.");
        }

        if (acknowledgedHash is not null &&
            !string.Equals(acknowledgedHash, approval.EvidencePacketHash, StringComparison.OrdinalIgnoreCase))
        {
            return Refuse(approval, command, now, ApprovalRefusalKind.EvidencePacketMismatch,
                "The evidence hash acknowledged by the approver differs from the hash on this proposal. The " +
                "approver was looking at a different version of the evidence, so the decision was not recorded.");
        }

        var trimmedReason = string.IsNullOrWhiteSpace(reason) ? null : reason;
        var decided = approval.WithDecision(targetState, decidedBy, trimmedReason, now);

        return ApprovalTransitionResult.Accepted(decided, new ApprovalAuditEvent
        {
            EventType = ApprovalAuditEventType.ApprovalDecided,
            CorrelationId = approval.CorrelationId,
            ApprovalId = approval.Id,
            ActorObjectId = decidedBy,
            ResultingState = targetState,
            OccurredAt = now,
            EvidencePacketHash = approval.EvidencePacketHash,
            Detail = trimmedReason is null
                ? $"Decision {targetState} recorded against evidence packet {approval.EvidencePacketHash}."
                : $"Decision {targetState} recorded against evidence packet {approval.EvidencePacketHash}: {trimmedReason}",
        });
    }

    /// <summary>
    /// Entra object IDs are GUIDs, and a caller that round-trips one through a token claim can
    /// change its case. Comparing ordinally would let a self-approval through on nothing more than
    /// letter casing, which is the least defensible way to lose this control.
    /// </summary>
    private static bool IsSameIdentity(string left, string right) =>
        string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);

    private static ApprovalTransitionResult Refuse(
        Approval approval,
        ApprovalCommand command,
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

        return ApprovalTransitionResult.Refused(refusal, new ApprovalAuditEvent
        {
            EventType = ApprovalAuditEventType.ApprovalRefused,
            CorrelationId = approval.CorrelationId,
            ApprovalId = approval.Id,
            ActorObjectId = command.ActorObjectId,
            ResultingState = approval.State,
            OccurredAt = now,
            EvidencePacketHash = approval.EvidencePacketHash,
            RefusalKind = kind,
            Detail = $"{command.Trigger} refused ({kind}): {reason}",
        });
    }

    private static string Iso(DateTimeOffset? instant) =>
        instant?.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ", System.Globalization.CultureInfo.InvariantCulture)
        ?? "an unrecorded time";
}
