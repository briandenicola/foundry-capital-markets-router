using FluentAssertions;
using Fcmr.Approvals.Domain;
using Xunit;

namespace Fcmr.Approvals.Domain.Tests;

/// <summary>
/// Creation and rehydration. Between them they are the only two ways an approval can exist, which
/// is what makes the invariants above worth anything: there is no third door.
/// </summary>
public class ProposalTests
{
    [Fact]
    public void AProposalStartsPendingAndRecordsAnApprovalRequestedAuditEvent()
    {
        var clock = new TestClock(Fixtures.T0);
        var result = Approval.Propose("apr-0001", Lane.OrderRouting, Fixtures.Packet(), Fixtures.Proposer, Fixtures.Expiry, clock);

        result.IsAccepted.Should().BeTrue();
        var approval = result.Approval!;
        approval.State.Should().Be(ApprovalState.PendingApproval);
        approval.CreatedAt.Should().Be(Fixtures.T0);
        approval.DecidedAt.Should().BeNull();
        approval.DecidedByObjectId.Should().BeNull();
        approval.CorrelationId.Should().Be(Fixtures.CorrelationId);
        approval.ProposedAction.Should().BeSameAs(approval.EvidencePacket.ProposedAction);

        result.AuditEvent!.EventType.Should().Be(ApprovalAuditEventType.ApprovalRequested);
        result.AuditEvent.ActorObjectId.Should().Be(Fixtures.Proposer);
        result.AuditEvent.OccurredAt.Should().Be(Fixtures.T0);
        result.AuditEvent.EvidencePacketHash.Should().Be(approval.EvidencePacketHash);
        result.AuditEvent.RefusalKind.Should().BeNull();
    }

    [Fact]
    public void AProposalWithoutACorrelationIdIsRefused()
    {
        var clock = new TestClock(Fixtures.T0);

        foreach (var blank in new[] { "", "   " })
        {
            var result = Approval.Propose("apr-1", Lane.Research, Fixtures.Packet(blank), Fixtures.Proposer, Fixtures.Expiry, clock);

            result.IsAccepted.Should().BeFalse();
            result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.CorrelationIdRequired);
            result.Refusal.StatusCode.Should().Be(400);
        }
    }

    [Fact]
    public void AProposalWithoutAProposingIdentityIsRefused()
    {
        var clock = new TestClock(Fixtures.T0);

        var result = Approval.Propose("apr-1", Lane.Research, Fixtures.Packet(), "  ", Fixtures.Expiry, clock);

        result.IsAccepted.Should().BeFalse();
        result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.ProposerIdentityRequired);
    }

    [Fact]
    public void ProposeRefusesNullEvidenceRatherThanInventingAnEmptyPacket()
    {
        var clock = new TestClock(Fixtures.T0);

        // ADR-007 and Principle III: evidence that does not exist is reported as missing. There is
        // no overload that manufactures a packet to make a record well-formed.
        Assert.Throws<ArgumentNullException>(() =>
            Approval.Propose("apr-1", Lane.Research, null!, Fixtures.Proposer, Fixtures.Expiry, clock));
        Assert.Throws<ArgumentNullException>(() =>
            Approval.Propose("apr-1", Lane.Research, Fixtures.Packet(), Fixtures.Proposer, Fixtures.Expiry, null!));
        Assert.Throws<ArgumentNullException>(() =>
            Approval.Rehydrate("apr-1", Fixtures.CorrelationId, Lane.Research, null!, "hash",
                ApprovalState.PendingApproval, Fixtures.Proposer, null, null, Fixtures.Expiry, Fixtures.T0, null));
    }

    [Fact]
    public void RehydrationPreservesEveryStoredFieldIncludingATamperedHash()
    {
        var clock = new TestClock(Fixtures.T0);
        var approved = Fixtures.InState(ApprovalState.Approved, clock);

        var revived = Fixtures.Rehydrated(approved);
        revived.Should().Be(approved);

        // The stored hash is taken as written and never recomputed: recomputing it would silently
        // repair a tampered packet and destroy the only tamper evidence there is.
        var lying = Fixtures.Rehydrated(approved, hash: new string('a', 64));
        lying.EvidencePacketHash.Should().Be(new string('a', 64));
        lying.VerifyEvidenceIntegrity().Should().BeFalse();
    }

    [Fact]
    public void RehydrationRefusesARecordThatContradictsItself()
    {
        var clock = new TestClock(Fixtures.T0);
        var approved = Fixtures.InState(ApprovalState.Approved, clock);
        var pending = Fixtures.InState(ApprovalState.PendingApproval, clock);
        var expired = Fixtures.InState(ApprovalState.Expired, clock);

        var cases = new (string Name, ApprovalProposalResult Result)[]
        {
            ("approved with no approver", Rehydrate(approved, state: ApprovalState.Approved, decidedBy: null, decidedAt: approved.DecidedAt)),
            ("rejected with no decider", Rehydrate(approved, state: ApprovalState.Rejected, decidedBy: null, reason: "no", decidedAt: approved.DecidedAt)),
            ("rejected with no reason", Rehydrate(approved, state: ApprovalState.Rejected, decidedBy: Fixtures.Approver, reason: " ", decidedAt: approved.DecidedAt)),
            ("expired naming a decider", Rehydrate(expired, state: ApprovalState.Expired, decidedBy: Fixtures.Approver, decidedAt: expired.DecidedAt)),
            ("pending naming a decider", Rehydrate(pending, state: ApprovalState.PendingApproval, decidedBy: Fixtures.Approver, decidedAt: null)),
            ("terminal with no decision time", Rehydrate(approved, state: ApprovalState.Approved, decidedBy: Fixtures.Approver, decidedAt: null)),
        };

        foreach (var (name, result) in cases)
        {
            result.IsAccepted.Should().BeFalse(name);
            result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.InconsistentRecord, name);
        }
    }

    [Fact]
    public void RehydrationRefusesARecordMissingItsIdentityOrCorrelation()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.InState(ApprovalState.PendingApproval, clock);

        Rehydrate(pending, correlationId: " ").Refusal!.Kind.Should().Be(ApprovalRefusalKind.CorrelationIdRequired);
        Rehydrate(pending, proposedBy: " ").Refusal!.Kind.Should().Be(ApprovalRefusalKind.ProposerIdentityRequired);
    }

    private static ApprovalProposalResult Rehydrate(
        Approval source,
        string? correlationId = null,
        string? proposedBy = null,
        ApprovalState? state = null,
        string? decidedBy = null,
        string? reason = null,
        DateTimeOffset? decidedAt = null) =>
        Approval.Rehydrate(
            source.Id,
            correlationId ?? source.CorrelationId,
            source.Lane,
            source.EvidencePacket,
            source.EvidencePacketHash,
            state ?? source.State,
            proposedBy ?? source.ProposedByObjectId,
            decidedBy,
            reason,
            source.ExpiresAt,
            source.CreatedAt,
            decidedAt);
}
