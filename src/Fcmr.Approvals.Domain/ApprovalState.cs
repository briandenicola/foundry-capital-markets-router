namespace Fcmr.Approvals.Domain;

/// <summary>
/// The lane that produced a proposal. Mirrors the lane enum in data-model.md.
/// </summary>
public enum Lane
{
    Research,
    Surveillance,
    OrderRouting,
}

/// <summary>
/// The state of an approval, named exactly as contracts/approval-api.md and data-model.md name it.
///
/// Divergent naming between the domain and the published contract is how a 409 becomes a 500, so
/// these four members are the whole set and are not extended for convenience.
///
/// <para>
/// <b>On the absence of an Executed state.</b> Execution is deliberately not a state of this
/// aggregate. Three reasons, in descending order of how much they would hurt:
/// </para>
/// <list type="number">
///   <item>
///     An approval answers one question — <em>did an authorised human, other than the proposer,
///     agree to this exact evidence before it acted?</em> That answer is final the moment it is
///     recorded. Execution answers a different question, has its own failure modes (in flight,
///     failed, partially filled, retried), and adding it here would drag Executing, Failed, and
///     Retrying in behind it. The aggregate would stop being an approval record and become a job
///     tracker, and the control we most need to be simple would become the most complex thing in
///     the repository.
///   </item>
///   <item>
///     data-model.md pins the persisted enum at four members with the note that terminal states
///     are final. A fifth member here would mean either a schema deviation or a domain that
///     silently disagrees with what is written to Cosmos.
///   </item>
///   <item>
///     Keeping execution out preserves the property the audience will actually probe: an approval
///     is <em>authorisation</em>, never <em>action</em>. Nothing in this assembly can execute
///     anything; the most it can do is state that execution is authorised. See
///     <see cref="ExecutionGate"/>, which issues that authorisation and refuses in every other
///     case, and docs/adr/008-approval-domain-boundaries.md, which records the decision.
///   </item>
/// </list>
/// </summary>
public enum ApprovalState
{
    /// <summary>Proposed and awaiting a human decision. The only non-terminal state.</summary>
    PendingApproval,

    /// <summary>A second human agreed. The only state from which execution may be authorised.</summary>
    Approved,

    /// <summary>A second human declined. Terminal, and carries a required reason.</summary>
    Rejected,

    /// <summary>
    /// The proposal passed expiresAt without a decision. Terminal, and never implies approval.
    /// There is no configuration, flag, or default anywhere in this assembly that turns this state
    /// into <see cref="Approved"/>; the transition table simply has no such edge.
    /// </summary>
    Expired,
}

/// <summary>
/// The three things that can be attempted against an approval.
///
/// Modelled as an enum as well as a command type so the transition table can be enumerated in full
/// by tests: four states times three triggers is twelve pairs, and every one of them is asserted.
/// A trigger added here without a table entry fails to compile the switch, and a table entry added
/// without a test fails the exhaustiveness test.
/// </summary>
public enum ApprovalTrigger
{
    Approve,
    Reject,
    Expire,
}
