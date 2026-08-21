using FluentAssertions;
using Fcmr.Surveillance.Domain;
using Xunit;

namespace Fcmr.Surveillance.Domain.Tests;

internal static class Fixtures
{
    public static AlertUnderTriage Alert(string id, string symbol = "ACME", string trader = "TRD-001") =>
        new()
        {
            AlertId = id,
            Timestamp = new DateTimeOffset(2026, 3, 2, 14, 30, 0, TimeSpan.Zero),
            Symbol = symbol,
            TraderId = trader,
            AlertType = "LayeringPattern",
            CommunicationIds = ["COMM-1", "COMM-2"],
            OrderIds = ["ORD-1"],
        };

    public static EvidenceItem Evidence(string artefactId = "COMM-1") =>
        new()
        {
            Kind = EvidenceKind.Communication,
            ArtefactId = artefactId,
            Excerpt = "hold off until I clear the book",
        };

    public static AlertAssessment Assessment(
        string alertId,
        decimal score,
        string rationale = "Cancel pattern immediately precedes the contra fill.",
        IReadOnlyList<EvidenceItem>? evidence = null) =>
        new()
        {
            AlertId = alertId,
            RiskScore = score,
            Rationale = rationale,
            Evidence = evidence ?? [Evidence()],
        };
}

public class TriageRankerTests
{
    [Fact]
    public void Ranks_highest_risk_first()
    {
        var batch = TriageRanker.Rank(
            [Fixtures.Alert("A-1"), Fixtures.Alert("A-2"), Fixtures.Alert("A-3")],
            [
                Fixtures.Assessment("A-1", 40m),
                Fixtures.Assessment("A-2", 90m),
                Fixtures.Assessment("A-3", 65m),
            ]);

        batch.Ranked.Select(r => r.Alert.AlertId).Should().Equal("A-2", "A-3", "A-1");
        batch.Ranked.Select(r => r.Rank).Should().Equal(1, 2, 3);
    }

    [Fact]
    public void Ties_break_on_alert_id_so_the_queue_does_not_depend_on_arrival_order()
    {
        var alerts = new[] { Fixtures.Alert("A-3"), Fixtures.Alert("A-1"), Fixtures.Alert("A-2") };
        var assessments = new[]
        {
            Fixtures.Assessment("A-3", 80m),
            Fixtures.Assessment("A-1", 80m),
            Fixtures.Assessment("A-2", 80m),
        };

        var forwards = TriageRanker.Rank(alerts, assessments);
        var backwards = TriageRanker.Rank([.. alerts.Reverse()], [.. assessments.Reverse()]);

        forwards.Ranked.Select(r => r.Alert.AlertId).Should().Equal("A-1", "A-2", "A-3");
        backwards.Ranked.Select(r => r.Alert.AlertId).Should().Equal("A-1", "A-2", "A-3");
    }

    [Fact]
    public void Ranking_a_500_alert_batch_is_reproducible_across_shuffles()
    {
        // AC-6 in miniature. Concurrent scoring returns results in whatever order they finish, so
        // the ordering has to survive arbitrary permutation of the inputs, not just reversal.
        var alerts = Enumerable.Range(1, 500)
            .Select(i => Fixtures.Alert($"ALERT-{i:D4}"))
            .ToArray();

        // Scores collide heavily on purpose: with 500 alerts scored to one decimal place, ties are
        // the normal case, and a tie is where a non-deterministic sort would actually show up.
        var assessments = alerts
            .Select((a, i) => Fixtures.Assessment(a.AlertId, (i % 20) * 5m))
            .ToArray();

        var baseline = TriageRanker.Rank(alerts, assessments);

        for (var seed = 0; seed < 5; seed++)
        {
            var rng = new Random(seed);
            var shuffledAlerts = alerts.OrderBy(_ => rng.Next()).ToArray();
            var shuffledAssessments = assessments.OrderBy(_ => rng.Next()).ToArray();

            var run = TriageRanker.Rank(shuffledAlerts, shuffledAssessments);

            run.Ranked.Select(r => r.Alert.AlertId)
                .Should().Equal(baseline.Ranked.Select(r => r.Alert.AlertId));
        }

        baseline.SubmittedCount.Should().Be(500);
        baseline.IsComplete.Should().BeTrue();
    }

    [Fact]
    public void Unscored_alerts_are_reported_not_dropped()
    {
        var batch = TriageRanker.Rank(
            [Fixtures.Alert("A-1"), Fixtures.Alert("A-2")],
            [Fixtures.Assessment("A-1", 50m)]);

        batch.Ranked.Should().ContainSingle();
        batch.Gaps.Should().ContainSingle()
            .Which.Deficiency.Should().Be(TriageDeficiency.NotScored);
        batch.SubmittedCount.Should().Be(2);
        batch.IsComplete.Should().BeFalse();
    }

    [Fact]
    public void Unscored_alerts_do_not_receive_a_placeholder_score()
    {
        var batch = TriageRanker.Rank(
            [Fixtures.Alert("A-1"), Fixtures.Alert("A-2")],
            [Fixtures.Assessment("A-1", 50m)]);

        batch.Ranked.Should().NotContain(r => r.Alert.AlertId == "A-2");
        batch.Gaps[0].Explanation.Should().Contain("A-2").And.Contain("not scored");
    }

