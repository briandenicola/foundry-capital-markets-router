using System.Text.Json;
using System.Text.Json.Serialization;
using Fcmr.Approvals.Domain;

namespace Fcmr.ApprovalsService.Contracts;

/// <summary>
/// The error body published by <c>contracts/approval-api.md</c>, carried on every non-2xx
/// response including 400 and 403.
///
/// <see cref="Error"/> is the stable machine-readable condition named in the contract's status
/// tables; <see cref="Detail"/> is prose and may change. Closing Gap 6 in CONTRACT-FINDINGS.md.
/// </summary>
public sealed record ApprovalErrorResponse
{
    public required string Error { get; init; }
    public required string Detail { get; init; }
    public required string CorrelationId { get; init; }
}

/// <summary>
/// Body of <c>POST /v1/approvals</c>.
///
/// There is deliberately no <c>proposedByObjectId</c> member. Per ADR-011 the proposing identity
/// comes from the validated token and never from the request, and a request that supplies one is
/// refused with 400 rather than having it quietly ignored — a caller that believes it set the
/// field would otherwise trust a control that is not there.
/// </summary>
public sealed record CreateApprovalRequest
{
    public Lane Lane { get; init; }
    public EvidencePacket? EvidencePacket { get; init; }
    public DateTimeOffset? ExpiresAt { get; init; }

    /// <summary>
    /// Members the contract does not define, captured rather than discarded so that a request
    /// naming an identity can be refused with 400 instead of having the field silently ignored.
    /// A caller who believes it set proposedByObjectId and got a 201 would reasonably conclude
    /// the value was honoured.
    /// </summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; init; }
}

/// <summary>Body of <c>POST /v1/approvals/{id}/decision</c>. Carries no identity, for the same reason.</summary>
public sealed record DecisionRequest
{
    public string? Decision { get; init; }
    public string? Reason { get; init; }

    /// <inheritdoc cref="CreateApprovalRequest.Extra"/>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; init; }
}

/// <summary>Identity members that must never be accepted from a request. See ADR-011.</summary>
public static class RejectedIdentityMembers
{
    private static readonly string[] Names =
    [
        "proposedByObjectId",
        "decidedByObjectId",
        "actorObjectId",
        "objectId",
        "oid",
    ];

    /// <summary>The offending member name, or null when the request names no identity.</summary>
    public static string? Find(Dictionary<string, JsonElement>? extra)
    {
        if (extra is null || extra.Count == 0)
        {
            return null;
        }

        foreach (var name in Names)
        {
            var match = extra.Keys.FirstOrDefault(
                k => string.Equals(k, name, StringComparison.OrdinalIgnoreCase));

            if (match is not null)
            {
                return match;
            }
        }

        return null;
    }
}

/// <summary>An approval as returned by the API.</summary>
public sealed record ApprovalResponse
{
    public required string Id { get; init; }
    public required string CorrelationId { get; init; }
    public required Lane Lane { get; init; }
    public required ApprovalState State { get; init; }
    public required string EvidencePacketHash { get; init; }
    public required string ProposedByObjectId { get; init; }
    public string? DecidedByObjectId { get; init; }
    public string? DecisionReason { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? DecidedAt { get; init; }
    public EvidencePacket? EvidencePacket { get; init; }

    /// <summary>
    /// Carried on every response, including list rows that omit the full packet. approval-api.md
    /// promises "evidence-packet summaries" on the list, and a queue that shows an approver a row
    /// of identifiers without saying what they would be approving is not an approval queue.
    /// </summary>
    public required ProposedAction ProposedAction { get; init; }

    /// <summary>
    /// Recomputed at read time, not stored. A packet whose integrity cannot be checked is not
    /// evidence, and checking it only when someone remembers to is the same as not checking it.
    /// </summary>
    public bool EvidenceIntegrityVerified { get; init; }

    public static ApprovalResponse From(Approval approval, bool includePacket)
    {
        ArgumentNullException.ThrowIfNull(approval);

        return new ApprovalResponse
        {
            Id = approval.Id,
            CorrelationId = approval.CorrelationId,
            Lane = approval.Lane,
            State = approval.State,
            EvidencePacketHash = approval.EvidencePacketHash,
            ProposedByObjectId = approval.ProposedByObjectId,
            DecidedByObjectId = approval.DecidedByObjectId,
            DecisionReason = approval.DecisionReason,
            ExpiresAt = approval.ExpiresAt,
            CreatedAt = approval.CreatedAt,
            DecidedAt = approval.DecidedAt,
            EvidencePacket = includePacket ? approval.EvidencePacket : null,
            ProposedAction = approval.ProposedAction,
            EvidenceIntegrityVerified = approval.VerifyEvidenceIntegrity(),
        };
    }
}
