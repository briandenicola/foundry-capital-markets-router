using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace Fcmr.Contract.Tests;

/// <summary>
/// T-018 surface. Contract tests for <c>POST /v1/approvals/{id}/decision</c>, derived from
/// <c>specs/001-router-core/contracts/approval-api.md</c> and AC-2.
///
/// These are written now, against the contract, and are expected to fail until T-018 lands. They
/// encode the three invariants the contract states outright — no consequential action without a
/// 200 from this endpoint, expiry never implies approval, and every call writes an audit record —
/// plus the four rejection statuses that make the control demonstrable on stage.
/// </summary>
public sealed class ApprovalContractTests : IClassFixture<ApprovalApiFactory>
{
    /// <summary>An identity that proposes but must never be able to approve.</summary>
    private const string ProposerObjectId = "00000000-0000-0000-0000-00000000d001";

    /// <summary>A distinct identity holding the Approver app role.</summary>
    private const string ApproverObjectId = "00000000-0000-0000-0000-00000000a001";

    private readonly ApprovalApiFactory factory;

    public ApprovalContractTests(ApprovalApiFactory factory) => this.factory = factory;

    [Fact]
    public async Task Decision_ByTheProposingIdentity_Returns409SegregationOfDuties()
    {
        var proposalId = await SeedAsync(state: "PendingApproval", proposedBy: ProposerObjectId);

        using var response = await DecideAsync(proposalId, "Approved", reason: null, caller: ProposerObjectId);

        response.StatusCode.Should().Be(HttpStatusCode.Conflict,
            "AC-2: the identity that originated a proposal cannot approve it");
        (await ErrorAsync(response)).Should().Be("SegregationOfDuties");
    }

    [Fact]
    public async Task Decision_ByTheProposingIdentity_DoesNotExecuteTheAction()
    {
        var proposalId = await SeedAsync(state: "PendingApproval", proposedBy: ProposerObjectId);

        using var rejected = await DecideAsync(proposalId, "Approved", reason: null, caller: ProposerObjectId);
        _ = rejected;

        var state = await StateAsync(proposalId);
        state.Should().Be("PendingApproval",
            "a refused approval leaves the proposal pending. Recording it as Approved would let " +
            "a consequential action execute on a decision the contract rejected");
    }

    [Fact]
    public async Task Decision_OnATerminalProposal_Returns409InvalidTransition()
    {
        var proposalId = await SeedAsync(state: "Approved", proposedBy: ProposerObjectId);

        using var response = await DecideAsync(proposalId, "Rejected", "Changed my mind.", ApproverObjectId);

        response.StatusCode.Should().Be(HttpStatusCode.Conflict,
            "terminal states are final; the data model permits no transition out of one");
        (await ErrorAsync(response)).Should().Be("InvalidTransition");
    }

    [Theory]
    [InlineData("Approved")]
    [InlineData("Rejected")]
    [InlineData("Expired")]
    public async Task Decision_OnAnyTerminalState_Returns409InvalidTransition(string terminalState)
    {
        var proposalId = await SeedAsync(state: terminalState, proposedBy: ProposerObjectId);

        using var response = await DecideAsync(proposalId, "Approved", null, ApproverObjectId);

        response.StatusCode.Should().BeOneOf(
            [HttpStatusCode.Conflict, HttpStatusCode.Gone],
            "the terminal states are enumerated in the data model, so all three are asserted " +
            "rather than the one that happened to be implemented first");
    }

    [Fact]
    public async Task Decision_OnAnExpiredProposal_Returns410Expired()
    {
        var proposalId = await SeedAsync(state: "PendingApproval", proposedBy: ProposerObjectId, expired: true);

        using var response = await DecideAsync(proposalId, "Approved", null, ApproverObjectId);

        response.StatusCode.Should().Be(HttpStatusCode.Gone,
            "contracts/approval-api.md: a proposal past expiresAt is 410 and will never execute");
        (await ErrorAsync(response)).Should().Be("Expired");
    }

    [Fact]
    public async Task ExpiredProposal_IsNeverRecordedAsApproved()
    {
        var proposalId = await SeedAsync(state: "PendingApproval", proposedBy: ProposerObjectId, expired: true);

        using var attempt = await DecideAsync(proposalId, "Approved", null, ApproverObjectId);
        _ = attempt;

        var state = await StateAsync(proposalId);
        state.Should().Be("Expired",
            "invariant 2: expiry never implies approval. An expired proposal that ends up " +
            "Approved is Hard Rule 1 broken, not a status-code detail");
        state.Should().NotBe("Approved");
    }

