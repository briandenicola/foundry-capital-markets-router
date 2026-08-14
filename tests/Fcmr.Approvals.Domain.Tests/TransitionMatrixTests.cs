using FluentAssertions;
using Fcmr.Approvals.Domain;
using Xunit;

namespace Fcmr.Approvals.Domain.Tests;

/// <summary>
/// The whole transition table, enumerated.
///
/// The domain is four states by three triggers, and the legality of one cell — Expire from
/// PendingApproval — depends on the clock, so the clock is enumerated too: twenty-four cells, each
/// asserted against an expectation written out longhand below. Sampling would be cheaper and would
/// miss exactly the case someone adds later without thinking. This follows
/// PolicyInvariantTests.cs, which enumerates the full policy domain rather than property-testing
/// it, for the same reason: the domain is finite, so exhaustion is strictly stronger and it
/// reproduces identically on every run.
///
/// A new edge cannot be added to the machine without a cell here changing, and a cell here cannot
/// change without someone writing down what they intended.
/// </summary>
public class TransitionMatrixTests
{
    private sealed record Cell(ApprovalState State, ApprovalTrigger Trigger, bool ClockPastExpiry);

    /// <summary>Null means the transition is legal; otherwise it is the refusal expected.</summary>
    private static readonly Dictionary<Cell, ApprovalRefusalKind?> Expected = new()
    {
        // --- PendingApproval, before expiresAt: the only cells where anything is decided. ---
        [new(ApprovalState.PendingApproval, ApprovalTrigger.Approve, false)] = null,
        [new(ApprovalState.PendingApproval, ApprovalTrigger.Reject, false)] = null,
        [new(ApprovalState.PendingApproval, ApprovalTrigger.Expire, false)] = ApprovalRefusalKind.NotYetExpired,

        // --- PendingApproval, past expiresAt: decisions are too late; only expiry may be recorded. ---
        [new(ApprovalState.PendingApproval, ApprovalTrigger.Approve, true)] = ApprovalRefusalKind.Expired,
        [new(ApprovalState.PendingApproval, ApprovalTrigger.Reject, true)] = ApprovalRefusalKind.Expired,
        [new(ApprovalState.PendingApproval, ApprovalTrigger.Expire, true)] = null,

        // --- Approved: final. ---
        [new(ApprovalState.Approved, ApprovalTrigger.Approve, false)] = ApprovalRefusalKind.InvalidTransition,
        [new(ApprovalState.Approved, ApprovalTrigger.Reject, false)] = ApprovalRefusalKind.InvalidTransition,
        [new(ApprovalState.Approved, ApprovalTrigger.Expire, false)] = ApprovalRefusalKind.InvalidTransition,
        [new(ApprovalState.Approved, ApprovalTrigger.Approve, true)] = ApprovalRefusalKind.InvalidTransition,
        [new(ApprovalState.Approved, ApprovalTrigger.Reject, true)] = ApprovalRefusalKind.InvalidTransition,

        // An approved proposal whose expiresAt has since passed does not decay into Expired. The
        // decision already happened; expiry describes the absence of one.
        [new(ApprovalState.Approved, ApprovalTrigger.Expire, true)] = ApprovalRefusalKind.InvalidTransition,

        // --- Rejected: final. ---
        [new(ApprovalState.Rejected, ApprovalTrigger.Approve, false)] = ApprovalRefusalKind.InvalidTransition,
        [new(ApprovalState.Rejected, ApprovalTrigger.Reject, false)] = ApprovalRefusalKind.InvalidTransition,
        [new(ApprovalState.Rejected, ApprovalTrigger.Expire, false)] = ApprovalRefusalKind.InvalidTransition,
        [new(ApprovalState.Rejected, ApprovalTrigger.Approve, true)] = ApprovalRefusalKind.InvalidTransition,
        [new(ApprovalState.Rejected, ApprovalTrigger.Reject, true)] = ApprovalRefusalKind.InvalidTransition,
        [new(ApprovalState.Rejected, ApprovalTrigger.Expire, true)] = ApprovalRefusalKind.InvalidTransition,

        // --- Expired: final, and there is no cell in this table that leaves it. ---
        [new(ApprovalState.Expired, ApprovalTrigger.Approve, false)] = ApprovalRefusalKind.Expired,
        [new(ApprovalState.Expired, ApprovalTrigger.Reject, false)] = ApprovalRefusalKind.Expired,
        [new(ApprovalState.Expired, ApprovalTrigger.Expire, false)] = ApprovalRefusalKind.InvalidTransition,
        [new(ApprovalState.Expired, ApprovalTrigger.Approve, true)] = ApprovalRefusalKind.Expired,
        [new(ApprovalState.Expired, ApprovalTrigger.Reject, true)] = ApprovalRefusalKind.Expired,
        [new(ApprovalState.Expired, ApprovalTrigger.Expire, true)] = ApprovalRefusalKind.InvalidTransition,
    };

