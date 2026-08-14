using Fcmr.Approvals.Domain;

namespace Fcmr.Approvals.Domain.Tests;

/// <summary>
/// A clock the test owns outright. The domain never reads an ambient clock, which is the only
/// reason expiry is testable at all — an untestable clock means untestable expiry, and untestable
/// expiry is an assertion rather than a control.
/// </summary>
public sealed class TestClock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;

    public void Advance(TimeSpan by) => Now += by;
}

/// <summary>Shared, deliberately boring fixtures. Every test builds through the public factory.</summary>
public static class Fixtures
{
    public const string Proposer = "a1b2c3d4-11e5-4f66-8a77-b8c9d0e1f2a3";
    public const string Approver = "f9e8d7c6-22b5-4a44-9c33-d2e1f0a9b8c7";
    public const string CorrelationId = "corr-0001";

    public static readonly DateTimeOffset T0 = new(2026, 9, 10, 14, 0, 0, TimeSpan.Zero);
    public static readonly DateTimeOffset Expiry = T0.AddMinutes(30);

    public static EvidencePacket Packet(string correlationId = CorrelationId) => new()
    {
        CorrelationId = correlationId,
        Lane = Lane.OrderRouting,
        Inputs = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["instrument"] = "SYNTH-CORP-4",
            ["side"] = "Buy",
            ["quantity"] = "25000",
        },
        RetrievedSources =
        [
            new EvidenceSource
            {
                DocumentId = "doc-7",
                ChunkId = "chunk-2",
                Excerpt = "Venue A showed the tightest spread across the sampled window.",
                Score = 0.81,
            },
            new EvidenceSource
            {
                DocumentId = "doc-3",
                ChunkId = "chunk-9",
                Excerpt = "Best-execution policy requires venue comparison across at least three venues.",
                Score = 0.74,
            },
        ],
        RoutingDecision = new RoutingDecisionSummary
        {
            Outcome = "Routed",
            ComplexityScore = 0.62,
            CostCeilingUsd = 0.50m,
            SelectedTier = "Standard",
            SelectedDeployment = "azureopenai-standard",
            SelectedVendor = "AzureOpenAI",
            PolicySetId = "CapitalMarkets-US",
            PolicySetVersion = 3,
            Rationale = "Complexity 0.62 with a 0.50 USD ceiling selected the cheapest compliant Standard deployment.",
        },
        ProposedAction = new ProposedAction
        {
            Kind = "RouteOrder",
            Summary = "Route 25,000 SYNTH-CORP-4 to Venue A.",
            Fields = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["venue"] = "VENUE-A",
                ["limitPrice"] = "101.25",
            },
        },
        UnattributableClaims = ["Venue B latency could not be attributed to a retrieved source."],
    };

    public static Approval Pending(TestClock clock, EvidencePacket? packet = null)
    {
        var result = Approval.Propose(
            id: "apr-0001",
            lane: Lane.OrderRouting,
            evidencePacket: packet ?? Packet(),
            proposedByObjectId: Proposer,
            expiresAt: Expiry,
            clock: clock);

        return result.Approval
            ?? throw new InvalidOperationException($"fixture proposal refused: {result.Refusal?.Reason}");
    }

    /// <summary>Reaches a terminal state only through legal transitions — the states are not hand-built.</summary>
    public static Approval InState(ApprovalState state, TestClock clock)
    {
        var pending = Pending(clock);

        return state switch
        {
            ApprovalState.PendingApproval => pending,
            ApprovalState.Approved => Accept(pending.Approve(Approver, clock)),
            ApprovalState.Rejected => Accept(pending.Reject(Approver, "Venue comparison is incomplete.", clock)),
            ApprovalState.Expired => ExpireVia(pending, clock),
            _ => throw new ArgumentOutOfRangeException(nameof(state)),
        };
    }

    private static Approval ExpireVia(Approval pending, TestClock clock)
    {
        var restore = clock.Now;
        clock.Now = Expiry;
        var expired = Accept(pending.Expire(clock));
        clock.Now = restore;
        return expired;
    }

    private static Approval Accept(ApprovalTransitionResult result) =>
        result.Approval
        ?? throw new InvalidOperationException($"fixture transition refused: {result.Refusal?.Reason}");

    /// <summary>
    /// Round-trips an approval through <see cref="Approval.Rehydrate"/>, optionally substituting
    /// stored fields the way a tampered or foreign-written document could.
    /// </summary>
    public static Approval Rehydrated(
        Approval source,
        string? proposedBy = null,
        string? decidedBy = null,
        string? hash = null,
        EvidencePacket? packet = null,
        ApprovalState? state = null)
    {
        var result = Approval.Rehydrate(
            id: source.Id,
            correlationId: source.CorrelationId,
            lane: source.Lane,
            evidencePacket: packet ?? source.EvidencePacket,
            evidencePacketHash: hash ?? source.EvidencePacketHash,
            state: state ?? source.State,
            proposedByObjectId: proposedBy ?? source.ProposedByObjectId,
            decidedByObjectId: decidedBy ?? source.DecidedByObjectId,
            decisionReason: source.DecisionReason,
            expiresAt: source.ExpiresAt,
            createdAt: source.CreatedAt,
            decidedAt: source.DecidedAt);

        return result.Approval
            ?? throw new InvalidOperationException($"fixture rehydration refused: {result.Refusal?.Reason}");
    }

    public static readonly ApprovalState[] AllStates =
    [
        ApprovalState.PendingApproval,
        ApprovalState.Approved,
        ApprovalState.Rejected,
        ApprovalState.Expired,
    ];

    public static readonly ApprovalTrigger[] AllTriggers =
    [
        ApprovalTrigger.Approve,
        ApprovalTrigger.Reject,
        ApprovalTrigger.Expire,
    ];

    /// <summary>A well-formed command for the trigger, issued by an identity that is not the proposer.</summary>
    public static ApprovalCommand CommandFor(ApprovalTrigger trigger, string actor = Approver) => trigger switch
    {
        ApprovalTrigger.Approve => new ApproveCommand { DecidedByObjectId = actor },
        ApprovalTrigger.Reject => new RejectCommand { DecidedByObjectId = actor, Reason = "Insufficient venue evidence." },
        ApprovalTrigger.Expire => new ExpireCommand(),
        _ => throw new ArgumentOutOfRangeException(nameof(trigger)),
    };
}
