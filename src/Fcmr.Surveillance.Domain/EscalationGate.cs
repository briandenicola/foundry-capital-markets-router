using System.Globalization;

namespace Fcmr.Surveillance.Domain;

/// <summary>Where an alert sits in the review workflow.</summary>
public enum AlertState
{
    /// <summary>Triaged and sitting in the queue. The only state this lane can reach unaided.</summary>
    Open,

    /// <summary>Escalated to compliance. Reachable only through a recorded human approval.</summary>
    Escalated,

    /// <summary>Closed as not concerning. Also a consequential action, also gated.</summary>
    Dismissed,
}

/// <summary>Thresholds governing when an escalation may be drafted at all.</summary>
public sealed record EscalationPolicy
{
    /// <summary>Risk score at or above which escalation may be proposed.</summary>
    public required decimal MinimumRiskScore { get; init; }

    /// <summary>Minimum evidence items a memo must carry.</summary>
    public required int MinimumEvidenceItems { get; init; }

    public static EscalationPolicy Default { get; } = new()
    {
        MinimumRiskScore = 70m,
        MinimumEvidenceItems = 1,
    };
}

/// <summary>Why a memo could not be drafted.</summary>
public enum DraftRefusalReason
{
    BelowRiskThreshold,
    InsufficientEvidence,
    MissingRationale,
}

/// <summary>
/// A drafted escalation memo. Drafting it changes nothing.
///
/// The memo is the artefact that enters the approval queue. It carries the evidence verbatim so
/// the approver is reading what the model read, not a second-hand account of it.
/// </summary>
public sealed record EscalationMemo
{
    public required string AlertId { get; init; }
    public required string CorrelationId { get; init; }
    public required int QueueRank { get; init; }
    public required decimal RiskScore { get; init; }
    public required string Symbol { get; init; }
    public required string TraderId { get; init; }
    public required string AlertType { get; init; }
    public required string Rationale { get; init; }
    public required IReadOnlyList<EvidenceItem> Evidence { get; init; }

    /// <summary>Identity that drafted the memo. Cannot also approve it.</summary>
    public required string ProposedBy { get; init; }

    public required DateTimeOffset DraftedAt { get; init; }

    /// <summary>
    /// Always <c>"DRAFT"</c>. Carried on the row rather than implied by the type, on the same
    /// reasoning as the order-routing execution label: it has to survive projection into a view
    /// model, because the screen is where it matters.
    /// </summary>
    [System.Diagnostics.CodeAnalysis.SuppressMessage(
        "Performance",
        "CA1822:Mark members as static",
        Justification = "The label belongs on the row, not the type. A static member would not " +
                        "serialise onto the memo, and the screen showing the memo is where DRAFT " +
                        "has to appear.")]
    public string Status => "DRAFT";

    public string Summary => string.Create(
        CultureInfo.InvariantCulture,
        $"Alert {AlertId} ({AlertType}) on {Symbol} for trader {TraderId}, " +
        $"queue rank {QueueRank}, risk score {RiskScore:N1}, " +
        $"{Evidence.Count} evidence item{(Evidence.Count == 1 ? string.Empty : "s")}.");
}

/// <summary>The outcome of attempting to draft a memo.</summary>
public sealed record DraftOutcome
{
    public EscalationMemo? Memo { get; init; }
    public DraftRefusalReason? Refusal { get; init; }
    public string? RefusalExplanation { get; init; }

    public bool Drafted => Memo is not null;
}

/// <summary>Why an escalation was refused at the approval boundary.</summary>
public enum EscalationRefusalReason
{
    /// <summary>The approval does not reference this memo's alert.</summary>
    AlertMismatch,

    /// <summary>The approval carries a different correlationId than the memo.</summary>
    CorrelationMismatch,

    /// <summary>The approval lapsed before it was acted on.</summary>
    ApprovalExpired,

    /// <summary>The identity that approved is the identity that proposed.</summary>
    SegregationOfDuties,
}

/// <summary>A recorded human decision authorising a state change on one alert.</summary>
public sealed record EscalationAuthorization
{
    public required string AlertId { get; init; }
    public required string CorrelationId { get; init; }
    public required string ApprovedBy { get; init; }
    public required DateTimeOffset ApprovedAt { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }

    /// <summary>The state the approver authorised. Approval is not a blank cheque.</summary>
    public required AlertState AuthorisedState { get; init; }
}

/// <summary>An applied state change. Obtainable only from <see cref="EscalationGate.Apply"/>.</summary>
public sealed record AlertStateChange
{
    public required string AlertId { get; init; }
    public required string CorrelationId { get; init; }
    public required AlertState PreviousState { get; init; }
    public required AlertState NewState { get; init; }
    public required string ApprovedBy { get; init; }
    public required string ProposedBy { get; init; }
    public required DateTimeOffset ChangedAt { get; init; }
}

/// <summary>The outcome of attempting to apply an approved escalation.</summary>
public sealed record EscalationOutcome
{
    public AlertStateChange? Change { get; init; }
    public EscalationRefusalReason? Refusal { get; init; }
    public string? RefusalExplanation { get; init; }

    public bool Applied => Change is not null;
}

