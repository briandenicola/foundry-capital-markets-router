namespace Fcmr.Demo.Data;

public enum OrderSide
{
    Buy,
    Sell,
}

public enum CommunicationChannel
{
    Chat,
    Email,
    VoiceTranscript,
}

/// <summary>A source document in the research corpus, chunked ready for indexing.</summary>
public sealed record ResearchDocument
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public required string Source { get; init; }
    public required string Symbol { get; init; }
    public required DateTimeOffset PublishedAt { get; init; }
    public required IReadOnlyList<ResearchChunk> Chunks { get; init; }
}

/// <summary>
/// One retrievable passage. Attribution is per chunk, not per document, because a citation that
/// points at a whole document is not a citation an analyst can check.
/// </summary>
public sealed record ResearchChunk
{
    public required string Id { get; init; }
    public required string DocumentId { get; init; }
    public required int Ordinal { get; init; }
    public required string Text { get; init; }
}

public sealed record Communication
{
    public required string Id { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required CommunicationChannel Channel { get; init; }
    public required string FromParty { get; init; }
    public required string ToParty { get; init; }
    public required string Body { get; init; }
    public string? Symbol { get; init; }

    /// <summary>
    /// Whether this message was planted as genuinely concerning.
    ///
    /// Ground truth exists so the demo can state a measured triage precision instead of asserting
    /// one. It must never be fed to a model or to the ranker — a scoreboard that reads the answer
    /// key is a scoreboard that proves nothing.
    /// </summary>
    public required bool GroundTruthConcerning { get; init; }
}

public sealed record Order
{
    public required string Id { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required string Symbol { get; init; }
    public required OrderSide Side { get; init; }
    public required int Quantity { get; init; }
    public required decimal LimitPrice { get; init; }
    public required string Venue { get; init; }
    public required string TraderId { get; init; }
}

public sealed record Execution
{
    public required string Id { get; init; }
    public required string OrderId { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required int Quantity { get; init; }
    public required decimal Price { get; init; }
    public required string Venue { get; init; }
}

/// <summary>
/// One surveillance alert awaiting triage.
///
/// The evidence references are populated at generation time so that every alert resolves to real
/// communications and real orders. An alert whose evidence does not resolve is the demo failure
/// that surfaces only when someone clicks into the one row you did not rehearse.
/// </summary>
public sealed record SurveillanceAlert
{
    public required string Id { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required string Symbol { get; init; }
    public required string TraderId { get; init; }
    public required string AlertType { get; init; }
    public required IReadOnlyList<string> CommunicationIds { get; init; }
    public required IReadOnlyList<string> OrderIds { get; init; }
    public required bool GroundTruthConcerning { get; init; }
}

/// <summary>The complete fixture set for one seed.</summary>
public sealed record DemoDataSet
{
    public required ulong Seed { get; init; }
    public required IReadOnlyList<ResearchDocument> ResearchDocuments { get; init; }
    public required IReadOnlyList<Communication> Communications { get; init; }
    public required IReadOnlyList<Order> Orders { get; init; }
    public required IReadOnlyList<Execution> Executions { get; init; }
    public required IReadOnlyList<SurveillanceAlert> Alerts { get; init; }

    /// <summary>
    /// Shown in the UI beside the triage queue. The audience is told the ranking is reproducible;
    /// displaying the seed is what turns that from a claim into something they can check.
    /// </summary>
    public string SeedLabel => $"seed-{Seed:x16}";
}
