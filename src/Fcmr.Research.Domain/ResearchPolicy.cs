namespace Fcmr.Research.Domain;

/// <summary>
/// The knobs governing how strictly synthesis is filtered.
///
/// Defaults are the strict setting. Loosening one should be a deliberate, argued change, so the
/// defaults are the ones that refuse rather than the ones that publish.
/// </summary>
public sealed record ResearchPolicy
{
    public static ResearchPolicy Default { get; } = new();

    /// <summary>
    /// When true, a chunk with an injection detection is ineligible to ground a claim.
    ///
    /// There is a genuine trade-off here and it is worth naming rather than burying. Quarantining
    /// means an attacker who can write into a legitimate source can *suppress* claims by seeding
    /// injection-shaped text into it — a denial-of-service against the answer. Not quarantining
    /// means a claim can come to rest on text an attacker authored.
    ///
    /// The default takes suppression over contamination, because a withheld claim is visible and
    /// recoverable while a contaminated one is neither, and because Principle III already commits
    /// this system to preferring refusal over an unsupportable answer.
    /// </summary>
    public bool QuarantineInjectedChunks { get; init; } = true;

    /// <summary>
    /// Minimum attribution coverage below which the synthesis is marked as failing its own bar.
    ///
    /// This does not suppress the answer — the withheld claims are already reported, and hiding a
    /// low-coverage result would defeat the purpose. It sets the threshold at which the UI is
    /// obliged to say so prominently.
    /// </summary>
    public decimal MinimumCoveragePercent { get; init; } = 80m;
}
