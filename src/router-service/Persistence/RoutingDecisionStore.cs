using Fcmr.Router.Decisions;
using Fcmr.RouterService.Contracts;

namespace Fcmr.RouterService.Persistence;

/// <summary>
/// One row of the routerDecisions container, per specs/001-router-core/data-model.md.
/// Partition key is <see cref="CorrelationId"/>.
/// </summary>
public sealed record RoutingDecisionRecord
{
    public required string Id { get; init; }
    public required string CorrelationId { get; init; }
    public required Lane Lane { get; init; }
    public required string TaskKind { get; init; }
    public required RoutingDecision Decision { get; init; }

    /// <summary>The signals that produced the score, kept so a decision can be re-derived, not just re-read.</summary>
    public required ComplexityHints ComplexityInputs { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public int? LatencyMs { get; init; }
}

/// <summary>
/// Where routing decisions are durably written.
///
/// The port exists from the first commit so that T-014's Cosmos adapter is a registration change
/// rather than a reshaping of the handler. Its methods are async and take a CancellationToken for
/// the same reason: an interface shaped around an in-memory store is one that leaks the moment a
/// network sits behind it.
///
/// This abstraction is explicitly permitted under ADR-007. Swapping the store changes *where real
/// evidence is read from and written to*; it does not change *whether the evidence is real*. No
/// implementation of this port may invent a decision — every record it holds was produced by
/// <see cref="RoutingPlanner.Plan"/> from a request that actually arrived.
/// </summary>
public interface IRoutingDecisionStore
{
    Task SaveAsync(RoutingDecisionRecord record, CancellationToken ct = default);

    /// <summary>Backs GET /v1/decisions/{correlationId} and AC-8's single-query reconstruction.</summary>
    Task<IReadOnlyList<RoutingDecisionRecord>> GetAsync(string correlationId, CancellationToken ct = default);

    /// <summary>Most recent first, for the scoreboard window in T-016.</summary>
    Task<IReadOnlyList<RoutingDecisionRecord>> ListSinceAsync(DateTimeOffset since, CancellationToken ct = default);

    /// <summary>
    /// Whether the store is reachable right now, for the readiness probe.
    ///
    /// Separate from the write path deliberately: a readiness check that reports healthy while the
    /// system of record is unreachable hides the one failure the demo must surface, and Container
    /// Apps would keep routing traffic into a service that cannot record what it did.
    /// </summary>
    Task<bool> IsReachableAsync(CancellationToken ct = default);
}

/// <summary>
/// In-memory decision store, standing in until T-014 lands Cosmos.
///
/// Mirrors the shape of <see cref="InMemoryPolicySetRepository"/>, including its partition-by-key
/// layout, so the substitution is a fair stand-in rather than one that flatters the design.
/// Append-only, matching the auditEvents rule that no service identity holds update or delete
/// rights: the absence of a delete method here is the same constraint expressed in a type.
/// </summary>
public sealed class InMemoryRoutingDecisionStore : IRoutingDecisionStore
{
    private readonly Lock _gate = new();
    private readonly Dictionary<string, List<RoutingDecisionRecord>> _byCorrelation = new(StringComparer.Ordinal);
    private readonly List<RoutingDecisionRecord> _ordered = [];

    public Task SaveAsync(RoutingDecisionRecord record, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(record);

        lock (_gate)
        {
            if (!_byCorrelation.TryGetValue(record.CorrelationId, out var partition))
            {
                partition = [];
                _byCorrelation[record.CorrelationId] = partition;
            }

            partition.Add(record);
            _ordered.Add(record);
        }

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<RoutingDecisionRecord>> GetAsync(string correlationId, CancellationToken ct = default)
    {
        lock (_gate)
        {
            IReadOnlyList<RoutingDecisionRecord> result =
                _byCorrelation.TryGetValue(correlationId, out var partition) ? [.. partition] : [];

            return Task.FromResult(result);
        }
    }

    public Task<IReadOnlyList<RoutingDecisionRecord>> ListSinceAsync(
        DateTimeOffset since, CancellationToken ct = default)
    {
        lock (_gate)
        {
            IReadOnlyList<RoutingDecisionRecord> result = _ordered
                .Where(r => r.CreatedAt >= since)
                .OrderByDescending(r => r.CreatedAt)
                .ToList();

            return Task.FromResult(result);
        }
    }

    public Task<bool> IsReachableAsync(CancellationToken ct = default) => Task.FromResult(true);
}
