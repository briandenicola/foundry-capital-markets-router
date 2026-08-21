using System.Collections.Concurrent;
using Fcmr.OrderRouting.Domain;

namespace Fcmr.OrderRoutingService.Persistence;

/// <summary>
/// Holds proposals between the moment one is produced and the moment an approval arrives to
/// execute it.
///
/// This exists because execution is checked against the proposal, not against the request that
/// claims to execute it. If the caller supplied the proposal body at execution time, an approved
/// proposal id could be presented alongside a different venue, quantity, or price — the approval
/// would verify and the fill would not be the thing approved.
/// </summary>
public interface IProposalStore
{
    void Save(RouteProposal proposal);

    RouteProposal? Find(string proposalId);

    /// <summary>Records that a proposal has been executed, and reports whether it already was.</summary>
    bool TryMarkExecuted(string proposalId);
}

/// <summary>
/// In-memory adapter. Replaced by a Cosmos-backed one alongside the approvals store (T-014a);
/// nothing above the port changes when it is, which is why the port exists first.
/// </summary>
public sealed class InMemoryProposalStore : IProposalStore
{
    private readonly ConcurrentDictionary<string, RouteProposal> _proposals = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, byte> _executed = new(StringComparer.Ordinal);

    public void Save(RouteProposal proposal)
    {
        ArgumentNullException.ThrowIfNull(proposal);
        _proposals[proposal.ProposalId] = proposal;
    }

    public RouteProposal? Find(string proposalId) =>
        _proposals.TryGetValue(proposalId, out var proposal) ? proposal : null;

    /// <summary>
    /// Returns false if the proposal was already executed.
    ///
    /// Replay protection lives here rather than in the domain because it is a property of this
    /// deployment's storage, not of best execution. An approval is single-use: a caller who can
    /// replay one approved execution can double an order without a second human ever seeing it.
    /// </summary>
    public bool TryMarkExecuted(string proposalId) => _executed.TryAdd(proposalId, 0);
}
