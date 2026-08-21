using Fcmr.Research.Domain;

namespace Fcmr.ResearchService.Contracts;

/// <summary>Wire shapes for the research lane.</summary>
public sealed record ChunkDto
{
    public required string ChunkId { get; init; }
    public required string SourceId { get; init; }
    public string SourceTitle { get; init; } = string.Empty;
    public required string Text { get; init; }

    public RetrievedChunk ToDomain() => new()
    {
        ChunkId = ChunkId,
        SourceId = SourceId,
        SourceTitle = SourceTitle,
        Text = Text,
    };
}

public sealed record CitationDto
{
    public required string ChunkId { get; init; }
    public string? Quote { get; init; }

    public Citation ToDomain() => new()
    {
        ChunkId = ChunkId,
        Quote = Quote,
    };
}

public sealed record ClaimDto
{
    public required string ClaimId { get; init; }
    public required string Text { get; init; }
    public IReadOnlyList<CitationDto> Citations { get; init; } = [];

    public ResearchClaim ToDomain() => new()
    {
        ClaimId = ClaimId,
        Text = Text,
        Citations = [.. Citations.Select(c => c.ToDomain())],
    };
}

public sealed record AttributionRequest
{
    public string? CorrelationId { get; init; }
    public required IReadOnlyList<ClaimDto> Claims { get; init; }
    public required IReadOnlyList<ChunkDto> Retrieval { get; init; }

    /// <summary>
    /// Optional override of the coverage bar. Present because the demo narrative tightens it live;
    /// absent means <see cref="ResearchPolicy.Default"/>.
    /// </summary>
    public decimal? MinimumCoveragePercent { get; init; }
}
