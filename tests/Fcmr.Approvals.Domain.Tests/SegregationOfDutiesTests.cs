using FluentAssertions;
using Fcmr.Approvals.Domain;
using Xunit;

namespace Fcmr.Approvals.Domain.Tests;

/// <summary>
/// Realism Checklist item 6: the identity that proposes an action cannot be the identity that
/// approves it. This is the question the compliance audience asks first, and the answer has to be
/// "the model refuses it", not "the API checks it".
/// </summary>
public class SegregationOfDutiesTests
{
    [Fact]
    public void TheProposerCannotDecideTheirOwnProposal()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        foreach (var trigger in new[] { ApprovalTrigger.Approve, ApprovalTrigger.Reject })
        {
            var result = ApprovalStateMachine.Apply(pending, Fixtures.CommandFor(trigger, Fixtures.Proposer), clock);

            result.IsAccepted.Should().BeFalse();
            result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.SegregationOfDuties);
            result.Refusal.StatusCode.Should().Be(409);
            result.Approval.Should().BeNull();
            result.AuditEvent.RefusalKind.Should().Be(ApprovalRefusalKind.SegregationOfDuties);
            result.AuditEvent.ActorObjectId.Should().Be(Fixtures.Proposer, "the attempt is attributable");
        }
    }

    /// <summary>
    /// Rejecting your own proposal is refused too. Withdrawing a proposal is a different action
    /// from deciding one, and letting the proposer write themselves into decidedByObjectId breaks
    /// the invariant data-model.md states plainly: decidedByObjectId must differ from the proposer.
    /// </summary>
    [Fact]
    public void SelfRejectionIsRefusedForTheSameReasonAsSelfApproval()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        var result = pending.Reject(Fixtures.Proposer, "Changed my mind.", clock);

        result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.SegregationOfDuties);
    }

    [Theory]
    [InlineData("a1b2c3d4-11e5-4f66-8a77-b8c9d0e1f2a3")]
    [InlineData("a1b2c3d4-11e5-4f66-8a77-b8c9d0e1f2a3 ")]
    [InlineData(" a1b2c3d4-11e5-4f66-8a77-b8c9d0e1f2a3")]
    [InlineData("A1B2C3D4-11E5-4F66-8A77-B8C9D0E1F2A3")]
    public void CasingAndSurroundingWhitespaceCannotSmuggleASelfApprovalThrough(string decider)
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        var result = pending.Approve(decider, clock);

        result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.SegregationOfDuties,
            "an object ID that differs only by case or padding is the same identity, and losing this control " +
            "to letter casing would be the least defensible way to lose it");
    }

    [Fact]
    public void ASecondIdentityCanDecideAndIsRecordedAsTheDecider()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        var result = pending.Approve(Fixtures.Approver, clock);

        result.IsAccepted.Should().BeTrue();
        result.Approval!.DecidedByObjectId.Should().Be(Fixtures.Approver);
        result.Approval.ProposedByObjectId.Should().Be(Fixtures.Proposer);
        result.Approval.DecidedByObjectId.Should().NotBe(result.Approval.ProposedByObjectId);
    }

    /// <summary>
    /// The invariant is re-checked at the gate as well, because the approval crosses persistence
    /// between the decision and the action, and this assembly declines to assume that whatever
    /// wrote the record used this state machine.
    /// </summary>
    [Fact]
    public void ExecutionIsRefusedIfARecordSomehowShowsTheProposerAsTheApprover()
    {
        var clock = new TestClock(Fixtures.T0);
        var approved = Fixtures.InState(ApprovalState.Approved, clock);

        // An Approval cannot be mutated from outside this assembly, so the only way to present a
        // record whose approver equals its proposer is to rehydrate one from a store — which is
        // precisely the case the gate re-check exists for.
        var tampered = Fixtures.Rehydrated(approved, proposedBy: Fixtures.Approver);

        var result = ExecutionGate.Authorize(tampered, clock);

        result.IsAuthorized.Should().BeFalse();
        result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.SegregationOfDuties);
    }
}
