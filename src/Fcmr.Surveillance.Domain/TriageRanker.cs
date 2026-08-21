namespace Fcmr.Surveillance.Domain;

/// <summary>Why an alert failed to meet the AC-6 bar of rank, rationale, and evidence.</summary>
public enum TriageDeficiency
{
    /// <summary>No assessment was returned for this alert at all.</summary>
    NotScored,

    /// <summary>An assessment exists but carries no rationale.</summary>
    MissingRationale,

    /// <summary>An assessment exists but cites no evidence.</summary>
    MissingEvidence,
}

/// <summary>An alert that did not receive a complete assessment, and why.</summary>
public sealed record TriageGap
{
    public required string AlertId { get; init; }
    public required TriageDeficiency Deficiency { get; init; }

    public string Explanation => Deficiency switch
    {
        TriageDeficiency.NotScored =>
            $"Alert {AlertId} was not scored; it has no risk rank, rationale, or evidence.",
        TriageDeficiency.MissingRationale =>
            $"Alert {AlertId} was scored but no rationale was returned; the rank is unexplained.",
        TriageDeficiency.MissingEvidence =>
            $"Alert {AlertId} was scored but cites no evidence; the rationale cannot be checked.",
        _ => $"Alert {AlertId} could not be triaged.",
    };
}

/// <summary>One alert in its final queue position.</summary>
public sealed record RankedAlert
{
    /// <summary>1-based position in the queue.</summary>
    public required int Rank { get; init; }

    public required AlertUnderTriage Alert { get; init; }
    public required AlertAssessment Assessment { get; init; }

    /// <summary>
    /// True when this row satisfies AC-6 on its own terms: a rank, a rationale, and an evidence
    /// set. A ranked row can still be deficient — see <see cref="TriageBatch.Gaps"/>.
    /// </summary>
    public bool IsComplete =>
        !string.IsNullOrWhiteSpace(Assessment.Rationale) && Assessment.Evidence.Count > 0;
}

/// <summary>The ranked queue plus an honest account of what is missing from it.</summary>
public sealed record TriageBatch
{
    public required IReadOnlyList<RankedAlert> Ranked { get; init; }

    /// <summary>Alerts that did not meet the AC-6 bar, with the reason for each.</summary>
    public required IReadOnlyList<TriageGap> Gaps { get; init; }

    /// <summary>Total alerts submitted, whether or not they were successfully assessed.</summary>
    public required int SubmittedCount { get; init; }

    /// <summary>
    /// True only when every submitted alert has a rank, a rationale, and an evidence set.
    ///
    /// This is surfaced rather than assumed because a partially-scored batch presented as a
    /// finished queue is the failure mode that matters here: the alerts a model silently failed on
    /// are not randomly distributed, and the interesting ones are the ones most likely to be
    /// missing.
    /// </summary>
    public bool IsComplete => Gaps.Count == 0 && Ranked.Count == SubmittedCount;
}

/// <summary>
/// Turns model-produced scores into a queue position.
///
/// This is the whole point of the assembly. Per T-027e, <b>ranking is applied by deterministic
/// code from model-produced scores</b> — the model judges, the code orders. Asking a model to
/// return an ordered list instead would make AC-6's reproducibility claim untestable, because
/// nothing would pin the order of two alerts the model considers equally risky.
/// </summary>
public static class TriageRanker
{
    /// <summary>
    /// Ranks a batch. Highest risk first; ties broken by alert id, ordinal ascending.
    ///
    /// The tie-break is not cosmetic. In a 500-alert batch scored to one decimal place, ties are
    /// common, and without a total order the queue would depend on the order results happened to
    /// come back from a set of concurrent calls. That is precisely the non-determinism the
    /// bounded-parallelism scoring in T-027e introduces, so the ordering has to be immune to it.
    ///
    /// Alerts with no assessment are reported in <see cref="TriageBatch.Gaps"/> rather than
    /// dropped or given a placeholder score. A fabricated score would put an unexamined alert at a
    /// defensible-looking position in the queue, which is worse than an obviously missing one.
    /// </summary>
    public static TriageBatch Rank(
        IReadOnlyList<AlertUnderTriage> alerts,
        IReadOnlyList<AlertAssessment> assessments)
    {
        ArgumentNullException.ThrowIfNull(alerts);
        ArgumentNullException.ThrowIfNull(assessments);

        var byAlertId = new Dictionary<string, AlertAssessment>(StringComparer.Ordinal);
        foreach (var assessment in assessments)
        {
            // Last write wins, deliberately: a retry that produces a second assessment for the
            // same alert should supersede the first rather than throw and lose the whole batch.
            byAlertId[assessment.AlertId] = assessment;
        }

        var gaps = new List<TriageGap>();
        var scored = new List<(AlertUnderTriage Alert, AlertAssessment Assessment)>();

        foreach (var alert in alerts)
        {
            if (!byAlertId.TryGetValue(alert.AlertId, out var assessment))
            {
                gaps.Add(new TriageGap
                {
                    AlertId = alert.AlertId,
                    Deficiency = TriageDeficiency.NotScored,
                });
                continue;
            }

            scored.Add((alert, assessment));

            if (string.IsNullOrWhiteSpace(assessment.Rationale))
            {
                gaps.Add(new TriageGap
                {
                    AlertId = alert.AlertId,
                    Deficiency = TriageDeficiency.MissingRationale,
                });
            }

            if (assessment.Evidence.Count == 0)
            {
                gaps.Add(new TriageGap
                {
                    AlertId = alert.AlertId,
                    Deficiency = TriageDeficiency.MissingEvidence,
                });
            }
        }

        var ranked = scored
            .OrderByDescending(x => x.Assessment.RiskScore)
            .ThenBy(x => x.Alert.AlertId, StringComparer.Ordinal)
            .Select((x, index) => new RankedAlert
            {
                Rank = index + 1,
                Alert = x.Alert,
                Assessment = x.Assessment,
            })
            .ToArray();

        return new TriageBatch
        {
            Ranked = ranked,
            Gaps = gaps
                .OrderBy(g => g.AlertId, StringComparer.Ordinal)
                .ThenBy(g => (int)g.Deficiency)
                .ToArray(),
            SubmittedCount = alerts.Count,
        };
    }
}
