using FluentAssertions;
using Fcmr.Research.Domain;
using Xunit;

namespace Fcmr.Research.Domain.Tests;

public class RetrievalResultTests
{
    [Fact]
    public void Rejects_duplicate_chunk_ids_rather_than_deduplicating()
    {
        var act = () => new RetrievalResult(
        [
            Chunk("c1", "doc-1", "First."),
            Chunk("c1", "doc-2", "Second."),
        ]);

        act.Should().Throw<ArgumentException>()
            .WithMessage("*Duplicate chunk id 'c1'*");
    }

    [Fact]
    public void Preserves_index_order()
    {
        var retrieval = new RetrievalResult(
        [
            Chunk("c3", "doc-1", "Third."),
            Chunk("c1", "doc-1", "First."),
        ]);

        retrieval.Chunks.Select(c => c.ChunkId).Should().Equal("c3", "c1");
        retrieval.Count.Should().Be(2);
    }

    [Fact]
    public void Resolve_returns_null_for_an_unknown_id()
    {
        var retrieval = new RetrievalResult([Chunk("c1", "doc-1", "Text.")]);

        retrieval.Resolve("nope").Should().BeNull();
        retrieval.Contains("nope").Should().BeFalse();
        retrieval.Resolve("c1").Should().NotBeNull();
    }

    internal static RetrievedChunk Chunk(string id, string sourceId, string text) => new()
    {
        ChunkId = id,
        SourceId = sourceId,
        SourceTitle = $"Title of {sourceId}",
        Text = text,
    };
}
