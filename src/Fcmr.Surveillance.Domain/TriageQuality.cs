using System.Globalization;

namespace Fcmr.Surveillance.Domain;

/// <summary>
/// Measured triage quality at a review depth, computed against seeded ground truth.
///
/// Ground truth arrives here as an explicit, separate argument rather than as a field on
/// <see cref="AlertUnderTriage"/>. That is the whole design: the ranker structurally cannot read
/// the answer key, and the join happens once, visibly, in the scoreboard path.
/// </summary>
public sealed record TriageQualityReport
{
    /// <summary>Queue depth the metrics were computed at.</summary>
    public required int ReviewDepth { get; init; }

    /// <summary>Alerts actually examined — the smaller of the depth and the queue length.</summary>
    public required int Examined { get; init; }

    /// <summary>Genuinely concerning alerts inside the review depth.</summary>
    public required int TruePositives { get; init; }

    /// <summary>
    /// Genuinely concerning alerts among those actually submitted to triage.
    ///
    /// Restricted to the batch rather than counting every id handed in, so that a caller passing a
    /// corpus-wide answer key cannot inflate the recall denominator with alerts triage was never
    /// shown. Concerning alerts that were submitted but went <b>unscored</b> stay in this
    /// denominator: failing to score an alert is a miss, and a metric that quietly excused it
    /// would reward the failure.
    /// </summary>
    public required int ConcerningInBatch { get; init; }

    /// <summary>
    /// Share of reviewed alerts that were genuinely concerning, 0–100, or <c>null</c> when
    /// nothing was reviewed.
    ///
    /// Null rather than 100 for an empty review, on the same reasoning as the research lane's
    /// attribution coverage: a vacuous perfect score is the most reassuring number on the slide
    /// and it means nothing happened.
    /// </summary>
    public decimal? PrecisionPercent => Examined == 0
        ? null
        : Truncate(TruePositives * 100m / Examined);

    /// <summary>
    /// Share of the batch's concerning alerts caught inside the review depth, 0–100, or
    /// <c>null</c> when the batch contained none to catch.
    /// </summary>
    public decimal? RecallPercent => ConcerningInBatch == 0
        ? null
        : Truncate(TruePositives * 100m / ConcerningInBatch);

    /// <summary>
    /// A one-line claim safe to say out loud, with the denominators in it.
    ///
    /// The denominators are not decoration. "94% precision" over a review depth of 16 is a
    /// different statement from the same number over 200, and an audience that does surveillance
    /// for a living will ask.
    /// </summary>
    public string Headline
    {
        get
        {
            if (PrecisionPercent is null)
            {
                return "No alerts reviewed; no triage quality can be claimed.";
            }

            var recall = RecallPercent is null
                ? "."
                : string.Create(CultureInfo.InvariantCulture, $" ({RecallPercent:N1}% recall).");

            return string.Create(
                CultureInfo.InvariantCulture,
                $"Of the top {Examined} ranked alerts, {TruePositives} were genuinely concerning " +
                $"({PrecisionPercent:N1}% precision), covering {TruePositives} of " +
                $"{ConcerningInBatch} concerning alerts in the batch{recall}");
        }
    }

    private static decimal Truncate(decimal value) =>
        Math.Round(value, 1, MidpointRounding.ToZero);
}

/// <summary>
/// Measures how good the ranking actually was, using the seeded answer key.
///
/// This exists so the demo can state a measured number instead of asserting a good one. It is a
/// measurement over synthetic data with planted ground truth, which makes it a statement about
/// this corpus and nothing else — it is not evidence the approach generalises to real alerts.
/// </summary>
public static class TriageQuality
{
    /// <summary>
    /// Computes precision and recall at a review depth.
    ///
    /// Truncation rather than rounding, matching the research lane: 2 of 3 reports as 66.6%, never
    /// 66.7%. Rounding a quality metric upward in front of a compliance audience is a small lie
    /// that costs more than the tenth of a point is worth.
    /// </summary>
    /// <param name="batch">The ranked queue.</param>
    /// <param name="concerningAlertIds">
    /// Ids of alerts the fixture planted as genuinely concerning. Supplied separately so the
    /// ranker never has access to it.
    /// </param>
    /// <param name="reviewDepth">How far down the queue a reviewer would realistically get.</param>
    public static TriageQualityReport Measure(
        TriageBatch batch,
        IReadOnlyCollection<string> concerningAlertIds,
        int reviewDepth)
    {
        ArgumentNullException.ThrowIfNull(batch);
        ArgumentNullException.ThrowIfNull(concerningAlertIds);
        ArgumentOutOfRangeException.ThrowIfNegative(reviewDepth);

        var concerning = new HashSet<string>(concerningAlertIds, StringComparer.Ordinal);

        var submitted = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in batch.Ranked)
        {
            submitted.Add(row.Alert.AlertId);
        }

        foreach (var gap in batch.Gaps)
        {
            submitted.Add(gap.AlertId);
        }

        concerning.IntersectWith(submitted);

        var examined = Math.Min(reviewDepth, batch.Ranked.Count);
        var truePositives = 0;
        for (var i = 0; i < examined; i++)
        {
            if (concerning.Contains(batch.Ranked[i].Alert.AlertId))
            {
                truePositives++;
            }
        }

        return new TriageQualityReport
        {
            ReviewDepth = reviewDepth,
            Examined = examined,
            TruePositives = truePositives,
            ConcerningInBatch = concerning.Count,
        };
    }
}
