using FluentAssertions;
using Fcmr.Approvals.Domain;
using Xunit;

namespace Fcmr.Approvals.Domain.Tests;

/// <summary>
/// Expiry is terminal and never implies approval. The tests below try, by every route the domain
/// exposes, to turn an expiry into an approval — and each one has to fail.
/// </summary>
public class ExpiryTests
{
    [Fact]
    public void NoCommandAppliedToAnExpiredProposalEverYieldsApproved()
    {
        // Enumerated across every trigger and a spread of clock positions, because "expiry cannot
        // become approval" is the claim the audience will push hardest on, and one happy-path
        // assertion is not an answer to it.
        var clockPositions = new[]
        {
            Fixtures.T0,
            Fixtures.Expiry.AddSeconds(-1),
            Fixtures.Expiry,
            Fixtures.Expiry.AddDays(365),
        };

        foreach (var position in clockPositions)
        {
            foreach (var trigger in Fixtures.AllTriggers)
            {
                foreach (var actor in new[] { Fixtures.Approver, Fixtures.Proposer })
                {
                    var clock = new TestClock(Fixtures.T0);
                    var expired = Fixtures.InState(ApprovalState.Expired, clock);
                    clock.Now = position;

                    var result = ApprovalStateMachine.Apply(expired, Fixtures.CommandFor(trigger, actor), clock);

                    result.IsAccepted.Should().BeFalse();
                    result.Approval.Should().BeNull();
                    expired.State.Should().Be(ApprovalState.Expired);
                }
            }
        }
    }

    [Fact]
    public void ExpiryRecordsNoApproverAndNoDecisionReason()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);
        clock.Now = Fixtures.Expiry;

        var result = pending.Expire(clock);

        result.IsAccepted.Should().BeTrue();
        result.Approval!.State.Should().Be(ApprovalState.Expired);
        result.Approval.DecidedByObjectId.Should().BeNull(
            "expiry is the absence of a decision; naming an identity would put someone's object ID on a " +
            "record they had nothing to do with");
        result.Approval.DecisionReason.Should().BeNull();
        result.Approval.DecidedAt.Should().Be(Fixtures.Expiry);
        result.AuditEvent.EventType.Should().Be(ApprovalAuditEventType.ApprovalExpired);
        result.AuditEvent.ActorObjectId.Should().BeNull();
        result.AuditEvent.ResultingState.Should().Be(ApprovalState.Expired);
    }

    [Fact]
    public void ExpiryIsReachableFromPendingOnlyAndIsTerminalOnceReached()
    {
        var clock = new TestClock(Fixtures.T0);

        foreach (var state in Fixtures.AllStates)
        {
            var approval = Fixtures.InState(state, clock);
            clock.Now = Fixtures.Expiry.AddHours(1);

            var result = approval.Expire(clock);

            if (state is ApprovalState.PendingApproval)
            {
                result.IsAccepted.Should().BeTrue();
                result.Approval!.State.Should().Be(ApprovalState.Expired);
            }
            else
            {
                result.IsAccepted.Should().BeFalse();
                result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.InvalidTransition);
            }

            clock.Now = Fixtures.T0;
        }
    }

    [Fact]
    public void TheExpiryJobCannotExpireAProposalEarly()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        clock.Now = Fixtures.Expiry.AddTicks(-1);
        var early = pending.Expire(clock);

        early.IsAccepted.Should().BeFalse();
        early.Refusal!.Kind.Should().Be(ApprovalRefusalKind.NotYetExpired);

        // The boundary is inclusive: at expiresAt exactly, the proposal has expired.
        clock.Now = Fixtures.Expiry;
        pending.Expire(clock).IsAccepted.Should().BeTrue();
    }

    [Fact]
    public void ADecisionAtTheExpiryInstantIsAlreadyTooLate()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        clock.Now = Fixtures.Expiry.AddTicks(-1);
        pending.Approve(Fixtures.Approver, clock).IsAccepted.Should().BeTrue();

        clock.Now = Fixtures.Expiry;
        var atBoundary = pending.Approve(Fixtures.Approver, clock);

        atBoundary.IsAccepted.Should().BeFalse();
        atBoundary.Refusal!.Kind.Should().Be(ApprovalRefusalKind.Expired);
        atBoundary.Refusal.StatusCode.Should().Be(410);
    }

    /// <summary>
    /// A proposal past expiresAt stays PendingApproval until something records the expiry. It is
    /// refused with 410 in the meantime, so it cannot execute, but the fact of expiry is written
    /// down rather than re-derived by every reader.
    /// </summary>
    [Fact]
    public void PassingExpiryRefusesDecisionsWithoutSilentlyMutatingState()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        pending.HasPassedExpiry(clock).Should().BeFalse();

        clock.Now = Fixtures.Expiry.AddMinutes(5);

        pending.HasPassedExpiry(clock).Should().BeTrue();
        pending.State.Should().Be(ApprovalState.PendingApproval);
        ExecutionGate.Authorize(pending, clock).IsAuthorized.Should().BeFalse();
    }

    [Fact]
    public void AProposalCannotBeCreatedAlreadyExpired()
    {
        var clock = new TestClock(Fixtures.T0);

        foreach (var expiresAt in new[] { Fixtures.T0, Fixtures.T0.AddSeconds(-1) })
        {
            var result = Approval.Propose("apr-x", Lane.Research, Fixtures.Packet(), Fixtures.Proposer, expiresAt, clock);

            result.IsAccepted.Should().BeFalse();
            result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.ExpiryNotInFuture);
            result.AuditEvent.Should().BeNull();
        }
    }
}
