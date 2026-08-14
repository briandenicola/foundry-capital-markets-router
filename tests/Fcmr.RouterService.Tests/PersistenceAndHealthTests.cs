using Fcmr.Router.Decisions;
using Fcmr.RouterService.Contracts;
using Fcmr.RouterService.Health;
using Fcmr.RouterService.Persistence;
using FluentAssertions;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Xunit;

namespace Fcmr.RouterService.Tests;

public sealed class RoutingDecisionStoreTests
{
    private static RoutingDecisionRecord Record(string correlationId, DateTimeOffset at) => new()
    {
        Id = Guid.NewGuid().ToString(),
        CorrelationId = correlationId,
        Lane = Lane.Research,
        TaskKind = "synthesize",
        Decision = new RoutingDecision
        {
            ComplexityScore = 0.72,
            CostCeilingUsd = 0.25m,
            Outcome = RoutingOutcome.Routed,
            CandidateTiers = [],
            Rationale = "test",
        },
        ComplexityInputs = new ComplexityHints { InputTokenEstimate = 100 },
        CreatedAt = at,
    };

    [Fact]
    public async Task Reads_back_what_was_written_by_correlation_id()
    {
        var store = new InMemoryRoutingDecisionStore();
        var now = DateTimeOffset.UtcNow;

        await store.SaveAsync(Record("abc", now));
        await store.SaveAsync(Record("def", now));

        var found = await store.GetAsync("abc");
        found.Should().ContainSingle().Which.CorrelationId.Should().Be("abc");
    }

    [Fact]
    public async Task Keeps_every_record_in_a_correlation_rather_than_overwriting()
    {
        var store = new InMemoryRoutingDecisionStore();
        var now = DateTimeOffset.UtcNow;

        await store.SaveAsync(Record("abc", now));
        await store.SaveAsync(Record("abc", now.AddSeconds(1)));

        (await store.GetAsync("abc")).Should().HaveCount(2);
    }

    [Fact]
    public async Task Returns_empty_for_an_unknown_correlation_id()
    {
        var store = new InMemoryRoutingDecisionStore();

        (await store.GetAsync("nothing-here")).Should().BeEmpty();
    }

    [Fact]
    public async Task Lists_a_window_most_recent_first()
    {
        var store = new InMemoryRoutingDecisionStore();
        var now = DateTimeOffset.UtcNow;

        await store.SaveAsync(Record("old", now.AddMinutes(-30)));
        await store.SaveAsync(Record("recent", now.AddMinutes(-1)));
        await store.SaveAsync(Record("newest", now));

        var window = await store.ListSinceAsync(now.AddMinutes(-15));

        window.Select(r => r.CorrelationId).Should().Equal("newest", "recent");
    }
}

public sealed class DecisionStoreHealthCheckTests
{
    private sealed class Store(bool reachable, bool throws = false) : IRoutingDecisionStore
    {
        public Task SaveAsync(RoutingDecisionRecord record, CancellationToken ct = default) => Task.CompletedTask;

        public Task<IReadOnlyList<RoutingDecisionRecord>> GetAsync(string correlationId, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<RoutingDecisionRecord>>([]);

        public Task<IReadOnlyList<RoutingDecisionRecord>> ListSinceAsync(DateTimeOffset since, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<RoutingDecisionRecord>>([]);

        public Task<bool> IsReachableAsync(CancellationToken ct = default) =>
            throws ? throw new TimeoutException("probe timed out") : Task.FromResult(reachable);
    }

    private static HealthCheckContext Context() => new()
    {
        Registration = new HealthCheckRegistration("decision-store", _ => null!, HealthStatus.Unhealthy, ["ready"]),
    };

    [Fact]
    public async Task Reports_healthy_when_the_store_answers()
    {
        var result = await new DecisionStoreHealthCheck(new Store(reachable: true)).CheckHealthAsync(Context());

        result.Status.Should().Be(HealthStatus.Healthy);
    }

    /// <summary>
    /// The case that matters. Readiness must fail while the system of record is down, so the
    /// replica leaves rotation rather than accepting requests whose decisions it cannot record.
    /// </summary>
    [Fact]
    public async Task Reports_unhealthy_when_the_store_is_unreachable()
    {
        var result = await new DecisionStoreHealthCheck(new Store(reachable: false)).CheckHealthAsync(Context());

        result.Status.Should().Be(HealthStatus.Unhealthy);
    }

    [Fact]
    public async Task Reports_unhealthy_when_the_probe_itself_fails()
    {
        var result = await new DecisionStoreHealthCheck(new Store(reachable: true, throws: true))
            .CheckHealthAsync(Context());

        result.Status.Should().Be(HealthStatus.Unhealthy);
        result.Exception.Should().BeOfType<TimeoutException>();
    }
}
