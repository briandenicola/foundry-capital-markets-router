using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace Fcmr.LaneServices.Tests;

/// <summary>
/// Exercises the order routing host over real HTTP.
///
/// The cases chosen are the ones where a wrong answer is a governance defect rather than a bug: a
/// policy halt that looks like a client error, an execution that runs without an approval, a
/// proposer approving their own order, and an approval replayed to double a fill. Each of those is
/// a sentence somebody will say out loud in front of a compliance audience, so each has a test.
/// </summary>
public sealed class OrderRoutingHostTests : IDisposable
{
    private const string ProposerRole = "OrderRouting.Propose";
    private const string ExecutorRole = "OrderRouting.Execute";

    private readonly LaneHost<Fcmr.OrderRoutingService.Contracts.RouteProposalRequest> host =
        new("OrderRouting:Authorization:Enabled");

    public void Dispose() => host.Dispose();

    private static object ValidProposal(string orderId = "ORD-1") => new
    {
        orderId,
        symbol = "CONT",
        side = "Buy",
        quantity = 5_000,

        // Above the projected price. A limit at the arrival mid is breached by the spread and
        // impact the venue actually charges, which is a policy halt rather than a routable order.
        limitPrice = 101m,
        arrivalMidPrice = 100m,
        quotes = new[]
        {
            new
            {
                venueCode = "XLIT",
                type = "Lit",
                midPrice = 100m,
                spread = 0.05m,
                displayedLiquidity = 200_000,
                feeBps = 0.2m,
            },
        },
    };

