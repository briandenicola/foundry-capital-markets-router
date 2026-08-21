using System.Globalization;
using FluentAssertions;
using Fcmr.Surveillance.Domain;
using Xunit;

namespace Fcmr.Surveillance.Domain.Tests;

public class TriageQualityTests
{
    private static TriageBatch Batch(params (string Id, decimal Score)[] rows) =>
        TriageRanker.Rank(
            [.. rows.Select(r => Fixtures.Alert(r.Id))],
            [.. rows.Select(r => Fixtures.Assessment(r.Id, r.Score))]);

    [Fact]
    public void Precision_counts_concerning_alerts_inside_the_review_depth()
    {
        var batch = Batch(("A-1", 90m), ("A-2", 80m), ("A-3", 70m), ("A-4", 10m));

        var report = TriageQuality.Measure(batch, ["A-1", "A-2", "A-4"], reviewDepth: 3);

        report.Examined.Should().Be(3);
        report.TruePositives.Should().Be(2);
        report.PrecisionPercent.Should().Be(66.6m);
    }

    [Fact]
    public void Precision_truncates_rather_than_rounds_up()
    {
        var batch = Batch(("A-1", 90m), ("A-2", 80m), ("A-3", 70m));

        var report = TriageQuality.Measure(batch, ["A-1", "A-2"], reviewDepth: 3);

        // 2/3 is 66.66…; rounding would present 66.7, which overstates the result.
        report.PrecisionPercent.Should().Be(66.6m);
    }

    [Fact]
    public void Recall_measures_coverage_of_the_concerning_alerts_in_the_batch()
    {
        var batch = Batch(("A-1", 90m), ("A-2", 80m), ("A-3", 70m), ("A-4", 60m));

        var report = TriageQuality.Measure(batch, ["A-1", "A-4"], reviewDepth: 2);

        report.ConcerningInBatch.Should().Be(2);
        report.TruePositives.Should().Be(1);
        report.RecallPercent.Should().Be(50.0m);
    }

    [Fact]
    public void Concerning_ids_outside_the_batch_do_not_inflate_the_recall_denominator()
    {
        var batch = Batch(("A-1", 90m), ("A-2", 80m));

        var report = TriageQuality.Measure(
            batch, ["A-1", "NOT-IN-BATCH-1", "NOT-IN-BATCH-2"], reviewDepth: 2);

        report.ConcerningInBatch.Should().Be(1);
        report.RecallPercent.Should().Be(100.0m);
    }

    [Fact]
    public void A_concerning_alert_that_went_unscored_counts_against_recall()
    {
        // Failing to score an alert is a miss. A metric that quietly excluded it would reward the
        // failure with a better number.
        var batch = TriageRanker.Rank(
            [Fixtures.Alert("A-1"), Fixtures.Alert("A-2")],
            [Fixtures.Assessment("A-1", 90m)]);

        var report = TriageQuality.Measure(batch, ["A-1", "A-2"], reviewDepth: 10);

        report.ConcerningInBatch.Should().Be(2);
        report.TruePositives.Should().Be(1);
        report.RecallPercent.Should().Be(50.0m);
    }

    [Fact]
    public void Reviewing_nothing_yields_a_null_precision_not_a_perfect_one()
    {
        var batch = Batch(("A-1", 90m));

        var report = TriageQuality.Measure(batch, ["A-1"], reviewDepth: 0);

        report.PrecisionPercent.Should().BeNull();
        report.Headline.Should().Be("No alerts reviewed; no triage quality can be claimed.");
    }

    [Fact]
    public void An_empty_queue_yields_a_null_precision()
    {
        TriageQuality.Measure(TriageRanker.Rank([], []), [], reviewDepth: 10)
            .PrecisionPercent.Should().BeNull();
    }

    [Fact]
    public void A_batch_with_nothing_concerning_yields_a_null_recall_not_a_zero()
    {
        var batch = Batch(("A-1", 90m), ("A-2", 10m));

        var report = TriageQuality.Measure(batch, [], reviewDepth: 2);

        report.RecallPercent.Should().BeNull();
        report.PrecisionPercent.Should().Be(0.0m);
        report.Headline.Should().NotContain("recall");
    }

    [Fact]
    public void Review_depth_beyond_the_queue_examines_only_what_exists()
    {
        var batch = Batch(("A-1", 90m), ("A-2", 80m));

        var report = TriageQuality.Measure(batch, ["A-1", "A-2"], reviewDepth: 500);

        report.ReviewDepth.Should().Be(500);
        report.Examined.Should().Be(2);
        report.PrecisionPercent.Should().Be(100.0m);
    }

    [Fact]
    public void The_headline_states_the_denominators_not_just_the_percentage()
    {
        var batch = Batch(("A-1", 90m), ("A-2", 80m), ("A-3", 70m), ("A-4", 60m));

        var report = TriageQuality.Measure(batch, ["A-1", "A-2", "A-4"], reviewDepth: 3);

        report.Headline.Should()
            .Contain("top 3").And
            .Contain("2 were genuinely concerning").And
            .Contain("66.6%").And
            .Contain("of 3 concerning alerts");
    }

    [Fact]
    public void The_headline_is_identical_in_every_culture()
    {
        var batch = Batch(("A-1", 90m), ("A-2", 80m), ("A-3", 70m));
        var report = TriageQuality.Measure(batch, ["A-1", "A-2"], reviewDepth: 3);

        var previous = CultureInfo.CurrentCulture;
        var rendered = new List<string>();
        try
        {
            foreach (var name in new[] { "", "de-DE", "fr-FR", "ja-JP" })
            {
                CultureInfo.CurrentCulture = new CultureInfo(name);
                rendered.Add(report.Headline);
            }
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
        }

        rendered.Distinct(StringComparer.Ordinal).Should().ContainSingle(
            "a measured quality claim must read the same on any machine");
    }

    [Fact]
    public void Measure_rejects_a_negative_review_depth()
    {
        var act = () => TriageQuality.Measure(Batch(("A-1", 90m)), [], reviewDepth: -1);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Measure_rejects_null_inputs()
    {
        var noBatch = () => TriageQuality.Measure(null!, [], 1);
        noBatch.Should().Throw<ArgumentNullException>();

        var noTruth = () => TriageQuality.Measure(Batch(("A-1", 90m)), null!, 1);
        noTruth.Should().Throw<ArgumentNullException>();
    }
}