    private static readonly bool[] BothClockPositions = [false, true];

    [Fact]
    public void TheTableCoversEveryStateAndTriggerPair()
    {
        var cells =
            from state in Fixtures.AllStates
            from trigger in Fixtures.AllTriggers
            from pastExpiry in BothClockPositions
            select new Cell(state, trigger, pastExpiry);

        Expected.Keys.Should().BeEquivalentTo(cells, "every state, trigger, and clock position must be accounted for");
        Expected.Should().HaveCount(Fixtures.AllStates.Length * Fixtures.AllTriggers.Length * 2);
    }

    [Fact]
    public void EveryStateAndTriggerPairMatchesTheDeclaredTable()
    {
        var failures = new List<string>();

        foreach (var (cell, expectedRefusal) in Expected)
        {
            var clock = new TestClock(Fixtures.T0);
            var approval = Fixtures.InState(cell.State, clock);

            if (cell.ClockPastExpiry)
            {
                clock.Now = Fixtures.Expiry.AddSeconds(1);
            }

            var result = ApprovalStateMachine.Apply(approval, Fixtures.CommandFor(cell.Trigger), clock);

            if (expectedRefusal is null)
            {
                if (!result.IsAccepted)
                {
                    failures.Add($"{cell} expected to be legal but was refused as {result.Refusal!.Kind}");
                }
            }
            else if (result.IsAccepted)
            {
                failures.Add($"{cell} expected refusal {expectedRefusal} but the transition was accepted");
            }
            else if (result.Refusal!.Kind != expectedRefusal)
            {
                failures.Add($"{cell} expected refusal {expectedRefusal} but got {result.Refusal.Kind}");
            }
        }

        failures.Should().BeEmpty();
    }

    [Fact]
    public void ARefusedTransitionLeavesTheApprovalUntouchedAndStillProducesAnAuditRecord()
    {
        foreach (var (cell, expectedRefusal) in Expected.Where(e => e.Value is not null))
        {
            var clock = new TestClock(Fixtures.T0);
            var approval = Fixtures.InState(cell.State, clock);

            if (cell.ClockPastExpiry)
            {
                clock.Now = Fixtures.Expiry.AddSeconds(1);
            }

            var result = ApprovalStateMachine.Apply(approval, Fixtures.CommandFor(cell.Trigger), clock);

            result.Approval.Should().BeNull("a refused transition produces no new state");
            result.Refusal!.CurrentState.Should().Be(cell.State);
            result.Refusal.CorrelationId.Should().Be(Fixtures.CorrelationId);
            result.Refusal.ApprovalId.Should().Be(approval.Id);
            result.Refusal.Reason.Should().NotBeNullOrWhiteSpace();

            // A refused attempt is evidence in its own right; approval-api.md invariant 3 requires
            // it to be written before the call returns.
            result.AuditEvent.Should().NotBeNull();
            result.AuditEvent.RefusalKind.Should().Be(expectedRefusal);
            result.AuditEvent.EventType.Should().Be(ApprovalAuditEventType.ApprovalRefused);
            result.AuditEvent.ResultingState.Should().Be(cell.State, "a refusal changes nothing");
        }
    }

    [Fact]
    public void EveryAcceptedTransitionRecordsWhoDecidedWhenAndAgainstWhichEvidence()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        var approved = pending.Approve(Fixtures.Approver, clock, "Best-execution rationale is sound.");

