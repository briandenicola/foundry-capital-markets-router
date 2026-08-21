namespace Fcmr.Research.Domain;

/// <summary>
/// A unit of retrieved evidence: one chunk of one source document, as returned by the index.
///
/// This is the only thing a claim may be grounded in. If a chunk was not retrieved for the current
/// request, it does not exist as far as attribution is concerned — which is what makes a fabricated
/// citation detectable rather than merely unlikely.
/// </summary>
public sealed record RetrievedChunk
{
    /// <summary>
    /// Index-assigned identifier, unique within a retrieval result. This is the value a citation
    /// must name.
    /// </summary>
    public required string ChunkId { get; init; }

    /// <summary>Document this chunk came from. Several chunks may share a source.</summary>
    public required string SourceId { get; init; }

    /// <summary>Human-readable source title, shown beside the citation in the UI.</summary>
    public string SourceTitle { get; init; } = string.Empty;

    /// <summary>The retrieved text. Untrusted input — see <see cref="InjectionDetector"/>.</summary>
    public required string Text { get; init; }

    /// <summary>
    /// Relevance score reported by the index. Recorded for the audit trail and for explaining the
    /// retrieval, never used to decide whether a claim is attributable.
    /// </summary>
    public double Score { get; init; }
}

/// <summary>
/// The evidence available to a single synthesis, keyed for resolution.
///
/// Constructed once per request. Duplicate chunk ids are a defect in the retrieval layer rather
/// than something to paper over, so they are rejected here instead of silently deduplicated: two
/// chunks answering to one id makes every citation to that id ambiguous, and an ambiguous citation
/// is indistinguishable from an unfounded one.
/// </summary>
public sealed class RetrievalResult
{
    private readonly Dictionary<string, RetrievedChunk> _byId;

    public RetrievalResult(IEnumerable<RetrievedChunk> chunks)
    {
        ArgumentNullException.ThrowIfNull(chunks);

        _byId = [];
        var ordered = new List<RetrievedChunk>();

        foreach (var chunk in chunks)
        {
            if (!_byId.TryAdd(chunk.ChunkId, chunk))
            {
                throw new ArgumentException(
                    $"Duplicate chunk id '{chunk.ChunkId}' in retrieval result. Citations to it " +
                    "would be ambiguous, so the retrieval is rejected rather than deduplicated.",
                    nameof(chunks));
            }

            ordered.Add(chunk);
        }

        Chunks = ordered;
    }

    /// <summary>Retrieved chunks, in the order the index returned them.</summary>
    public IReadOnlyList<RetrievedChunk> Chunks { get; }

    public int Count => Chunks.Count;

    /// <summary>Resolves a citation target, or null when nothing was retrieved under that id.</summary>
    public RetrievedChunk? Resolve(string chunkId) =>
        _byId.GetValueOrDefault(chunkId);

    public bool Contains(string chunkId) => _byId.ContainsKey(chunkId);
}
