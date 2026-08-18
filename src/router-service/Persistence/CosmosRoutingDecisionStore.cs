using System.Net;
using Microsoft.Azure.Cosmos;

namespace Fcmr.RouterService.Persistence;

/// <summary>
/// Cosmos DB adapter for <see cref="IRoutingDecisionStore"/>. T-014.
///
/// <para>
/// Nothing above the port changed to land this, which was the point of defining the port in the
/// first commit. The handler, the health check and the tests all still talk to the interface.
/// </para>
/// <para>
/// Per ADR-007 this adapter changes where real evidence is written, never whether it is real. It
/// has no code path that manufactures a record: every document it stores was produced by
/// <c>RoutingPlanner.Plan()</c> from a request that actually arrived, and every document it returns
/// came out of the container.
/// </para>
/// </summary>
public sealed class CosmosRoutingDecisionStore : IRoutingDecisionStore
{
    private readonly Container container;

    public CosmosRoutingDecisionStore(CosmosClient client, CosmosOptions options)
    {
        ArgumentNullException.ThrowIfNull(client);
        ArgumentNullException.ThrowIfNull(options);

        container = client.GetContainer(options.Database, options.DecisionsContainer);
    }

    /// <summary>
    /// Writes one decision.
    ///
    /// Uses <c>CreateItemAsync</c> rather than <c>UpsertItemAsync</c>. The difference is the whole
    /// argument: an upsert would silently overwrite an existing decision for the same id, and this
    /// container is the system of record for what the router decided. A duplicate id is a defect
    /// that must surface as a 409, not a previous decision quietly disappearing.
    /// </summary>
    public async Task SaveAsync(RoutingDecisionRecord record, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(record);

        await container.CreateItemAsync(
            record,
            new PartitionKey(record.CorrelationId),
            cancellationToken: ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Reads every decision for one correlation id.
    ///
    /// Single-partition by construction — the container is partitioned on <c>/correlationId</c> —
    /// which is what makes AC-8's "reconstruct the whole story in one query" true in cost as well
    /// as in wording. A cross-partition scan would satisfy the sentence and not the intent.
    /// </summary>
    public async Task<IReadOnlyList<RoutingDecisionRecord>> GetAsync(
        string correlationId, CancellationToken ct = default)
    {
        var query = new QueryDefinition("SELECT * FROM c WHERE c.correlationId = @correlationId")
            .WithParameter("@correlationId", correlationId);

        return await QueryAsync(
            query,
            new QueryRequestOptions { PartitionKey = new PartitionKey(correlationId) },
            ct).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<RoutingDecisionRecord>> ListSinceAsync(
        DateTimeOffset since, CancellationToken ct = default)
    {
        // Cross-partition, and deliberately so: the scoreboard is a time window across every
        // correlation id, which is a different access pattern from the one the partition key
        // serves. Bounded by the window rather than left open-ended.
        var query = new QueryDefinition(
                "SELECT * FROM c WHERE c.createdAt >= @since ORDER BY c.createdAt DESC")
            .WithParameter("@since", since);

        return await QueryAsync(query, new QueryRequestOptions(), ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Whether the container can be reached right now.
    ///
    /// Reads the container's own metadata rather than issuing a query: it is the cheapest call that
    /// still proves the endpoint resolved, the token was accepted, and the container exists. A
    /// probe that only checked the account would report ready while the container the service
    /// writes to was missing.
    ///
    /// Returns false rather than throwing. The caller is a readiness probe, and its job is to
    /// answer the question, not to propagate the failure — the failure is already surfaced by the
    /// replica being taken out of rotation.
    /// </summary>
    public async Task<bool> IsReachableAsync(CancellationToken ct = default)
    {
        try
        {
            var response = await container.ReadContainerAsync(cancellationToken: ct).ConfigureAwait(false);
            return response.StatusCode == HttpStatusCode.OK;
        }
        catch (CosmosException)
        {
            return false;
        }
        catch (HttpRequestException)
        {
            return false;
        }
    }

    private async Task<IReadOnlyList<RoutingDecisionRecord>> QueryAsync(
        QueryDefinition query, QueryRequestOptions options, CancellationToken ct)
    {
        var results = new List<RoutingDecisionRecord>();

        using var iterator = container.GetItemQueryIterator<RoutingDecisionRecord>(query, requestOptions: options);

        while (iterator.HasMoreResults)
        {
            var page = await iterator.ReadNextAsync(ct).ConfigureAwait(false);
            results.AddRange(page);
        }

        return results;
    }
}
