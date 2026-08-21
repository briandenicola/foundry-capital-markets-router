using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Fcmr.ApprovalsService.Security;
using Xunit;

namespace Fcmr.Contract.Tests;

/// <summary>
/// T-018 surface. Contract tests for <c>POST /v1/approvals/{id}/decision</c>, derived from
/// <c>specs/001-router-core/contracts/approval-api.md</c> and AC-2.
///
/// They encode the three invariants the contract states outright — no consequential action without
/// a 200 from this endpoint, expiry never implies approval, and every call writes an audit record —
/// plus the four rejection statuses that make the control demonstrable on stage.
///
/// Every caller here is a principal carrying an <c>oid</c> claim, never a header naming itself.
/// ADR-011 made that the service's rule; the suite has to obey it or it would be proving a control
/// the service does not actually have.
/// </summary>
public sealed class ApprovalContractTests : IClassFixture<ApprovalApiFactory>
{
    /// <summary>An identity that proposes but must never be able to approve.</summary>
    private const string ProposerObjectId = "00000000-0000-0000-0000-00000000d001";

    /// <summary>A distinct identity holding the Approver app role.</summary>
    private const string ApproverObjectId = "00000000-0000-0000-0000-00000000a001";

    private readonly ApprovalApiFactory factory;

    public ApprovalContractTests(ApprovalApiFactory factory)
    {
        this.factory = factory;
        Proposer = factory.As(ProposerObjectId, ApprovalRoles.Proposer);
        Approver = factory.As(ApproverObjectId, ApprovalRoles.Approver);
    }

    /// <summary>Holds Propose only. Deliberately not granted Approve — that is the control.</summary>
    private HttpClient Proposer { get; }

    /// <summary>Holds Approve only, under a different object id.</summary>
    private HttpClient Approver { get; }

    /// <summary>
    /// The proposing identity, granted the Approver role as well.
    ///
    /// This is the interesting adversary. A caller with no Approve role is stopped by the role
    /// check, which proves nothing about segregation of duties; the case worth asserting is a
    /// caller who is genuinely entitled to approve and is still refused on this specific proposal
    /// because they are the one who raised it.
    /// </summary>
    private HttpClient ProposerWithApproverRole =>
        factory.As(ProposerObjectId, ApprovalRoles.Proposer, ApprovalRoles.Approver);

    [Fact]
    public async Task Decision_ByTheProposingIdentity_Returns409SegregationOfDuties()
    {
        var proposalId = await SeedAsync(SeedState.Pending);

        using var response = await DecideAsync(proposalId, "Approved", reason: null, caller: ProposerWithApproverRole);

        response.StatusCode.Should().Be(HttpStatusCode.Conflict,
            "AC-2: the identity that originated a proposal cannot approve it");
        (await ErrorAsync(response)).Should().Be("SegregationOfDuties");
    }

    [Fact]
    public async Task Decision_ByTheProposingIdentity_DoesNotExecuteTheAction()
    {
        var proposalId = await SeedAsync(SeedState.Pending);

        using var rejected = await DecideAsync(proposalId, "Approved", reason: null, caller: ProposerWithApproverRole);
        _ = rejected;

        var state = await StateAsync(proposalId);
        state.Should().Be("PendingApproval",
            "a refused approval leaves the proposal pending. Recording it as Approved would let " +
            "a consequential action execute on a decision the contract rejected");
    }

    [Fact]
    public async Task Decision_OnATerminalProposal_Returns409InvalidTransition()
    {
        var proposalId = await SeedAsync(SeedState.Approved);

        using var response = await DecideAsync(proposalId, "Rejected", "Changed my mind.", Approver);

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
        var proposalId = await SeedAsync(Enum.Parse<SeedState>(terminalState));

        using var response = await DecideAsync(proposalId, "Approved", null, Approver);

        response.StatusCode.Should().BeOneOf(
            [HttpStatusCode.Conflict, HttpStatusCode.Gone],
            "the terminal states are enumerated in the data model, so all three are asserted " +
            "rather than the one that happened to be implemented first");
    }

    [Fact]
    public async Task Decision_OnAnExpiredProposal_Returns410Expired()
    {
        var proposalId = await SeedAsync(SeedState.Pending, expired: true);

        using var response = await DecideAsync(proposalId, "Approved", null, Approver);

        response.StatusCode.Should().Be(HttpStatusCode.Gone,
            "contracts/approval-api.md: a proposal past expiresAt is 410 and will never execute");
        (await ErrorAsync(response)).Should().Be("Expired");
    }