        approved.IsAccepted.Should().BeTrue();
        approved.Approval!.State.Should().Be(ApprovalState.Approved);
        approved.Approval.DecidedByObjectId.Should().Be(Fixtures.Approver);
        approved.Approval.DecidedAt.Should().Be(Fixtures.T0);
        approved.Approval.DecisionReason.Should().Be("Best-execution rationale is sound.");
        approved.AuditEvent.EventType.Should().Be(ApprovalAuditEventType.ApprovalDecided);
        approved.AuditEvent.ActorObjectId.Should().Be(Fixtures.Approver);
        approved.AuditEvent.EvidencePacketHash.Should().Be(pending.EvidencePacketHash);
        approved.AuditEvent.CorrelationId.Should().Be(Fixtures.CorrelationId);
    }

    [Fact]
    public void RejectionRequiresAReasonAndKeepsTheProposalPendingWhenItIsMissing()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        foreach (var blank in new[] { "", "   ", "\t" })
        {
            var result = pending.Reject(Fixtures.Approver, blank, clock);

            result.IsAccepted.Should().BeFalse();
            result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.ReasonRequired);
            result.Refusal.StatusCode.Should().Be(400);
        }
    }

    [Fact]
    public void ADecisionWithoutADecidingIdentityIsRefused()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        foreach (var trigger in new[] { ApprovalTrigger.Approve, ApprovalTrigger.Reject })
        {
            var result = ApprovalStateMachine.Apply(pending, Fixtures.CommandFor(trigger, actor: "  "), clock);

            result.IsAccepted.Should().BeFalse();
            result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.ApproverIdentityRequired);
        }
    }

    [Fact]
    public void ApprovalIsOnlyTerminalOncePendingHasLeftPending()
    {
        var clock = new TestClock(Fixtures.T0);

        Fixtures.InState(ApprovalState.PendingApproval, clock).IsTerminal.Should().BeFalse();
        Fixtures.InState(ApprovalState.Approved, clock).IsTerminal.Should().BeTrue();
        Fixtures.InState(ApprovalState.Rejected, clock).IsTerminal.Should().BeTrue();
        Fixtures.InState(ApprovalState.Expired, clock).IsTerminal.Should().BeTrue();
    }

    [Fact]
    public void RefusalStatusCodesMatchTheApprovalApiContract()
    {
        static int Status(ApprovalRefusalKind kind) => new ApprovalRefusal
        {
            Kind = kind,
            Reason = "n/a",
            CorrelationId = Fixtures.CorrelationId,
        }.StatusCode;

        Status(ApprovalRefusalKind.SegregationOfDuties).Should().Be(409);
        Status(ApprovalRefusalKind.InvalidTransition).Should().Be(409);
        Status(ApprovalRefusalKind.Expired).Should().Be(410);
        Status(ApprovalRefusalKind.NotYetExpired).Should().Be(409);
        Status(ApprovalRefusalKind.EvidencePacketMismatch).Should().Be(409);
        Status(ApprovalRefusalKind.NotApproved).Should().Be(409);
        Status(ApprovalRefusalKind.ReasonRequired).Should().Be(400);
        Status(ApprovalRefusalKind.ApproverIdentityRequired).Should().Be(400);
        Status(ApprovalRefusalKind.ProposerIdentityRequired).Should().Be(400);
        Status(ApprovalRefusalKind.CorrelationIdRequired).Should().Be(400);
        Status(ApprovalRefusalKind.ExpiryNotInFuture).Should().Be(400);
        Status(ApprovalRefusalKind.InconsistentRecord).Should().Be(409);

        // Every kind is mapped deliberately, so a new one cannot inherit 400 by accident without
        // this count changing.
        Enum.GetValues<ApprovalRefusalKind>().Should().HaveCount(12);
    }

    [Fact]
    public void NullArgumentsAreRefusedLoudlyRatherThanTreatedAsAbsentEvidence()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        Assert.Throws<ArgumentNullException>(() => ApprovalStateMachine.Apply(null!, new ExpireCommand(), clock));
        Assert.Throws<ArgumentNullException>(() => ApprovalStateMachine.Apply(pending, null!, clock));
        Assert.Throws<ArgumentNullException>(() => ApprovalStateMachine.Apply(pending, new ExpireCommand(), null!));
        Assert.Throws<ArgumentNullException>(() => pending.HasPassedExpiry(null!));
        Assert.Throws<ArgumentNullException>(() => ExecutionGate.Authorize(null!, clock));
        Assert.Throws<ArgumentNullException>(() => ExecutionGate.Authorize(pending, null!));
        Assert.Throws<ArgumentNullException>(() => EvidencePacketHasher.ComputeHash(null!));
        Assert.Throws<ArgumentNullException>(() => EvidencePacketHasher.Canonicalize(null!));
    }
}
