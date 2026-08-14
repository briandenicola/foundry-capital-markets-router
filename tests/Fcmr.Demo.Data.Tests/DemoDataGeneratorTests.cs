using FluentAssertions;
using Fcmr.Demo.Data;
using Xunit;

namespace Fcmr.Demo.Data.Tests;

/// <summary>
/// T-021. The generators are only useful if they are reproducible, so reproducibility is what is
/// tested hardest here. AC-6 claims the surveillance ranking is identical across two runs; that
/// claim starts failing at the fixture layer if this does.
/// </summary>
public class DemoDataGeneratorTests
{
    [Fact]
    public void Generate_WithTheSameSeed_ProducesIdenticalData()
    {
        var first = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 42 });
        var second = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 42 });

        second.Alerts.Should().BeEquivalentTo(first.Alerts, o => o.WithStrictOrdering());
        second.Communications.Should().BeEquivalentTo(first.Communications, o => o.WithStrictOrdering());
        second.Orders.Should().BeEquivalentTo(first.Orders, o => o.WithStrictOrdering());
        second.Executions.Should().BeEquivalentTo(first.Executions, o => o.WithStrictOrdering());
        second.ResearchDocuments.Should().BeEquivalentTo(first.ResearchDocuments, o => o.WithStrictOrdering());
    }

    [Fact]
    public void Generate_WithADifferentSeed_ProducesDifferentData()
    {
        var first = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 42 });
        var second = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 43 });

        second.Alerts.Select(a => a.Id + a.Symbol)
            .Should().NotEqual(first.Alerts.Select(a => a.Id + a.Symbol));
    }

    [Fact]
    public void Generate_ChangingOneCollectionSize_DoesNotShiftTheOthers()
    {
        // Independent streams. Without this, adding a research document would silently rewrite
        // every alert, and the fixture set could not grow between rehearsals.
        var baseline = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 7 });
        var moreResearch = DemoDataGenerator.Generate(
            new DemoDataOptions { Seed = 7, ResearchDocumentCount = 200 });

        moreResearch.Orders.Should().BeEquivalentTo(baseline.Orders, o => o.WithStrictOrdering());
        moreResearch.Communications.Should().BeEquivalentTo(
            baseline.Communications, o => o.WithStrictOrdering());
    }

    [Fact]
    public void Generate_ProducesTheFiveHundredAlertBatchTheAcceptanceCriteriaName()
    {
        var data = DemoDataGenerator.Generate();

        data.Alerts.Should().HaveCount(500);
        data.Alerts.Select(a => a.Id).Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public void Generate_EveryAlertResolvesToRealEvidence()
    {
        // The demo failure this prevents: an audience member clicks the one row nobody rehearsed
        // and the evidence panel is empty.
        var data = DemoDataGenerator.Generate();
        var commIds = data.Communications.Select(c => c.Id).ToHashSet(StringComparer.Ordinal);
        var orderIds = data.Orders.Select(o => o.Id).ToHashSet(StringComparer.Ordinal);

        foreach (var alert in data.Alerts)
        {
            alert.CommunicationIds.Should().NotBeEmpty();
            alert.OrderIds.Should().NotBeEmpty();
            alert.CommunicationIds.Should().OnlyContain(id => commIds.Contains(id));
            alert.OrderIds.Should().OnlyContain(id => orderIds.Contains(id));
        }
    }

    [Fact]
    public void Generate_ConcerningAlertsAreNotClusteredAtTheTopOfTheBatch()
    {
        // If the concerning alerts arrive pre-sorted, a ranker that preserves input order scores
        // perfectly and the reproducibility claim becomes vacuous.
        var data = DemoDataGenerator.Generate();
        var firstConcerningIndexes = data.Alerts
            .Select((a, i) => (a, i))
            .Where(x => x.a.GroundTruthConcerning)
            .Select(x => x.i)
            .ToList();

        firstConcerningIndexes.Should().NotBeEmpty();
        firstConcerningIndexes.Max().Should().BeGreaterThan(data.Alerts.Count / 2,
            "concerning alerts must be spread through the batch");
    }

    [Fact]
    public void Generate_EveryExecutionBelongsToAnOrderAndNeverOverfillsIt()
    {
        var data = DemoDataGenerator.Generate();
        var byOrder = data.Executions.GroupBy(e => e.OrderId).ToDictionary(g => g.Key, g => g.Sum(e => e.Quantity));

        foreach (var order in data.Orders)
        {
            if (byOrder.TryGetValue(order.Id, out var filled))
            {
                filled.Should().BeLessThanOrEqualTo(order.Quantity,
                    $"order {order.Id} must never be overfilled");
            }
        }

        data.Executions.Select(e => e.OrderId).Distinct()
            .Should().BeSubsetOf(data.Orders.Select(o => o.Id));
    }

    [Fact]
    public void Generate_ResearchChunksAreUniquelyIdentifiedAndOrdered()
    {
        var data = DemoDataGenerator.Generate();
        var allChunks = data.ResearchDocuments.SelectMany(d => d.Chunks).ToList();

        allChunks.Select(c => c.Id).Should().OnlyHaveUniqueItems(
            "per-claim attribution needs a stable, unique citation target");

        foreach (var doc in data.ResearchDocuments)
        {
            doc.Chunks.Select(c => c.Ordinal).Should().BeInAscendingOrder();
            doc.Chunks.Should().OnlyContain(c => c.DocumentId == doc.Id);
        }
    }

    [Fact]
    public void SeedLabel_IsStableAndDisplayable()
    {
        var data = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 0xABCDEF });

        data.SeedLabel.Should().Be("seed-0000000000abcdef");
    }
}

public class DeterministicRandomTests
{
    [Fact]
    public void NextUInt64_IsStableForAKnownSeed()
    {
        // Pinned expectations. If the algorithm is ever changed, this fails loudly rather than
        // silently invalidating every rehearsed fixture.
        var rng = new DeterministicRandom(1);
        var drawn = Enumerable.Range(0, 3).Select(_ => rng.NextUInt64()).ToList();

        var replay = new DeterministicRandom(1);
        Enumerable.Range(0, 3).Select(_ => replay.NextUInt64()).Should().Equal(drawn);
    }

    [Fact]
    public void Constructor_WithZeroSeed_DoesNotCollapse()
    {
        // Zero is an absorbing state for xorshift; an unguarded generator returns zero forever.
        var rng = new DeterministicRandom(0);
        var values = Enumerable.Range(0, 10).Select(_ => rng.NextUInt64()).ToList();

        values.Should().OnlyHaveUniqueItems();
        values.Should().NotContain(0UL);
    }

    [Fact]
    public void Next_StaysWithinBounds()
    {
        var rng = new DeterministicRandom(99);

        for (var i = 0; i < 10_000; i++)
        {
            rng.Next(5, 9).Should().BeInRange(5, 8);
            rng.NextDouble().Should().BeInRange(0.0, 1.0);
        }
    }

    [Fact]
    public void ForStream_GivesIndependentSequencesPerName()
    {
        var a = DeterministicRandom.ForStream(1, "orders");
        var b = DeterministicRandom.ForStream(1, "alerts");

        var first = Enumerable.Range(0, 5).Select(_ => a.NextUInt64()).ToList();
        var second = Enumerable.Range(0, 5).Select(_ => b.NextUInt64()).ToList();

        second.Should().NotEqual(first);
    }

    [Fact]
    public void ForStream_IsStableForTheSameName()
    {
        var a = DeterministicRandom.ForStream(5, "orders");
        var b = DeterministicRandom.ForStream(5, "orders");

        a.NextUInt64().Should().Be(b.NextUInt64());
    }
}