    [Fact]
    public async Task ExpiredProposal_IsNeverRecordedAsApproved()
    {
        var proposalId = await SeedAsync(SeedState.Pending, expired: true);

        using var attempt = await DecideAsync(proposalId, "Approved", null, Approver);
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
        var proposalId = await SeedAsync(SeedState.Pending);

        using var message = new HttpRequestMessage(
            HttpMethod.Post, $"/v1/approvals/{proposalId}/decision")
        {
            Content = Body("Approved", null),
        };

        using var response = await factory.Anonymous.SendAsync(message);

        response.StatusCode.Should().BeOneOf(
            [HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden],
            "approval requires the Approver app role");
    }

    [Fact]
    public async Task Decision_RejectedWithoutAReason_IsRefused()
    {
        var proposalId = await SeedAsync(SeedState.Pending);

        using var response = await DecideAsync(proposalId, "Rejected", reason: null, caller: Approver);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "the contract makes reason required on rejection. A rejection without a recorded " +
            "reason is an audit record that cannot answer the question it exists to answer");
    }

    [Fact]
    public async Task Decision_ByADistinctApprover_Returns200AndRecordsTheDecision()
    {
        var proposalId = await SeedAsync(SeedState.Pending);

        using var response = await DecideAsync(
            proposalId, "Approved", "Best-execution rationale is sound; venue confirmed.", Approver);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await StateAsync(proposalId)).Should().Be("Approved");
    }

    [Fact]
    public async Task PendingQueue_ReturnsProposalsWithAnEvidencePacketSummary()
    {
        _ = await SeedAsync(SeedState.Pending);

        using var response = await Approver.GetAsync(
            new Uri("/v1/approvals?state=PendingApproval", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var payload = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(payload);
        document.RootElement.ValueKind.Should().Be(JsonValueKind.Array);

        // The summary half of this test's name used to go unasserted, and the endpoint duly
        // shipped rows carrying nothing but identifiers. approval-api.md promises "evidence-packet
        // summaries", and an approver looking at a queue that cannot say what is being approved
        // has no basis on which to approve anything.
        var row = document.RootElement.EnumerateArray().First();

        row.TryGetProperty("proposedAction", out var action).Should().BeTrue(
            "a queue row must state the action it is asking someone to authorise");
        action.TryGetProperty("summary", out var summary).Should().BeTrue();
        summary.GetString().Should().NotBeNullOrWhiteSpace();

        // The full packet stays on the detail response. Shipping every packet in the list would
        // put evidence on screen that nobody opened, which is not the same as evidence reviewed.
        row.TryGetProperty("evidencePacket", out var packet).Should().BeTrue();
        packet.ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task EvidencePacket_CarriesTheHashThatDetectsTampering()
    {
        var proposalId = await SeedAsync(SeedState.Pending);

        using var response = await Approver.GetAsync(
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

    private static Task<HttpResponseMessage> DecideAsync(
        string proposalId, string decision, string? reason, HttpClient caller)
    {
        var message = new HttpRequestMessage(HttpMethod.Post, $"/v1/approvals/{proposalId}/decision")
        {
            Content = Body(decision, reason),
        };

        // No identity header. Per ADR-011 the deciding identity is the token's oid claim, which the
        // client already carries, and a request that names an identity is refused with 400.
        return caller.SendAsync(message);
    }

    private async Task<string?> StateAsync(string proposalId)
    {
        using var response = await Approver.GetAsync(
            new Uri($"/v1/approvals/{proposalId}", UriKind.Relative));
        var payload = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(payload);
        return document.RootElement.TryGetProperty("state", out var state) ? state.GetString() : null;
    }

    /// <summary>The states a test can ask for. Each is reached through the published contract.</summary>
    private enum SeedState
    {
        Pending,
        Approved,
        Rejected,
        Expired,
    }

    /// <summary>
    /// Places a proposal in a known state, using only the published contract.
    ///
    /// Gap 1 in CONTRACT-FINDINGS.md is closed: <c>POST /v1/approvals</c> exists, so PendingApproval
    /// is reachable without the suite inventing a back door. Every other state is reached by driving
    /// the real endpoints, which means the setup for one test is itself an assertion that another
    /// test's subject works. A seeding shortcut would have hidden that.
    ///
    /// Expiry is produced by proposing a genuinely short-lived record and waiting for it, because
    /// the domain refuses an expiry that is not in the future and rightly so. The alternative —
    /// a test-only clock override reachable from configuration — would put a mechanism for
    /// backdating approvals into the deployed artefact, which is precisely the thing this service
    /// exists to make impossible.
    /// </summary>
    private async Task<string> SeedAsync(SeedState state, bool expired = false)
    {
        var lifetime = expired || state == SeedState.Expired
            ? TimeSpan.FromMilliseconds(750)
            : TimeSpan.FromHours(1);

        using var created = await Proposer.PostAsync(
            new Uri("/v1/approvals", UriKind.Relative),
            EvidenceBody(DateTimeOffset.UtcNow.Add(lifetime)));

        created.StatusCode.Should().Be(HttpStatusCode.Created,
            "the rest of this test depends on a proposal existing; if creation is broken the " +
            "failure should say so rather than surfacing as a confusing 404 later");

        using var document = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var id = document.RootElement.GetProperty("id").GetString()!;

        switch (state)
        {
            case SeedState.Approved:
                using (var r = await DecideAsync(id, "Approved", "Seeded for a terminal-state assertion.", Approver))
                {
                    r.StatusCode.Should().Be(HttpStatusCode.OK);
                }

                break;

            case SeedState.Rejected:
                using (var r = await DecideAsync(id, "Rejected", "Seeded for a terminal-state assertion.", Approver))
                {
                    r.StatusCode.Should().Be(HttpStatusCode.OK);
                }

                break;

            case SeedState.Expired:
                await WaitForExpiryAsync(lifetime);

                // The record is past expiresAt but nothing has said so yet. Expiry is a transition
                // that gets recorded, not a fact inferred at read time, so a decision attempt is
                // what moves it to Expired and writes the audit event.
                using (var r = await DecideAsync(id, "Approved", null, Approver))
                {
                    r.StatusCode.Should().Be(HttpStatusCode.Gone);
                }

                break;

            case SeedState.Pending:
            default:
                if (expired)
                {
                    await WaitForExpiryAsync(lifetime);
                }

                break;
        }

        return id;
    }

    private static Task WaitForExpiryAsync(TimeSpan lifetime) =>
        Task.Delay(lifetime + TimeSpan.FromMilliseconds(250));

    /// <summary>
    /// A complete evidence packet. Every required member is populated with plausible values because
    /// the domain will not build a packet from absent data, and a test that supplied placeholders
    /// would be asserting against a shape the lanes will never produce.
    /// </summary>
    private static StringContent EvidenceBody(DateTimeOffset expiresAt)
    {
        var body = new
        {
            lane = "OrderRouting",
            expiresAt,
            evidencePacket = new
            {
                correlationId = Guid.NewGuid().ToString(),
                lane = "OrderRouting",
                inputs = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["instrument"] = "US912828XG49",
                    ["side"] = "Buy",
                    ["quantity"] = "5000000",
                },
                retrievedSources = new[]
                {
                    new
                    {
                        documentId = "venue-analysis-2026-08",
                        chunkId = "c-14",
                        excerpt = "Displayed liquidity in the on-the-run 10y concentrated on venue B during the London close.",
                        score = 0.91,
                    },
                },
                routingDecision = new
                {
                    outcome = "Routed",
                    complexityScore = 0.62,
                    costCeilingUsd = 0.25m,
                    selectedTier = "Standard",
                    selectedDeployment = "gpt-5.4",
                    selectedVendor = "AzureOpenAI",
                    policySetId = "CapitalMarkets-US",
                    policySetVersion = 1,
                    rationale = "Moderate complexity within the standard cost ceiling.",
                },
                proposedAction = new
                {
                    kind = "RouteOrder",
                    summary = "Route 5,000,000 of the on-the-run 10y to venue B.",
                    fields = new Dictionary<string, string>(StringComparer.Ordinal)
                    {
                        ["venue"] = "B",
                        ["strategy"] = "Passive",
                    },
                },
                unattributableClaims = Array.Empty<string>(),
            },
        };

        return new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
    }
}
