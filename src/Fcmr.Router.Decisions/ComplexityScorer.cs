namespace Fcmr.Router.Decisions;

/// <summary>
/// Signals describing a task, used to derive a complexity score.
/// Supplied by the caller; never inferred from model output.
/// </summary>
public sealed record ComplexityHints
{
    public int InputTokenEstimate { get; init; }
    public bool RequiresMultiStep { get; init; }
    public bool RequiresRetrieval { get; init; }
    public bool RequiresToolCalls { get; init; }
}

/// <summary>
/// Derives a 0.0 to 1.0 complexity score from task signals.
///
/// Pure and deterministic by design: identical inputs must always produce an identical score,
/// because the demo shows the same request routing the same way on stage as it did in rehearsal.
/// </summary>
public static class ComplexityScorer
{
    // Weights sum to 1.0. Token length is the largest single factor because it correlates most
    // directly with where cheaper tiers start to degrade.
    private const double TokenWeight = 0.40;
    private const double MultiStepWeight = 0.25;
    private const double RetrievalWeight = 0.20;
    private const double ToolCallWeight = 0.15;

    /// <summary>Token count at which the length signal saturates.</summary>
    private const double TokenSaturation = 32_000.0;

    public static double Score(ComplexityHints hints)
    {
        ArgumentNullException.ThrowIfNull(hints);

        var tokens = Math.Clamp(hints.InputTokenEstimate, 0, int.MaxValue);
        var tokenSignal = Math.Min(tokens / TokenSaturation, 1.0);

        var score =
            (tokenSignal * TokenWeight) +
            (hints.RequiresMultiStep ? MultiStepWeight : 0.0) +
            (hints.RequiresRetrieval ? RetrievalWeight : 0.0) +
            (hints.RequiresToolCalls ? ToolCallWeight : 0.0);

        return Math.Round(Math.Clamp(score, 0.0, 1.0), 4);
    }

    /// <summary>The tier a score indicates, before any cost ceiling is applied.</summary>
    public static ModelTier IndicatedTier(double score) => score switch
    {
        < 0.35 => ModelTier.Economy,
        < 0.70 => ModelTier.Standard,
        _ => ModelTier.Premium,
    };
}