    [Fact]
    public void An_assessment_without_a_rationale_still_ranks_but_is_flagged()
    {
        var batch = TriageRanker.Rank(
            [Fixtures.Alert("A-1")],
            [Fixtures.Assessment("A-1", 95m, rationale: "  ")]);

        batch.Ranked.Should().ContainSingle();
        batch.Ranked[0].IsComplete.Should().BeFalse();
        batch.Gaps.Should().ContainSingle()
            .Which.Deficiency.Should().Be(TriageDeficiency.MissingRationale);
        batch.IsComplete.Should().BeFalse();
    }

    [Fact]
    public void An_assessment_without_evidence_is_flagged()
    {
        var batch = TriageRanker.Rank(
            [Fixtures.Alert("A-1")],
            [Fixtures.Assessment("A-1", 95m, evidence: [])]);

        batch.Gaps.Should().ContainSingle()
            .Which.Deficiency.Should().Be(TriageDeficiency.MissingEvidence);
        batch.Ranked[0].IsComplete.Should().BeFalse();
    }

    [Fact]
    public void An_assessment_missing_both_rationale_and_evidence_reports_both()
    {
        var batch = TriageRanker.Rank(
            [Fixtures.Alert("A-1")],
            [Fixtures.Assessment("A-1", 95m, rationale: "", evidence: [])]);

        batch.Gaps.Select(g => g.Deficiency).Should().Equal(
            TriageDeficiency.MissingRationale, TriageDeficiency.MissingEvidence);
    }

    [Fact]
    public void A_retry_supersedes_the_earlier_assessment_rather_than_throwing()
    {
        var batch = TriageRanker.Rank(
            [Fixtures.Alert("A-1")],
            [Fixtures.Assessment("A-1", 10m), Fixtures.Assessment("A-1", 90m)]);

        batch.Ranked[0].Assessment.RiskScore.Should().Be(90m);
        batch.IsComplete.Should().BeTrue();
    }

    [Fact]
    public void Assessments_for_alerts_not_in_the_batch_are_ignored()
    {
        var batch = TriageRanker.Rank(
            [Fixtures.Alert("A-1")],
            [Fixtures.Assessment("A-1", 50m), Fixtures.Assessment("GHOST", 99m)]);

        batch.Ranked.Should().ContainSingle().Which.Alert.AlertId.Should().Be("A-1");
    }

    [Fact]
    public void An_empty_batch_is_complete_and_empty()
    {
        var batch = TriageRanker.Rank([], []);

        batch.Ranked.Should().BeEmpty();
        batch.Gaps.Should().BeEmpty();
        batch.IsComplete.Should().BeTrue();
    }

    [Fact]
    public void Gaps_are_ordered_deterministically()
    {
        var batch = TriageRanker.Rank(
            [Fixtures.Alert("A-9"), Fixtures.Alert("A-2"), Fixtures.Alert("A-5")],
            []);

        batch.Gaps.Select(g => g.AlertId).Should().Equal("A-2", "A-5", "A-9");
    }

    [Fact]
    public void Rank_rejects_null_inputs()
    {
        var act = () => TriageRanker.Rank(null!, []);
        act.Should().Throw<ArgumentNullException>();

        var act2 = () => TriageRanker.Rank([], null!);
        act2.Should().Throw<ArgumentNullException>();
    }
}

public class AlertAssessmentTests
{
    [Theory]
    [InlineData(-0.1)]
    [InlineData(100.1)]
    public void Risk_scores_outside_zero_to_one_hundred_are_rejected(double score)
    {
        var act = () => Fixtures.Assessment("A-1", (decimal)score);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(100)]
    public void The_bounds_themselves_are_accepted(double score)
    {
        var act = () => Fixtures.Assessment("A-1", (decimal)score);
        act.Should().NotThrow();
    }

    [Fact]
    public void Scores_are_quantised_so_near_identical_scores_become_an_explicit_tie()
    {
        Fixtures.Assessment("A-1", 72.44m).RiskScore.Should().Be(72.4m);
        Fixtures.Assessment("A-2", 72.42m).RiskScore.Should().Be(72.4m);
    }

    [Fact]
    public void Quantisation_does_not_push_a_score_out_of_range()
    {
        Fixtures.Assessment("A-1", 99.99m).RiskScore.Should().Be(100.0m);
    }

    [Fact]
    public void The_triage_view_of_an_alert_carries_no_ground_truth()
    {
        // The control is structural, so it is asserted structurally: if somebody adds a ground
        // truth field to the ranker's input type, this test is what tells them not to.
        typeof(AlertUnderTriage).GetProperties()
            .Select(p => p.Name)
            .Should().NotContain(name => name.Contains("GroundTruth", StringComparison.OrdinalIgnoreCase));
    }
}

public class TriageGapTests
{
    [Theory]
    [InlineData(TriageDeficiency.NotScored, "not scored")]
    [InlineData(TriageDeficiency.MissingRationale, "unexplained")]
    [InlineData(TriageDeficiency.MissingEvidence, "cannot be checked")]
    public void Every_deficiency_explains_itself_in_terms_a_reviewer_can_act_on(
        TriageDeficiency deficiency, string expected)
    {
        var gap = new TriageGap { AlertId = "A-7", Deficiency = deficiency };

        gap.Explanation.Should().Contain("A-7").And.Contain(expected);
    }

    [Fact]
    public void An_unrecognised_deficiency_still_names_the_alert()
    {
        // Guards the fallback arm: a deficiency added later must not produce an empty or
        // misleading explanation while somebody forgets to extend the switch.
        var gap = new TriageGap { AlertId = "A-7", Deficiency = (TriageDeficiency)999 };

        gap.Explanation.Should().Contain("A-7").And.Contain("could not be triaged");
    }
}
