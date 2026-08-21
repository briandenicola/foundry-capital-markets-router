namespace Fcmr.Surveillance.Domain;

/// <summary>What kind of artefact an evidence item points at.</summary>
public enum EvidenceKind
{
    Communication,
    Order,
    TradeContext,
}

/// <summary>
/// One artefact supporting an assessment, with enough identity to be fetched again.
///
/// Evidence is a reference plus an excerpt, never a summary. A reviewer asked to sign an
/// escalation has to be able to read the original, and a paraphrase produced upstream is exactly
/// the thing they cannot check.
/// </summary>
public sealed record EvidenceItem
{
    public required EvidenceKind Kind { get; init; }

    /// <summary>Identifier of the underlying communication, order, or context record.</summary>
    public required string ArtefactId { get; init; }

    /// <summary>Verbatim excerpt from the artefact. Never a model paraphrase.</summary>
    public required string Excerpt { get; init; }
}

/// <summary>
/// The ranker's view of an alert.
///
/// This type deliberately does <b>not</b> carry <c>GroundTruthConcerning</c>, even though
/// <see cref="Fcmr.Demo.Data"/>'s alert record does. The fixture comment says ground truth "must
/// never be fed to a model or to the ranker"; a comment is not a control. Omitting the field means
/// the ranker cannot read it however the calling code is later rewritten, and the scoreboard has
/// to join ground truth back in by alert id as a separate, visible step.
///
/// The same reasoning as <c>OrderIntent</c>: binding lane logic to fixture types makes the
/// synthetic corpus load-bearing, and this one would also punch a hole in the measurement.
/// </summary>
public sealed record AlertUnderTriage
{
    public required string AlertId { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required string Symbol { get; init; }
    public required string TraderId { get; init; }
    public required string AlertType { get; init; }
    public required IReadOnlyList<string> CommunicationIds { get; init; }
    public required IReadOnlyList<string> OrderIds { get; init; }
}

/// <summary>
/// A model-produced judgement about one alert, before any ordering is applied.
///
/// The score is a <see cref="decimal"/> rather than a double because the ranking derived from it
/// must be reproducible. Binary floating point makes tie detection depend on accumulated
/// representation error, so two runs could order the same two alerts differently while both
/// "agreed" on the score. Scores are also quantised on construction, so a tie is a tie by
/// construction rather than by luck.
/// </summary>
public sealed record AlertAssessment
{
    private readonly decimal _riskScore;

    public required string AlertId { get; init; }

    /// <summary>
    /// Model-produced risk score, 0 to 100. Quantised to one decimal place.
    ///
    /// One decimal place is chosen because it is finer than any judgement a model is actually
    /// making here, and coarse enough that near-identical scores collapse into an explicit tie
    /// that the deterministic tie-break then resolves the same way every time.
    /// </summary>
    public required decimal RiskScore
    {
        get => _riskScore;
        init
        {
            if (value is < 0m or > 100m)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(value), value, "Risk score must be between 0 and 100 inclusive.");
            }

            _riskScore = Math.Round(value, 1, MidpointRounding.ToEven);
        }
    }

    /// <summary>Why the model scored it this way. Required; an unexplained rank fails AC-6.</summary>
    public required string Rationale { get; init; }

    /// <summary>Artefacts supporting the rationale.</summary>
    public required IReadOnlyList<EvidenceItem> Evidence { get; init; }
}