    [Fact]
    public async Task Anonymous_caller_cannot_propose()
    {
        using var client = host.Anonymous();

        var response = await client.PostAsJsonAsync("/v1/route-proposals", ValidProposal());

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Proposer_role_does_not_carry_execute()
    {
        using var client = host.CallerWith(ProposerRole);

        var response = await client.PostAsJsonAsync("/v1/executions", new
        {
            proposalId = "anything",
            correlationId = Guid.NewGuid().ToString(),
        });

        // Refused before the proposal is even looked up. Holding the right to propose is not the
        // right to execute; that separation is the reason the two roles exist.
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Policy_breach_is_422_and_names_the_boundary()
    {
        using var client = host.CallerWith(ProposerRole);

        var response = await client.PostAsJsonAsync("/v1/route-proposals", new
        {
            orderId = "ORD-DARK",
            symbol = "CONT",
            side = "Buy",

            // Below the dark pool minimum, and no lit venue offered.
            quantity = 100,
            limitPrice = 100m,
            arrivalMidPrice = 100m,
            quotes = new[]
            {
                new
                {
                    venueCode = "DARK-1",
                    type = "Dark",
                    midPrice = 100m,
                    spread = 0.02m,
                    displayedLiquidity = 0,
                    feeBps = 0.1m,
                },
            },
        });

        // 422, not 400: understood and refused, not malformed. In an audit trail the two must not
        // look alike.
        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var body = await ReadAsync(response);
        body.GetProperty("status").GetString().Should().Be("Halted");
        body.GetProperty("breaches").GetArrayLength().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task Execution_without_an_approval_is_refused()
    {
        var proposalId = await ProposeAsync("ORD-NOAPPROVAL");

        using var executor = host.CallerWith(ExecutorRole, "approver-1");
        var response = await executor.PostAsJsonAsync("/v1/executions", new
        {
            proposalId,
            correlationId = Guid.NewGuid().ToString(),
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var body = await ReadAsync(response);
        body.GetProperty("executed").GetBoolean().Should().BeFalse();
        body.GetProperty("refusal").GetString().Should().Be("NoAuthorization");
    }

    [Fact]
    public async Task Proposer_cannot_approve_their_own_order()
    {
        const string SameIdentity = "trader-42";
        var (proposalId, correlationId) = await ProposeWithCorrelationAsync("ORD-SOD", SameIdentity);

        using var executor = host.CallerWith(ExecutorRole, SameIdentity);
        var response = await executor.PostAsJsonAsync("/v1/executions", Execution(proposalId, correlationId, SameIdentity));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var body = await ReadAsync(response);
        body.GetProperty("refusal").GetString().Should().Be("SegregationOfDuties");
    }

    [Fact]
    public async Task An_expired_approval_does_not_execute()
    {
        var (proposalId, correlationId) = await ProposeWithCorrelationAsync("ORD-EXPIRED", "trader-1");

        using var executor = host.CallerWith(ExecutorRole, "approver-1");
        var response = await executor.PostAsJsonAsync("/v1/executions", new
        {
            proposalId,
            correlationId,
            approval = new
            {
                approvalId = "APR-EXPIRED",
                approvedBy = "approver-1",
                approvedAt = DateTimeOffset.UtcNow.AddHours(-3),
                expiresAt = DateTimeOffset.UtcNow.AddHours(-1),
            },
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var body = await ReadAsync(response);

        // Expiry is not approval. An elapsed window is the absence of a decision, not a quiet yes.
        body.GetProperty("refusal").GetString().Should().Be("AuthorizationExpired");
    }

    [Fact]
    public async Task An_approval_cannot_be_replayed()
    {
        var (proposalId, correlationId) = await ProposeWithCorrelationAsync("ORD-REPLAY", "trader-1");

        using var executor = host.CallerWith(ExecutorRole, "approver-1");
        var payload = Execution(proposalId, correlationId, "approver-1");

        var first = await executor.PostAsJsonAsync("/v1/executions", payload);
        first.StatusCode.Should().Be(HttpStatusCode.Created);

        var second = await executor.PostAsJsonAsync("/v1/executions", payload);

        // 409, and no second fill. One approval authorises one execution; replaying it would
        // double an order without a second human seeing it.
        second.StatusCode.Should().Be(HttpStatusCode.Conflict);

        var body = await ReadAsync(second);
        body.GetProperty("executed").GetBoolean().Should().BeFalse();
        body.GetProperty("refusal").GetString().Should().Be("AlreadyExecuted");
    }

    [Fact]
    public async Task A_successful_execution_is_marked_simulated()
    {
        var (proposalId, correlationId) = await ProposeWithCorrelationAsync("ORD-OK", "trader-1");

        using var executor = host.CallerWith(ExecutorRole, "approver-1");
        var response = await executor.PostAsJsonAsync(
            "/v1/executions", Execution(proposalId, correlationId, "approver-1"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var body = await ReadAsync(response);
        body.GetProperty("executed").GetBoolean().Should().BeTrue();

        // On the record itself, not only on the screen. Nothing reached a real market, and the
        // artefact says so wherever it is later read.
        body.GetProperty("execution").GetProperty("executionMode").GetString().Should().Be("SIMULATED");
    }

    private static object Execution(string proposalId, string correlationId, string approvedBy) => new
    {
        proposalId,
        correlationId,
        approval = new
        {
            approvalId = "APR-1",
            approvedBy,
            approvedAt = DateTimeOffset.UtcNow.AddMinutes(-1),
            expiresAt = DateTimeOffset.UtcNow.AddMinutes(30),
        },
    };

    private async Task<string> ProposeAsync(string orderId)
    {
        var (proposalId, _) = await ProposeWithCorrelationAsync(orderId, "trader-1");
        return proposalId;
    }

    private async Task<(string ProposalId, string CorrelationId)> ProposeWithCorrelationAsync(
        string orderId, string proposedBy)
    {
        using var proposer = host.CallerWith(ProposerRole, proposedBy);

        var response = await proposer.PostAsJsonAsync("/v1/route-proposals", ValidProposal(orderId));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var body = await ReadAsync(response);
        var proposal = body.GetProperty("proposal");

        return (proposal.GetProperty("proposalId").GetString()!,
                body.GetProperty("correlationId").GetString()!);
    }

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