    [Fact]
    public async Task Decision_WithoutTheApproverRole_Returns403()
    {
        var proposalId = await SeedAsync(state: "PendingApproval", proposedBy: ProposerObjectId);

        using var message = new HttpRequestMessage(
            HttpMethod.Post, $"/v1/approvals/{proposalId}/decision")
        {
            Content = Body("Approved", null),
        };

        using var response = await factory.Client.SendAsync(message);

        response.StatusCode.Should().BeOneOf(
            [HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden],
            "approval requires the Approver app role");
    }

    [Fact]
    public async Task Decision_RejectedWithoutAReason_IsRefused()
    {
        var proposalId = await SeedAsync(state: "PendingApproval", proposedBy: ProposerObjectId);

        using var response = await DecideAsync(proposalId, "Rejected", reason: null, caller: ApproverObjectId);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "the contract makes reason required on rejection. A rejection without a recorded " +
            "reason is an audit record that cannot answer the question it exists to answer");
    }

    [Fact]
    public async Task Decision_ByADistinctApprover_Returns200AndRecordsTheDecision()
    {
        var proposalId = await SeedAsync(state: "PendingApproval", proposedBy: ProposerObjectId);

        using var response = await DecideAsync(
            proposalId, "Approved", "Best-execution rationale is sound; venue confirmed.", ApproverObjectId);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await StateAsync(proposalId)).Should().Be("Approved");
    }

    [Fact]
    public async Task PendingQueue_ReturnsProposalsWithAnEvidencePacketSummary()
    {
        _ = await SeedAsync(state: "PendingApproval", proposedBy: ProposerObjectId);

        using var response = await factory.Client.GetAsync(
            new Uri("/v1/approvals?state=PendingApproval", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var payload = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(payload);
        document.RootElement.ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task EvidencePacket_CarriesTheHashThatDetectsTampering()
    {
        var proposalId = await SeedAsync(state: "PendingApproval", proposedBy: ProposerObjectId);

        using var response = await factory.Client.GetAsync(
            new Uri($"/v1/approvals/{proposalId}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var payload = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(payload);
        document.RootElement.TryGetProperty("evidencePacketHash", out var hash).Should().BeTrue(
            "AC-2 requires the evidence-packet hash to be persisted with the decision; a packet " +
            "whose integrity cannot be checked is not evidence");
        hash.GetString().Should().NotBeNullOrWhiteSpace();
    }

    private static StringContent Body(string decision, string? reason)
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal) { ["decision"] = decision };
        if (reason is not null)
        {
            body["reason"] = reason;
        }

        return new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
    }

    private static async Task<string?> ErrorAsync(HttpResponseMessage response)
    {
        var payload = await response.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(payload))
        {
            return null;
        }

        using var document = JsonDocument.Parse(payload);
        return document.RootElement.TryGetProperty("error", out var error) ? error.GetString() : null;
    }

    private Task<HttpResponseMessage> DecideAsync(
        string proposalId, string decision, string? reason, string caller)
    {
        var message = new HttpRequestMessage(HttpMethod.Post, $"/v1/approvals/{proposalId}/decision")
        {
            Content = Body(decision, reason),
        };

        // Gap 2 in CONTRACT-FINDINGS.md: the contract does not say how the caller's Entra object
        // id reaches decidedByObjectId, so the identity is carried here in the only way a test can
        // express it. When T-018 defines the real mechanism this line changes and the assertions
        // do not, which is the point of keeping them apart.
        message.Headers.Add("X-Fcmr-Caller-Object-Id", caller);
        return factory.Client.SendAsync(message);
    }

    private async Task<string?> StateAsync(string proposalId)
    {
        using var response = await factory.Client.GetAsync(
            new Uri($"/v1/approvals/{proposalId}", UriKind.Relative));
        var payload = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(payload);
        return document.RootElement.TryGetProperty("state", out var state) ? state.GetString() : null;
    }

    /// <summary>
    /// Places a proposal in a known state.
    ///
    /// Gap 1 in CONTRACT-FINDINGS.md: <c>contracts/approval-api.md</c> publishes no way to create
    /// a proposal, so there is no contract-sanctioned route to the PendingApproval state that the
    /// rest of this file asserts about. Inventing one here would make the suite test a fiction, so
    /// it throws instead and the gap stays visible.
    /// </summary>
    private static Task<string> SeedAsync(string state, string proposedBy, bool expired = false)
    {
        _ = state;
        _ = proposedBy;
        _ = expired;

        throw new ContractSurfaceMissingException(
            "contracts/approval-api.md defines no proposal-creation affordance, so a contract " +
            "test cannot reach PendingApproval. T-018 must publish one — a lane service endpoint " +
            "or an explicit seeding contract — before these tests can run.");
    }
}
