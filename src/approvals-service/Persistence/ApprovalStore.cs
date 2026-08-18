using System.Collections.Concurrent;
using Fcmr.Approvals.Domain;

namespace Fcmr.ApprovalsService.Persistence;

/// <summary>
/// Where approvals are durably written.
///
/// The port exists ahead of the Cosmos adapter (T-019) so that landing it is a registration change
/// rather than a reshaping of the endpoints. Methods are async and take a CancellationToken for
/// the same reason the routing store's do: an interface shaped around a dictionary leaks the
/// moment a network sits behind it.
///
/// Permitted under ADR-007. Swapping the store changes where real evidence is read and written; it
/// does not change whether the evidence is real. No implementation may invent an approval — every
/// record held here was created by <see cref="Approval.Propose"/> from a request that arrived, and
/// transitioned by the domain state machine.
/// </summary>
public interface IApprovalStore
{
    Task<Approval?> GetAsync(string id, CancellationToken cancellationToken);

    Task<IReadOnlyList<Approval>> ListAsync(ApprovalState? state, CancellationToken cancellationToken);

    /// <summary>Writes a new approval. Returns false if the id is already taken.</summary>
    Task<bool> CreateAsync(Approval approval, CancellationToken cancellationToken);

    /// <summary>Replaces an existing approval after a domain transition.</summary>
    Task UpdateAsync(Approval approval, CancellationToken cancellationToken);

    /// <summary>
    /// Appends an audit record.
    ///
    /// Separate from the approval write because invariant 3 says every call writes an audit record
    /// before returning, and an audit trail that is a projection of current state cannot answer
    /// "what was refused", only "what stands".
    /// </summary>
    Task AppendAuditAsync(ApprovalAuditEvent auditEvent, CancellationToken cancellationToken);

    Task<IReadOnlyList<ApprovalAuditEvent>> AuditTrailAsync(string correlationId, CancellationToken cancellationToken);
}

/// <summary>
/// In-memory approval store. Replaced by the Cosmos adapter at T-019.
///
/// Holds audit events in append order and never removes one, including for approvals that were
/// refused. That is the behaviour the Cosmos adapter must also have, and stating it here is
/// cheaper than discovering the difference during rehearsal.
/// </summary>
public sealed class InMemoryApprovalStore : IApprovalStore
{
    private readonly ConcurrentDictionary<string, Approval> approvals = new(StringComparer.Ordinal);
    private readonly ConcurrentQueue<ApprovalAuditEvent> audit = new();

    public Task<Approval?> GetAsync(string id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(approvals.TryGetValue(id, out var approval) ? approval : null);
    }

    public Task<IReadOnlyList<Approval>> ListAsync(ApprovalState? state, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        IReadOnlyList<Approval> result = approvals.Values
            .Where(a => state is null || a.State == state)
            .OrderBy(a => a.CreatedAt)
            .ToList();

        return Task.FromResult(result);
    }

    public Task<bool> CreateAsync(Approval approval, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(approval);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(approvals.TryAdd(approval.Id, approval));
    }

    public Task UpdateAsync(Approval approval, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(approval);
        cancellationToken.ThrowIfCancellationRequested();
        approvals[approval.Id] = approval;
        return Task.CompletedTask;
    }

    public Task AppendAuditAsync(ApprovalAuditEvent auditEvent, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(auditEvent);
        cancellationToken.ThrowIfCancellationRequested();
        audit.Enqueue(auditEvent);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<ApprovalAuditEvent>> AuditTrailAsync(
        string correlationId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        IReadOnlyList<ApprovalAuditEvent> result = audit
            .Where(e => string.Equals(e.CorrelationId, correlationId, StringComparison.Ordinal))
            .ToList();

        return Task.FromResult(result);
    }
}
