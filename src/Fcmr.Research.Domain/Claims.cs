namespace Fcmr.Research.Domain;

/// <summary>
/// A citation offered in support of a claim. Names a chunk that the model asserts it used.
///
/// "Asserts" is the operative word. A citation is a claim about evidence, and is not trusted until
/// <see cref="AttributionGate"/> resolves it against what was actually retrieved.
/// </summary>
public sealed record Citation
{
    public required string ChunkId { get; init; }

    /// <summary>
    /// Optional quoted span the model says it relied on. Displayed as evidence; never used to
    /// decide attributability, because the model produces it and it can be fabricated exactly as
    /// easily as the citation itself.
    /// </summary>
    public string? Quote { get; init; }
}

/// <summary>
/// One factual assertion produced by synthesis, with the citations offered for it.
///
/// Synthesis emits claims individually rather than as prose precisely so that a single
/// ungroundable assertion can be withheld without discarding the whole answer.
/// </summary>
public sealed record ResearchClaim
{
    /// <summary>Stable identifier within one synthesis, for correlating UI and audit records.</summary>
    public required string ClaimId { get; init; }

    /// <summary>The assertion itself.</summary>
    public required string Text { get; init; }

    public IReadOnlyList<Citation> Citations { get; init; } = [];
}

/// <summary>
/// Why a claim could not be published.
///
/// Categorised rather than free-text because these are materially different failures: a model that
/// cites nothing is behaving differently from one inventing chunk ids, and a compliance reviewer
/// needs to tell them apart at a glance.
/// </summary>
public enum UnattributableReason
{
    /// <summary>No citation was offered at all.</summary>
    NoCitation,

    /// <summary>
    /// A citation named a chunk that was not retrieved for this request. Usually a fabricated
    /// identifier, which is the failure mode this gate exists to catch.
    /// </summary>
    UnresolvableCitation,

    /// <summary>
    /// Every supporting chunk was quarantined by injection detection, so the claim rests entirely
    /// on text an attacker may have authored. See <see cref="ResearchPolicy.QuarantineInjectedChunks"/>.
    /// </summary>
    QuarantinedSource,
}

/// <summary>
/// A claim that was withheld, together with the reason and the offending citations.
///
/// Reported, not dropped. AC-3 requires the withheld claim to be visible: a system that silently
/// discards what it cannot support looks identical to one that had nothing to say, and the
/// difference is the entire point.
/// </summary>
public sealed record UnattributableClaim
{
    public required ResearchClaim Claim { get; init; }

    public required UnattributableReason Reason { get; init; }

    /// <summary>
    /// Chunk ids that failed to resolve, when <see cref="Reason"/> is
    /// <see cref="UnattributableReason.UnresolvableCitation"/>. Empty otherwise.
    /// </summary>
    public IReadOnlyList<string> UnresolvedChunkIds { get; init; } = [];

    /// <summary>Explanation suitable for display beside the withheld claim.</summary>
    public string Explanation => Reason switch
    {
        UnattributableReason.NoCitation =>
            "Withheld: no source was cited.",
        UnattributableReason.UnresolvableCitation =>
            $"Withheld: cited {Describe(UnresolvedChunkIds)} not present in the retrieved evidence.",
        UnattributableReason.QuarantinedSource =>
            "Withheld: every supporting source was quarantined for suspected prompt injection.",
        _ => "Withheld.",
    };

    private static string Describe(IReadOnlyList<string> ids) =>
        ids.Count == 1 ? $"source '{ids[0]}' was" : $"sources {string.Join(", ", ids)} were";
}

/// <summary>
/// A claim that resolved against real retrieved evidence and may be published.
/// </summary>
public sealed record AttributedClaim
{
    public required ResearchClaim Claim { get; init; }

    /// <summary>
    /// The chunks the surviving citations resolved to. Non-empty by construction: a claim reaches
    /// this type only because at least one citation resolved.
    /// </summary>
    public required IReadOnlyList<RetrievedChunk> SupportingChunks { get; init; }
}
