using FluentAssertions;
using Fcmr.OrderRouting.Domain;
using Xunit;

namespace Fcmr.OrderRouting.Domain.Tests;

public class SimulatedOmsTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 10, 14, 0, 0, TimeSpan.Zero);

    private static RouteProposal Proposal(string proposedBy = "agent-orderrouting") =>
        RoutePlanner.Plan(
            Fixtures.Order(limit: 200m),
            [Fixtures.Quote()],
            BestExecutionPolicy.Default,
            proposedBy).Proposal!;

    private static ExecutionAuthorization Authorization(
        RouteProposal proposal,
        string approvedBy = "approver-desk-head",
        TimeSpan? validFor = null) => new()
        {
            ApprovalId = "appr-1",
            ProposalId = proposal.ProposalId,
            CorrelationId = proposal.CorrelationId,
            ApprovedBy = approvedBy,
            ApprovedAt = Now.AddMinutes(-5),
            ExpiresAt = Now.Add(validFor ?? TimeSpan.FromMinutes(30)),
        };

    [Fact]
    public void Executes_an_approved_proposal()
    {
        var proposal = Proposal();

        var result = SimulatedOms.Execute(proposal, Authorization(proposal), Now);

        result.Executed.Should().BeTrue();
        result.Execution!.VenueCode.Should().Be(proposal.VenueCode);
        result.Execution.ApprovalId.Should().Be("appr-1");
        result.Execution.Quantity.Should().Be(1_000);
        result.RefusalReason.Should().BeNull();
    }

    [Fact]
    public void Refuses_without_an_approval()
    {
        var result = SimulatedOms.Execute(Proposal(), null, Now);

        result.Executed.Should().BeFalse();
        result.RefusalReason.Should().Be(ExecutionRefusalReason.NoAuthorization);
        result.Explanation.Should().Contain("A proposal is not an instruction");
    }

    [Fact]
    public void Refuses_an_expired_approval_because_expiry_is_not_approval()
    {
        var proposal = Proposal();
        var lapsed = Authorization(proposal, validFor: TimeSpan.FromMinutes(-1));

        var result = SimulatedOms.Execute(proposal, lapsed, Now);

        result.Executed.Should().BeFalse();
        result.RefusalReason.Should().Be(ExecutionRefusalReason.AuthorizationExpired);
        result.Explanation.Should().Contain("Expiry is not approval");
    }

    [Fact]
    public void Refuses_at_the_exact_moment_of_expiry()
    {
        var proposal = Proposal();
        var authorization = Authorization(proposal) with { ExpiresAt = Now };

        SimulatedOms.Execute(proposal, authorization, Now)
            .RefusalReason.Should().Be(ExecutionRefusalReason.AuthorizationExpired,
                "the boundary is closed, so an approval expiring now has expired");
    }

    [Fact]
    public void Refuses_an_approval_issued_against_a_different_proposal()
    {
        var proposal = Proposal();
        var authorization = Authorization(proposal) with { ProposalId = "prop-someone-elses" };

        var result = SimulatedOms.Execute(proposal, authorization, Now);

        result.RefusalReason.Should().Be(ExecutionRefusalReason.AuthorizationForDifferentProposal);
        result.Explanation.Should().Contain("prop-someone-elses");
    }

    [Fact]
    public void Refuses_an_approval_from_a_different_request_chain()
    {
        var proposal = Proposal();
        var authorization = Authorization(proposal) with { CorrelationId = "corr-other" };

        SimulatedOms.Execute(proposal, authorization, Now)
            .RefusalReason.Should().Be(ExecutionRefusalReason.CorrelationMismatch);
    }

    [Fact]
    public void Refuses_when_the_proposer_approved_their_own_proposal()
    {
        var proposal = Proposal(proposedBy: "trader-alice");
        var authorization = Authorization(proposal, approvedBy: "trader-alice");

        var result = SimulatedOms.Execute(proposal, authorization, Now);

        result.RefusalReason.Should().Be(ExecutionRefusalReason.SegregationOfDuties);
        result.Explanation.Should().Contain("both proposed and approved");
    }

    [Fact]
    public void Self_approval_check_ignores_identity_casing()
    {
        var proposal = Proposal(proposedBy: "Trader-Alice");
        var authorization = Authorization(proposal, approvedBy: "trader-alice");

        SimulatedOms.Execute(proposal, authorization, Now)
            .RefusalReason.Should().Be(ExecutionRefusalReason.SegregationOfDuties,
                "a casing difference is not a different person");
    }

    [Fact]
    public void An_expired_approval_from_the_proposer_is_refused_for_expiry_first()
    {
        // Ordering matters: a lapsed approval is not a valid approval whose approver is then
        // scrutinised. Reporting segregation here would imply the approval was otherwise good.
        var proposal = Proposal(proposedBy: "trader-alice");
        var authorization = Authorization(proposal, approvedBy: "trader-alice", validFor: TimeSpan.FromMinutes(-1));

        SimulatedOms.Execute(proposal, authorization, Now)
            .RefusalReason.Should().Be(ExecutionRefusalReason.AuthorizationExpired);
    }

    [Fact]
    public void Every_fill_is_labelled_simulated()
    {
        var proposal = Proposal();

        var execution = SimulatedOms.Execute(proposal, Authorization(proposal), Now).Execution!;

        execution.ExecutionMode.Should().Be("SIMULATED");
    }

    [Fact]
    public void The_simulated_label_cannot_be_removed_by_copying_the_record()
    {
        // T-034: the label lives on the record so a screenshot out of context stays honest. A
        // `with` expression is the obvious way it would get lost, so that is the thing tested.
        var proposal = Proposal();
        var execution = SimulatedOms.Execute(proposal, Authorization(proposal), Now).Execution!;

        var copied = execution with { VenueCode = "XMER" };

        copied.ExecutionMode.Should().Be("SIMULATED");
        typeof(SimulatedExecution).GetProperty(nameof(SimulatedExecution.ExecutionMode))!
            .CanWrite.Should().BeFalse("a settable label is a label that can be unset");
    }

    [Fact]
    public void A_fill_carries_the_correlation_id_end_to_end()
    {
        var proposal = Proposal();

        var execution = SimulatedOms.Execute(proposal, Authorization(proposal), Now).Execution!;

        execution.CorrelationId.Should().Be("corr-1");
        execution.OrderId.Should().Be("ord-1");
        execution.ProposalId.Should().Be(proposal.ProposalId);
    }
}
