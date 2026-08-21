using FluentAssertions;
using Fcmr.Surveillance.Domain;
using Xunit;

namespace Fcmr.Surveillance.Domain.Tests;

public class EscalationGateTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 2, 15, 0, 0, TimeSpan.Zero);

    private static RankedAlert Ranked(
        decimal score = 85m,
        string rationale = "Cancel pattern immediately precedes the contra fill.",
        IReadOnlyList<EvidenceItem>? evidence = null) =>
        new()
        {
            Rank = 3,
            Alert = Fixtures.Alert("A-1"),
            Assessment = Fixtures.Assessment("A-1", score, rationale, evidence),
        };

    private static EscalationMemo Memo(string proposedBy = "agent-surveillance") =>
        EscalationGate.Draft(Ranked(), EscalationPolicy.Default, "corr-1", proposedBy, Now).Memo!;

    private static EscalationAuthorization Auth(
        string approvedBy = "reviewer-hana",
        string alertId = "A-1",
        string correlationId = "corr-1",
        DateTimeOffset? expiresAt = null) =>
        new()
        {
            AlertId = alertId,
            CorrelationId = correlationId,
            ApprovedBy = approvedBy,
            ApprovedAt = Now,
            ExpiresAt = expiresAt ?? Now.AddMinutes(15),
            AuthorisedState = AlertState.Escalated,
        };

    [Fact]
    public void A_high_risk_alert_with_evidence_drafts_a_memo()
    {
        var outcome = EscalationGate.Draft(
            Ranked(), EscalationPolicy.Default, "corr-1", "agent-surveillance", Now);

        outcome.Drafted.Should().BeTrue();
        outcome.Memo!.Status.Should().Be("DRAFT");
        outcome.Memo.QueueRank.Should().Be(3);
        outcome.Memo.Evidence.Should().ContainSingle();
    }

    [Fact]
    public void The_memo_carries_evidence_verbatim_not_a_summary()
    {
        var evidence = Fixtures.Evidence();
        var memo = EscalationGate.Draft(
            Ranked(evidence: [evidence]), EscalationPolicy.Default, "corr-1", "agent", Now).Memo!;

        memo.Evidence[0].Excerpt.Should().Be(evidence.Excerpt);
    }

    [Fact]
    public void Drafting_below_the_risk_threshold_is_refused_with_the_numbers()
    {
        var outcome = EscalationGate.Draft(
            Ranked(score: 40m), EscalationPolicy.Default, "corr-1", "agent", Now);

        outcome.Drafted.Should().BeFalse();
        outcome.Refusal.Should().Be(DraftRefusalReason.BelowRiskThreshold);
        outcome.RefusalExplanation.Should().Contain("40.0").And.Contain("70.0");
    }

    [Fact]
    public void Drafting_without_a_rationale_is_refused()
    {
        var outcome = EscalationGate.Draft(
            Ranked(rationale: "   "), EscalationPolicy.Default, "corr-1", "agent", Now);

        outcome.Refusal.Should().Be(DraftRefusalReason.MissingRationale);
    }

    [Fact]
    public void Drafting_without_evidence_is_refused_so_the_approver_is_not_endorsing_a_number()
    {
        var outcome = EscalationGate.Draft(
            Ranked(evidence: []), EscalationPolicy.Default, "corr-1", "agent", Now);

        outcome.Refusal.Should().Be(DraftRefusalReason.InsufficientEvidence);
        outcome.Memo.Should().BeNull();
    }

    [Fact]
    public void An_alert_exactly_at_the_threshold_drafts()
    {
        EscalationGate.Draft(Ranked(score: 70m), EscalationPolicy.Default, "c", "a", Now)
            .Drafted.Should().BeTrue();
    }

    [Fact]
    public void An_approved_escalation_applies()
    {
        var outcome = EscalationGate.Apply(Memo(), Auth(), Now.AddMinutes(5));

        outcome.Applied.Should().BeTrue();
        outcome.Change!.NewState.Should().Be(AlertState.Escalated);
        outcome.Change.PreviousState.Should().Be(AlertState.Open);
        outcome.Change.ApprovedBy.Should().Be("reviewer-hana");
        outcome.Change.ProposedBy.Should().Be("agent-surveillance");
    }

    [Fact]
    public void The_approver_chooses_the_state_so_approval_is_not_a_blank_cheque()
    {
        var auth = Auth() with { AuthorisedState = AlertState.Dismissed };

        EscalationGate.Apply(Memo(), auth, Now.AddMinutes(5))
            .Change!.NewState.Should().Be(AlertState.Dismissed);
    }

    [Fact]
    public void An_approval_for_a_different_alert_is_refused()
    {
        var outcome = EscalationGate.Apply(Memo(), Auth(alertId: "A-99"), Now.AddMinutes(5));

        outcome.Refusal.Should().Be(EscalationRefusalReason.AlertMismatch);
        outcome.Change.Should().BeNull();
    }

    [Fact]
    public void An_approval_under_a_different_correlation_id_is_refused()
    {
        var outcome = EscalationGate.Apply(
            Memo(), Auth(correlationId: "corr-other"), Now.AddMinutes(5));

        outcome.Refusal.Should().Be(EscalationRefusalReason.CorrelationMismatch);
    }

    [Fact]
    public void An_expired_approval_is_refused_because_expiry_is_not_approval()
    {
        var outcome = EscalationGate.Apply(
            Memo(), Auth(expiresAt: Now.AddMinutes(10)), Now.AddMinutes(11));

        outcome.Refusal.Should().Be(EscalationRefusalReason.ApprovalExpired);
        outcome.RefusalExplanation.Should().Contain("Expiry is not approval");
    }

    [Fact]
    public void Expiry_is_exclusive_at_the_boundary()
    {
        var expiry = Now.AddMinutes(10);

        EscalationGate.Apply(Memo(), Auth(expiresAt: expiry), expiry)
            .Refusal.Should().Be(EscalationRefusalReason.ApprovalExpired);

        EscalationGate.Apply(Memo(), Auth(expiresAt: expiry), expiry.AddTicks(-1))
            .Applied.Should().BeTrue();
    }

    [Fact]
    public void The_proposer_cannot_approve_their_own_escalation()
    {
        var outcome = EscalationGate.Apply(
            Memo(proposedBy: "reviewer-hana"), Auth(approvedBy: "reviewer-hana"), Now.AddMinutes(5));

        outcome.Refusal.Should().Be(EscalationRefusalReason.SegregationOfDuties);
    }

    [Fact]
    public void Segregation_of_duties_is_not_defeated_by_casing()
    {
        var outcome = EscalationGate.Apply(
            Memo(proposedBy: "Reviewer-Hana"), Auth(approvedBy: "reviewer-hana"), Now.AddMinutes(5));

        outcome.Refusal.Should().Be(EscalationRefusalReason.SegregationOfDuties);
    }

    [Fact]
    public void An_expired_approval_from_the_proposer_reports_expiry_first()
    {
        // Order matters: a lapsed approval is not a valid approval whose approver is then
        // scrutinised. Reporting segregation first would imply a different approver could rescue
        // a stale approval.
        var outcome = EscalationGate.Apply(
            Memo(proposedBy: "reviewer-hana"),
            Auth(approvedBy: "reviewer-hana", expiresAt: Now.AddMinutes(1)),
            Now.AddMinutes(5));

        outcome.Refusal.Should().Be(EscalationRefusalReason.ApprovalExpired);
    }

    [Fact]
    public void Drafting_a_memo_changes_no_alert_state()
    {
        var outcome = EscalationGate.Draft(
            Ranked(), EscalationPolicy.Default, "corr-1", "agent", Now);

        // The draft path returns no AlertStateChange at all; the only type that carries one is
        // produced solely by Apply.
        outcome.Memo.Should().NotBeNull();
        typeof(DraftOutcome).GetProperties().Select(p => p.PropertyType)
            .Should().NotContain(typeof(AlertStateChange));
    }

    [Fact]
    public void Draft_rejects_a_blank_proposer_or_correlation_id()
    {
        var noCorrelation = () => EscalationGate.Draft(Ranked(), EscalationPolicy.Default, " ", "a", Now);
        noCorrelation.Should().Throw<ArgumentException>();

        var noProposer = () => EscalationGate.Draft(Ranked(), EscalationPolicy.Default, "c", " ", Now);
        noProposer.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Apply_rejects_null_inputs()
    {
        var noMemo = () => EscalationGate.Apply(null!, Auth(), Now);
        noMemo.Should().Throw<ArgumentNullException>();

        var noAuth = () => EscalationGate.Apply(Memo(), null!, Now);
        noAuth.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Draft_rejects_null_inputs()
    {
        var noRanked = () => EscalationGate.Draft(null!, EscalationPolicy.Default, "c", "a", Now);
        noRanked.Should().Throw<ArgumentNullException>();

        var noPolicy = () => EscalationGate.Draft(Ranked(), null!, "c", "a", Now);
        noPolicy.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void The_memo_summary_is_readable_and_carries_the_numbers()
    {
        Memo().Summary.Should()
            .Contain("A-1").And
            .Contain("LayeringPattern").And
            .Contain("ACME").And
            .Contain("rank 3").And
            .Contain("85.0").And
            .Contain("1 evidence item");
    }
}
