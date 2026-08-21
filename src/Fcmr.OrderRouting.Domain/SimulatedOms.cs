namespace Fcmr.OrderRouting.Domain;

/// <summary>
/// An approval decision presented to the OMS as authority to execute.
///
/// Presented, not trusted. Every field here is checked by <see cref="SimulatedOms"/> before a fill
/// is produced.
/// </summary>
public sealed record ExecutionAuthorization
{
    public required string ApprovalId { get; init; }

    /// <summary>The proposal this authorisation was issued against. Checked, not assumed.</summary>
    public required string ProposalId { get; init; }

    public required string CorrelationId { get; init; }

    /// <summary>Entra object id of the approver.</summary>
    public required string ApprovedBy { get; init; }

    public required DateTimeOffset ApprovedAt { get; init; }

    /// <summary>
    /// When this authorisation stops being one. An approval that has lapsed is not a weaker
    /// approval; it is an absent one.
    /// </summary>
    public required DateTimeOffset ExpiresAt { get; init; }
}

/// <summary>Why the OMS refused to execute.</summary>
public enum ExecutionRefusalReason
{
    /// <summary>No approval was presented. The default answer to "just execute it".</summary>
    NoAuthorization,

    /// <summary>The approval lapsed before execution was attempted.</summary>
    AuthorizationExpired,

    /// <summary>The approval was issued against a different proposal.</summary>
    AuthorizationForDifferentProposal,

    /// <summary>The approver and the proposer are the same identity.</summary>
    SegregationOfDuties,

    /// <summary>The approval belongs to a different request chain.</summary>
    CorrelationMismatch,
}

/// <summary>
/// A fill produced by the simulated OMS.
///
/// <see cref="ExecutionMode"/> is computed and has no setter. T-034 requires the simulated label to
/// live on the record rather than on the screen, so that a screenshot taken out of context is still
/// honest and so that no serialiser, mapper, or UI state can drop it. There is deliberately no way
/// to construct one of these that does not say SIMULATED.
/// </summary>
public sealed record SimulatedExecution
{
    public required string ExecutionId { get; init; }

    public required string ProposalId { get; init; }

    public required string OrderId { get; init; }

    public required string CorrelationId { get; init; }

    public required string VenueCode { get; init; }

    public required int Quantity { get; init; }

    public required decimal Price { get; init; }

    public required DateTimeOffset ExecutedAt { get; init; }

    /// <summary>The approval that authorised this fill. Never null on a real fill.</summary>
    public required string ApprovalId { get; init; }

    /// <summary>Always SIMULATED. Not settable, by design.</summary>
    ///
    /// CA1822 suppressed rather than satisfied. Making this static would remove it from the
    /// instance, and an instance member is exactly what is wanted: it must serialise onto every
    /// fill record so the label travels with the data. A static member labels the type; T-034
    /// needs the label on the row.
    [System.Diagnostics.CodeAnalysis.SuppressMessage(
        "Performance", "CA1822:Mark members as static",
        Justification = "Must serialise onto each record; T-034 requires the label on the row, not the type.")]
    public string ExecutionMode => "SIMULATED";
}

/// <summary>The OMS either filled, or refused and said why.</summary>
public sealed record ExecutionResult
{
    public SimulatedExecution? Execution { get; init; }

    public ExecutionRefusalReason? RefusalReason { get; init; }

    public string Explanation { get; init; } = string.Empty;

    public bool Executed => Execution is not null;
}

/// <summary>
/// The simulated order management system.
///
/// It exists to be refused by. Principle I says no consequential action executes without recorded
/// human approval, and the cheapest way for that to quietly stop being true is for an execution
/// path to exist that does not ask. So the approval check lives here, at the last point before a
/// fill, rather than only in the caller — a control placed only in the caller protects only the
/// callers that exist today.
/// </summary>
public static class SimulatedOms
{
    /// <summary>
    /// Attempts to execute an approved proposal.
    /// </summary>
    /// <param name="proposal">The route proposal.</param>
    /// <param name="authorization">The approval, or null to demonstrate the refusal path.</param>
    /// <param name="now">Execution time, injected so expiry is testable without waiting.</param>
    /// <param name="executionId">Deterministic id; defaults to one derived from the proposal.</param>
    public static ExecutionResult Execute(
        RouteProposal proposal,
        ExecutionAuthorization? authorization,
        DateTimeOffset now,
        string? executionId = null)
    {
        ArgumentNullException.ThrowIfNull(proposal);

        if (authorization is null)
        {
            return Refuse(
                ExecutionRefusalReason.NoAuthorization,
                "No approval was presented. A proposal is not an instruction.");
        }

        if (!string.Equals(authorization.ProposalId, proposal.ProposalId, StringComparison.Ordinal))
        {
            return Refuse(
                ExecutionRefusalReason.AuthorizationForDifferentProposal,
                $"Approval {authorization.ApprovalId} authorises proposal " +
                $"{authorization.ProposalId}, not {proposal.ProposalId}.");
        }

        if (!string.Equals(authorization.CorrelationId, proposal.CorrelationId, StringComparison.Ordinal))
        {
            return Refuse(
                ExecutionRefusalReason.CorrelationMismatch,
                $"Approval belongs to correlation {authorization.CorrelationId}, " +
                $"proposal to {proposal.CorrelationId}.");
        }

        // Checked before segregation of duties on purpose: a lapsed approval is not a valid
        // approval to then scrutinise the approver of.
        if (now >= authorization.ExpiresAt)
        {
            return Refuse(
                ExecutionRefusalReason.AuthorizationExpired,
                $"Approval {authorization.ApprovalId} expired at {authorization.ExpiresAt:u}. " +
                "Expiry is not approval.");
        }

        if (string.Equals(authorization.ApprovedBy, proposal.ProposedBy, StringComparison.OrdinalIgnoreCase))
        {
            return Refuse(
                ExecutionRefusalReason.SegregationOfDuties,
                $"Identity {authorization.ApprovedBy} both proposed and approved this route.");
        }

        return new ExecutionResult
        {
            Execution = new SimulatedExecution
            {
                ExecutionId = executionId ?? $"exec-{proposal.ProposalId}",
                ProposalId = proposal.ProposalId,
                OrderId = proposal.OrderId,
                CorrelationId = proposal.CorrelationId,
                VenueCode = proposal.VenueCode,
                Quantity = proposal.Quantity,
                Price = proposal.Cost.ProjectedPrice,
                ExecutedAt = now,
                ApprovalId = authorization.ApprovalId,
            },
            Explanation = $"Filled at {proposal.VenueCode} against the simulated OMS.",
        };
    }

    private static ExecutionResult Refuse(ExecutionRefusalReason reason, string explanation) =>
        new() { RefusalReason = reason, Explanation = explanation };
}
