namespace Fcmr.Research.Domain;

/// <summary>
/// Attribution coverage for one synthesis, as displayed in the UI (AC-3).
/// </summary>
public sealed record AttributionCoverage
{
    public required int TotalClaims { get; init; }

    public required int AttributedClaims { get; init; }

    public int WithheldClaims => TotalClaims - AttributedClaims;

    /// <summary>
    /// Percentage of claims that resolved, to one decimal place — or <c>null</c> when the synthesis
    /// produced no claims at all.
    ///
    /// Null rather than 100. A synthesis with nothing in it is vacuously fully attributed, and
    /// rendering that as 100% would put the most reassuring number on the screen at the precise
    /// moment the system produced nothing. Callers must render "n/a" and mean it.
    /// </summary>
    public decimal? Percent => TotalClaims == 0
        ? null
        : Math.Round(AttributedClaims * 100m / TotalClaims, 1, MidpointRounding.ToZero);

    /// <summary>
    /// Whether coverage met <see cref="ResearchPolicy.MinimumCoveragePercent"/>. A synthesis with
    /// no claims does not meet the bar; it has not cleared anything.
    /// </summary>
    public bool MeetsBar(ResearchPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);
        return Percent is { } percent && percent >= policy.MinimumCoveragePercent;
    }
}

/// <summary>
/// The publishable result of a synthesis: what survived, what did not, and why.
/// </summary>
public sealed record AttributedSynthesis
{
    /// <summary>Claims that resolved against retrieved evidence. These may be published.</summary>
    public required IReadOnlyList<AttributedClaim> Claims { get; init; }

    /// <summary>Claims withheld, with reasons. Reported to the caller and rendered in the UI.</summary>
    public required IReadOnlyList<UnattributableClaim> UnattributableClaims { get; init; }

    /// <summary>Every injection attempt seen in the retrieved evidence. Logged whether or not it changed an outcome.</summary>
    public required IReadOnlyList<InjectionDetection> InjectionDetections { get; init; }

    /// <summary>Chunk ids excluded from grounding by quarantine.</summary>
    public required IReadOnlyList<string> QuarantinedChunkIds { get; init; }

    public required AttributionCoverage Coverage { get; init; }
}

/// <summary>
/// Decides which claims may be published (AC-3, Principle III).
///
/// **What this gate proves, precisely:** that every published claim cites at least one chunk that
/// was genuinely retrieved for this request, and was not quarantined. That is a real and useful
/// guarantee — it catches the fabricated citation, which is the dominant grounding failure, since
/// a model asked for citations will readily invent plausible-looking identifiers.
///
/// **What it does not prove:** that the cited chunk actually supports the claim. Semantic support
/// is a judgement, not a resolution, and no deterministic gate can establish it. A claim citing a
/// real chunk that says something else entirely passes here.
///
/// That limit is stated because the difference matters to the audience this is built for. The
/// honest description is "every claim is traceable to retrieved evidence", not "every claim is
/// true". Closing the remaining gap needs claim-level entailment checking, which is a model call
/// and therefore a routed one — it is not free, and it is not built.
/// </summary>
public static class AttributionGate
{
    /// <summary>
    /// Partitions claims into publishable and withheld, and computes coverage.
    /// </summary>
    /// <param name="claims">Claims produced by synthesis, in presentation order.</param>
    /// <param name="retrieval">Evidence retrieved for this request.</param>
    /// <param name="policy">Strictness settings; defaults to <see cref="ResearchPolicy.Default"/>.</param>
    public static AttributedSynthesis Apply(
        IEnumerable<ResearchClaim> claims,
        RetrievalResult retrieval,
        ResearchPolicy? policy = null)
    {
        ArgumentNullException.ThrowIfNull(claims);
        ArgumentNullException.ThrowIfNull(retrieval);

        policy ??= ResearchPolicy.Default;

        var detections = InjectionDetector.ScanAll(retrieval);

        var quarantined = policy.QuarantineInjectedChunks
            ? detections.Select(static d => d.ChunkId).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray()
            : [];

        var quarantinedSet = new HashSet<string>(quarantined, StringComparer.Ordinal);

        var attributed = new List<AttributedClaim>();
        var withheld = new List<UnattributableClaim>();

        foreach (var claim in claims)
        {
            if (claim.Citations.Count == 0)
            {
                withheld.Add(new UnattributableClaim
                {
                    Claim = claim,
                    Reason = UnattributableReason.NoCitation,
                });
                continue;
            }

            var supporting = new List<RetrievedChunk>();
            var unresolved = new List<string>();
            var blockedByQuarantine = false;

            foreach (var citation in claim.Citations)
            {
                var chunk = retrieval.Resolve(citation.ChunkId);

                if (chunk is null)
                {
                    unresolved.Add(citation.ChunkId);
                }
                else if (quarantinedSet.Contains(citation.ChunkId))
                {
                    blockedByQuarantine = true;
                }
                else if (!supporting.Any(c => string.Equals(c.ChunkId, chunk.ChunkId, StringComparison.Ordinal)))
                {
                    supporting.Add(chunk);
                }
            }

            if (supporting.Count > 0)
            {
                attributed.Add(new AttributedClaim
                {
                    Claim = claim,
                    SupportingChunks = supporting,
                });
                continue;
            }

            // Nothing survived. Report the reason the reviewer most needs to act on: a fabricated
            // citation is a model-behaviour problem, quarantine is a corpus problem, and conflating
            // them would send the wrong person to investigate.
            if (unresolved.Count > 0)
            {
                withheld.Add(new UnattributableClaim
                {
                    Claim = claim,
                    Reason = UnattributableReason.UnresolvableCitation,
                    UnresolvedChunkIds = unresolved,
                });
            }
            else if (blockedByQuarantine)
            {
                withheld.Add(new UnattributableClaim
                {
                    Claim = claim,
                    Reason = UnattributableReason.QuarantinedSource,
                });
            }
            else
            {
                // Unreachable while a citation either resolves, fails to resolve, or is quarantined.
                // Kept as a withheld claim rather than an exception: losing a whole synthesis to an
                // unforeseen branch is a worse outcome than withholding one claim.
                withheld.Add(new UnattributableClaim
                {
                    Claim = claim,
                    Reason = UnattributableReason.NoCitation,
                });
            }
        }

        return new AttributedSynthesis
        {
            Claims = attributed,
            UnattributableClaims = withheld,
            InjectionDetections = detections,
            QuarantinedChunkIds = quarantined,
            Coverage = new AttributionCoverage
            {
                TotalClaims = attributed.Count + withheld.Count,
                AttributedClaims = attributed.Count,
            },
        };
    }
}