/// <summary>
/// The approval boundary for this lane.
///
/// Principle I is enforced structurally: <see cref="AlertStateChange"/> has no public constructor
/// path that does not go through <see cref="Apply"/>, and <see cref="Apply"/> cannot be called
/// without an <see cref="EscalationAuthorization"/>. Drafting a memo produces no state change of
/// any kind.
/// </summary>
public static class EscalationGate
{
    /// <summary>
    /// Drafts a memo for a ranked alert, or refuses with a reason.
    ///
    /// Refusing to draft below the evidence bar is a real control, not tidiness. A memo with a
    /// rank but no evidence asks an approver to endorse a number, and an approver who cannot check
    /// the work will eventually approve on the strength of the score alone — which turns the human
    /// gate into a rubber stamp while leaving every audit record looking correct.
    /// </summary>
    public static DraftOutcome Draft(
        RankedAlert ranked,
        EscalationPolicy policy,
        string correlationId,
        string proposedBy,
        DateTimeOffset draftedAt)
    {
        ArgumentNullException.ThrowIfNull(ranked);
        ArgumentNullException.ThrowIfNull(policy);
        ArgumentException.ThrowIfNullOrWhiteSpace(correlationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(proposedBy);

        if (ranked.Assessment.RiskScore < policy.MinimumRiskScore)
        {
            return new DraftOutcome
            {
                Refusal = DraftRefusalReason.BelowRiskThreshold,
                RefusalExplanation = string.Create(
                    CultureInfo.InvariantCulture,
                    $"Alert {ranked.Alert.AlertId} scored {ranked.Assessment.RiskScore:N1}, " +
                    $"below the {policy.MinimumRiskScore:N1} escalation threshold."),
            };
        }

        if (string.IsNullOrWhiteSpace(ranked.Assessment.Rationale))
        {
            return new DraftOutcome
            {
                Refusal = DraftRefusalReason.MissingRationale,
                RefusalExplanation =
                    $"Alert {ranked.Alert.AlertId} has no rationale; an approver would have " +
                    "nothing to review but the score.",
            };
        }

        if (ranked.Assessment.Evidence.Count < policy.MinimumEvidenceItems)
        {
            return new DraftOutcome
            {
                Refusal = DraftRefusalReason.InsufficientEvidence,
                RefusalExplanation = string.Create(
                    CultureInfo.InvariantCulture,
                    $"Alert {ranked.Alert.AlertId} cites {ranked.Assessment.Evidence.Count} " +
                    $"evidence item(s); {policy.MinimumEvidenceItems} required."),
            };
        }

        return new DraftOutcome
        {
            Memo = new EscalationMemo
            {
                AlertId = ranked.Alert.AlertId,
                CorrelationId = correlationId,
                QueueRank = ranked.Rank,
                RiskScore = ranked.Assessment.RiskScore,
                Symbol = ranked.Alert.Symbol,
                TraderId = ranked.Alert.TraderId,
                AlertType = ranked.Alert.AlertType,
                Rationale = ranked.Assessment.Rationale,
                Evidence = [.. ranked.Assessment.Evidence],
                ProposedBy = proposedBy,
                DraftedAt = draftedAt,
            },
        };
    }

    /// <summary>
    /// Applies an approved escalation, or refuses with a named reason.
    ///
    /// Refusal order matches <c>SimulatedOms</c> deliberately — alert identity, correlation,
    /// expiry, then segregation of duties. Expiry precedes the approver check because a lapsed
    /// approval is not a valid approval whose approver is then scrutinised; checking the identity
    /// first invites the reading that a stale approval can be rescued by a better approver.
    /// </summary>
    public static EscalationOutcome Apply(
        EscalationMemo memo,
        EscalationAuthorization authorization,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(memo);
        ArgumentNullException.ThrowIfNull(authorization);

        if (!string.Equals(memo.AlertId, authorization.AlertId, StringComparison.Ordinal))
        {
            return Refuse(
                EscalationRefusalReason.AlertMismatch,
                $"Approval references alert {authorization.AlertId} but the memo is for " +
                $"{memo.AlertId}.");
        }

        if (!string.Equals(memo.CorrelationId, authorization.CorrelationId, StringComparison.Ordinal))
        {
            return Refuse(
                EscalationRefusalReason.CorrelationMismatch,
                $"Approval carries correlationId {authorization.CorrelationId} but the memo was " +
                $"drafted under {memo.CorrelationId}.");
        }

        if (now >= authorization.ExpiresAt)
        {
            return Refuse(
                EscalationRefusalReason.ApprovalExpired,
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"Approval for alert {memo.AlertId} expired at {authorization.ExpiresAt:O}. " +
                    $"Expiry is not approval."));
        }

        if (string.Equals(memo.ProposedBy, authorization.ApprovedBy, StringComparison.OrdinalIgnoreCase))
        {
            return Refuse(
                EscalationRefusalReason.SegregationOfDuties,
                $"Identity {authorization.ApprovedBy} both proposed and approved the escalation " +
                $"of alert {memo.AlertId}.");
        }

        return new EscalationOutcome
        {
            Change = new AlertStateChange
            {
                AlertId = memo.AlertId,
                CorrelationId = memo.CorrelationId,
                PreviousState = AlertState.Open,
                NewState = authorization.AuthorisedState,
                ApprovedBy = authorization.ApprovedBy,
                ProposedBy = memo.ProposedBy,
                ChangedAt = now,
            },
        };
    }

    private static EscalationOutcome Refuse(EscalationRefusalReason reason, string explanation) =>
        new() { Refusal = reason, RefusalExplanation = explanation };
}
