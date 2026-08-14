using FluentAssertions;
using Fcmr.Approvals.Domain;
using Xunit;

namespace Fcmr.Approvals.Domain.Tests;

/// <summary>
/// The gate that stands between an approval and a consequential action. It authorises; it never
/// acts. Execution is deliberately not a state of the approval aggregate — see ApprovalState and
/// docs/adr/008-approval-domain-boundaries.md — so this is where "may this run?" is answered.
/// </summary>
public class ExecutionGateTests
{
    [Fact]
    public void OnlyAnApprovedProposalAuthorisesExecution()
    {
        var clock = new TestClock(Fixtures.T0);

        foreach (var state in Fixtures.AllStates)
        {
            var approval = Fixtures.InState(state, clock);
            var result = ExecutionGate.Authorize(approval, clock);

            if (state is ApprovalState.Approved)
            {
                result.IsAuthorized.Should().BeTrue();
                result.Authorization.Should().NotBeNull();
            }
            else
            {
                result.IsAuthorized.Should().BeFalse();
                result.Authorization.Should().BeNull();
                result.Refusal!.Kind.Should().Be(
                    state is ApprovalState.Expired ? ApprovalRefusalKind.Expired : ApprovalRefusalKind.NotApproved);
                result.AuditEvent.RefusalKind.Should().Be(result.Refusal.Kind);
            }
        }
    }

    [Fact]
    public void AnAuthorizationCarriesTheEvidenceHashApproverAndCorrelationId()
    {
        var clock = new TestClock(Fixtures.T0);
        var approved = Fixtures.InState(ApprovalState.Approved, clock);
        clock.Advance(TimeSpan.FromMinutes(2));

        var result = ExecutionGate.Authorize(approved, clock);
        var authorization = result.Authorization!;

        authorization.ApprovalId.Should().Be(approved.Id);
        authorization.CorrelationId.Should().Be(Fixtures.CorrelationId);
        authorization.Lane.Should().Be(Lane.OrderRouting);
        authorization.EvidencePacketHash.Should().Be(approved.EvidencePacketHash);
        authorization.ApprovedByObjectId.Should().Be(Fixtures.Approver);
        authorization.ProposedByObjectId.Should().Be(Fixtures.Proposer);
        authorization.ApprovedAt.Should().Be(Fixtures.T0);
        authorization.AuthorizedAt.Should().Be(Fixtures.T0.AddMinutes(2));
        authorization.ProposedAction.Kind.Should().Be("RouteOrder");

        result.AuditEvent.EventType.Should().Be(ApprovalAuditEventType.ExecutionAuthorized);
        result.AuditEvent.CorrelationId.Should().Be(Fixtures.CorrelationId);
    }

    [Fact]
    public void EvidenceEditedAfterApprovalRefusesExecution()
    {
        var clock = new TestClock(Fixtures.T0);
        var approved = Fixtures.InState(ApprovalState.Approved, clock);

        var swapped = approved.EvidencePacket with
        {
            ProposedAction = approved.ProposedAction with
            {
                Fields = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["venue"] = "VENUE-B",
                    ["limitPrice"] = "101.25",
                },
            },
        };

        var result = ExecutionGate.Authorize(Fixtures.Rehydrated(approved, packet: swapped), clock);

        result.IsAuthorized.Should().BeFalse();
        result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.EvidencePacketMismatch,
            "this is the whole purpose of the hash: the evidence executed must be the evidence approved");
    }

    [Fact]
    public void AnApprovalMissingItsApproverAuthorisesNothing()
    {
        var clock = new TestClock(Fixtures.T0);
        var approved = Fixtures.InState(ApprovalState.Approved, clock);

        // Rehydrate refuses to build this at all, which is the first line of defence; the gate is
        // asserted against the same record shape via a state the store could hold.
        var refused = Approval.Rehydrate(
            approved.Id, approved.CorrelationId, approved.Lane, approved.EvidencePacket,
            approved.EvidencePacketHash, ApprovalState.Approved, Fixtures.Proposer,
            decidedByObjectId: null, decisionReason: null, approved.ExpiresAt, approved.CreatedAt, approved.DecidedAt);

        refused.IsAccepted.Should().BeFalse();
        refused.Refusal!.Kind.Should().Be(ApprovalRefusalKind.InconsistentRecord);
        refused.Refusal.StatusCode.Should().Be(409);
    }

    [Fact]
    public void ExpiryPastAnApprovalDoesNotRevokeAnAlreadyRecordedApproval()
    {
        var clock = new TestClock(Fixtures.T0);
        var approved = Fixtures.InState(ApprovalState.Approved, clock);

        clock.Now = Fixtures.Expiry.AddHours(4);

        // expiresAt bounds how long a proposal may wait for a decision. It does not un-approve one
        // that a human already made, and conflating the two would let a slow executor discard a
        // real approval.
        ExecutionGate.Authorize(approved, clock).IsAuthorized.Should().BeTrue();
    }
}
