using System.Net;
using FluentAssertions;
using Xunit;

namespace Fcmr.Contract.Tests;

/// <summary>
/// T-015. Contract tests for <c>POST /v1/route</c>, derived from
/// <c>specs/001-router-core/contracts/router-api.md</c> and its Feature 002 policy extension,
/// <c>specs/002-governed-exchange/contracts/router-api-policy-extension.md</c>.
///
/// Written against the published contract and not against the handler. Where the two disagree the
/// handler is wrong until an ADR says otherwise, so these assertions are not adjusted to match
/// whatever the service currently returns.
/// </summary>
public sealed class RouteContractTests : IClassFixture<RouterApiFactory>
{
    private const string Route = "/v1/route";

    private readonly RouterApiFactory factory;

    public RouteContractTests(RouterApiFactory factory) => this.factory = factory;

    // ---- Happy paths ------------------------------------------------------------------------

    [Fact]
    public async Task Route_ComplexTaskWithinCeiling_Returns200WithARoutedDecision()
    {
        var request = RouteRequestBuilder.Canonical();

        using var response = await PostAsync(request);

        response.Status.Should().Be(HttpStatusCode.OK);
        response.Outcome.Should().BeOneOf(
            "Routed", "Downgraded",
            "A request inside its ceiling with an eligible catalog must route or downgrade.");
        response.SelectedDeployment.Should().NotBeNullOrWhiteSpace(
            "a routed decision names the deployment that ran; the scoreboard's cost attribution " +
            "is only as honest as that identification");
        response.Rationale.Should().NotBeNullOrWhiteSpace(
            "AC-1 requires a human-readable rationale on every decision record");
        response.CandidateTiers.Should().NotBeEmpty(
            "AC-1 requires the considered tiers to be persisted and surfaced, not just the winner");
    }

    [Fact]
    public async Task Route_CeilingBelowIndicatedTier_DowngradesRatherThanDenies()
    {
        // Complexity 1.0 indicates Premium. The ceiling admits Standard but not Premium, so the
        // control must bite by downgrading — denial here would be over-enforcement, and routing
        // to Premium anyway would be no enforcement at all.
        var request = RouteRequestBuilder.Canonical()
            .With("costCeilingUsd", 0.05m)
            .With("complexityHints", RouteRequestBuilder.Hints(64000, true, true, true));

        using var response = await PostAsync(request);

        response.Status.Should().Be(HttpStatusCode.OK);
        response.Outcome.Should().Be("Downgraded",
            "an affordable cheaper tier exists, and the contract downgrades before it denies");
        response.SelectedTier.Should().NotBe("Premium",
            "the selected tier must be one the ceiling actually admits");
        response.Rationale.Should().NotBeNullOrWhiteSpace();
    }

    // ---- 402 Denied -------------------------------------------------------------------------

    [Fact]
    public async Task Route_CeilingBelowEveryTier_Returns402CostCeilingExceeded()
    {
        var request = RouteRequestBuilder.Canonical().With("costCeilingUsd", 0.000001m);

        using var response = await PostAsync(request);

        response.Status.Should().Be(HttpStatusCode.PaymentRequired,
            "contracts/router-api.md maps a cost-ceiling denial to 402");
        response.Error.Should().Be("CostCeilingExceeded");
        response.Outcome.Should().Be("Denied");
        response.SelectedDeployment.Should().BeNull(
            "nothing ran, so naming a deployment would put an unexecuted model in the audit trail");
    }

    [Fact]
    public async Task Route_Denial_CarriesARationaleAndIsNeverSilentlyAbsorbed()
    {
        var request = RouteRequestBuilder.Canonical().With("costCeilingUsd", 0.000001m);

        using var response = await PostAsync(request);

        response.Rationale.Should().NotBeNullOrWhiteSpace(
            "AC-1: a denial is surfaced to the UI with its reason, never silently absorbed");
        response.CorrelationId.Should().Be(request.CorrelationId);
    }

    // ---- 200 RefusedByPolicy ----------------------------------------------------------------

    [Fact]
    public async Task Route_GovernanceRefusal_IsA200AndNeverA402()
    {
        // Restricted data with a generous ceiling. Cost cannot be the reason nothing is eligible,
        // so any refusal here is a governance refusal.
        var request = RouteRequestBuilder.Canonical()
            .With("dataClassification", "Restricted")
            .With("costCeilingUsd", 1000m);

        using var response = await PostAsync(request);

        response.Status.Should().Be(HttpStatusCode.OK,
            "RefusedByPolicy is a correct, governed outcome carried on a 200. Modelling it as a " +
            "4xx invites retry-on-error logic, and the one thing that must never happen is a " +
            "retry that finds an unapproved model");
        response.Outcome.Should().NotBe("Denied",
            "'too expensive' and 'not permitted' are different conversations with different " +
            "owners; a governance outcome must not arrive wearing the cost outcome's label");
    }

    [Fact]
    public async Task Route_WhenRefusedByPolicy_NamesEveryExcludedCandidateWithAReason()
    {
        var request = RouteRequestBuilder.Canonical()
            .With("dataClassification", "Restricted")
            .With("costCeilingUsd", 1000m);

        using var response = await PostAsync(request);

        response.Status.Should().Be(HttpStatusCode.OK);
        response.Outcome.Should().Be("RefusedByPolicy",
            "the governance baseline does not permit Restricted data. If widening it is a " +
            "deliberate policy change this assertion changes with it, which is the point: " +
            "loosening what the exchange refuses should never be a silent edit");
        response.SelectedDeployment.Should().BeNull("a refusal selected nothing");
        response.PolicyExclusions.Should().NotBeEmpty(
            "the policy extension requires every candidate governance removed to be listed");
        response.PolicyExclusions.Should().AllSatisfy(exclusion =>
            exclusion.GetProperty("reason").GetString().Should().NotBeNullOrWhiteSpace(
                "the presenter reads one of these aloud in Beat 5; 'policy' is not an answer a " +
                "governance audience accepts"));
    }

    /// <summary>
    /// ADR-007. A response may report that no model ran; it may not imply that one did.
    /// </summary>
    [Theory]
    [MemberData(nameof(OutcomeProbes))]
    public async Task Route_NeverReturnsAResultWithoutAnInvocation(
        string probe, decimal ceiling, string classification, int tokens)
    {
        _ = probe;
        var request = RouteRequestBuilder.Canonical()
            .With("costCeilingUsd", ceiling)
            .With("dataClassification", classification)
            .With("complexityHints", RouteRequestBuilder.Hints(tokens, true, true, true));

        using var response = await PostAsync(request);

        if (response.WasModelInvoked)
        {
            return;
        }

        var result = response.Result;
        var hasContent = result is { } value && value.ValueKind != System.Text.Json.JsonValueKind.Null;

        hasContent.Should().BeFalse(
            "no model call was made, so any content in result would be model-shaped output that " +
            "no model produced — the defect ADR-007 exists to prevent");
    }

    /// <summary>
    /// The load-bearing distinction, asserted as a total function rather than case by case: the
    /// HTTP status is determined by the outcome, and no outcome maps to two statuses.
    /// </summary>
    [Theory]
    [MemberData(nameof(OutcomeProbes))]
    public async Task Route_StatusIsDeterminedByOutcome(string probe, decimal ceiling, string classification, int tokens)
    {
        _ = probe;
        var request = RouteRequestBuilder.Canonical()
            .With("costCeilingUsd", ceiling)
            .With("dataClassification", classification)
            .With("complexityHints", RouteRequestBuilder.Hints(tokens, true, true, true));

        using var response = await PostAsync(request);

        var expected = response.Outcome switch
        {
            "Routed" or "Downgraded" or "RefusedByPolicy" => [HttpStatusCode.OK],
            // A denial is 402 when nothing is affordable and 503 when nothing is available. Both
            // are enumerated in the status-by-outcome table; neither is a 200.
            "Denied" => new[] { HttpStatusCode.PaymentRequired, HttpStatusCode.ServiceUnavailable },
            null => [HttpStatusCode.BadRequest],
            _ => throw new InvalidOperationException(
                $"Unknown outcome '{response.Outcome}'. The contract enumerates Routed, " +
                "Downgraded, Denied, and RefusedByPolicy."),
        };

        response.Status.Should().BeOneOf(expected,
            "status and outcome must agree; a client that branches on one and logs the other " +
            "would report a governance refusal as a billing failure");
    }

    public static TheoryData<string, decimal, string, int> OutcomeProbes() => new()
    {
        { "affordable-simple", 0.25m, "Public", 500 },
        { "affordable-complex", 0.25m, "Internal", 64000 },
        { "ceiling-forces-downgrade", 0.05m, "Internal", 64000 },
        { "ceiling-below-everything", 0.000001m, "Internal", 12000 },
        { "restricted-generous-ceiling", 1000m, "Restricted", 12000 },
        { "confidential-tight-ceiling", 0.005m, "Confidential", 32000 },
    };

    // ---- correlationId round-trip (AC-8) -----------------------------------------------------

    [Theory]
    [MemberData(nameof(OutcomeProbes))]
    public async Task Route_EchoesTheCorrelationId_OnEveryResponseIncludingErrors(
        string probe, decimal ceiling, string classification, int tokens)
    {
        _ = probe;
        var request = RouteRequestBuilder.Canonical()
            .With("costCeilingUsd", ceiling)
            .With("dataClassification", classification)
            .With("complexityHints", RouteRequestBuilder.Hints(tokens, true, true, true));

        using var response = await PostAsync(request);

        response.CorrelationId.Should().Be(request.CorrelationId,
            "AC-8 requires one-query reconstruction. An error path that drops the correlation ID " +
            "is an audit hole exactly where it is most needed");
    }

    [Fact]
    public async Task Route_EchoesTheCorrelationId_OnACostDenial()
    {
        var request = RouteRequestBuilder.Canonical().With("costCeilingUsd", 0.000001m);

        using var response = await PostAsync(request);

        response.Status.Should().Be(HttpStatusCode.PaymentRequired);
        response.CorrelationId.Should().Be(request.CorrelationId);
    }

    // ---- Principle IV: the caller cannot name a model --------------------------------------

    [Fact]
    public async Task Route_CallerCannotNameADeployment()
    {
        var smuggled = "premium-please";
        var control = RouteRequestBuilder.Canonical()
            .With("complexityHints", RouteRequestBuilder.Hints(200, false, false, false));
        var attack = RouteRequestBuilder.Canonical()
            .With("complexityHints", RouteRequestBuilder.Hints(200, false, false, false))
            .With("deployment", smuggled)
            .With("selectedDeployment", smuggled)
            .With("model", smuggled);

        using var controlResponse = await PostAsync(control);
        using var attackResponse = await PostAsync(attack);

        attackResponse.SelectedDeployment.Should().NotBe(smuggled,
            "RoutingRequest deliberately has no deployment field. If a caller-supplied name is " +
            "honoured, the central claim that applications never select models is false");
        attackResponse.DeploymentsMentioned.Should().NotContain(smuggled,
            "a smuggled name must not reach the decision record at all, not even as a candidate");
        attackResponse.SelectedDeployment.Should().Be(controlResponse.SelectedDeployment,
            "the same task must route identically whether or not the caller expressed a preference");
    }

    [Fact]
    public async Task Route_CallerCannotNameATier()
    {
        var control = RouteRequestBuilder.Canonical()
            .With("complexityHints", RouteRequestBuilder.Hints(200, false, false, false));
        var attack = RouteRequestBuilder.Canonical()
            .With("complexityHints", RouteRequestBuilder.Hints(200, false, false, false))
            .With("tier", "Premium")
            .With("selectedTier", "Premium");

        using var controlResponse = await PostAsync(control);
        using var attackResponse = await PostAsync(attack);

        attackResponse.SelectedTier.Should().Be(controlResponse.SelectedTier,
            "tier is derived from complexity and cost, never accepted from the caller");
    }

    [Fact]
    public async Task Route_CallerCannotNameAVendor()
    {
        var control = RouteRequestBuilder.Canonical();
        var attack = RouteRequestBuilder.Canonical()
            .With("vendor", "Anthropic")
            .With("selectedVendor", "Anthropic");

        using var controlResponse = await PostAsync(control);
        using var attackResponse = await PostAsync(attack);

        attackResponse.SelectedDeployment.Should().Be(controlResponse.SelectedDeployment,
            "vendor choice is a governance decision, not a caller preference");
    }

    // ---- Policy is evaluated before cost and complexity -------------------------------------

    [Fact]
    public async Task Route_NeverSelectsADeploymentItAlsoExcluded()
    {
        var request = RouteRequestBuilder.Canonical()
            .With("dataClassification", "Restricted")
            .With("costCeilingUsd", 1000m);

        using var response = await PostAsync(request);

        var excluded = response.PolicyExclusions
            .Select(e => e.TryGetProperty("deployment", out var d) ? d.GetString() : null)
            .Where(d => d is not null)
            .ToList();

        if (response.SelectedDeployment is { } selected)
        {
            excluded.Should().NotContain(selected,
                "governance runs first and cost chooses only among what governance permitted; a " +
                "selection that also appears in the exclusion list means the order was reversed");
        }
    }

    [Fact]
    public async Task Route_RecordsThePolicySetThatGovernedTheDecision()
    {
        var request = RouteRequestBuilder.Canonical()
            .With("policySetId", "CapitalMarkets-US");

        using var response = await PostAsync(request);

        var decision = response.Decision;
        decision.Should().NotBeNull("every response carries the decision that produced it");

        decision!.Value.TryGetProperty("policySetId", out _).Should().BeTrue(
            "the policy extension pins the governing policy set onto the decision. Without it, " +
            "replaying an audit record after a policy edit shows a decision that appears to " +
            "violate the policy in force — the finding an auditor escalates");
        decision.Value.TryGetProperty("policySetVersion", out _).Should().BeTrue(
            "the version in force at decision time is pinned, not looked up at replay time");
    }

    // ---- Request validation ------------------------------------------------------------------

    [Fact]
    public async Task Route_WithoutADataClassification_Returns400()
    {
        var request = RouteRequestBuilder.Canonical().Without("dataClassification");

        using var response = await PostAsync(request);

        response.Status.Should().Be(HttpStatusCode.BadRequest,
            "the policy extension is explicit: an omitted classification is a 400, not an " +
            "assumption of Public. Defaulting it is how restricted data reaches a vendor that " +
            "should not see it");
    }

    [Theory]
    [InlineData("lane")]
    [InlineData("taskKind")]
    [InlineData("costCeilingUsd")]
    [InlineData("complexityHints")]
    public async Task Route_WithoutARequiredField_Returns400(string field)
    {
        var request = RouteRequestBuilder.Canonical().Without(field);

        using var response = await PostAsync(request);

        response.Status.Should().Be(HttpStatusCode.BadRequest,
            $"'{field}' is listed as required. A required field that is silently defaulted is a " +
            "decision made by the router on the caller's behalf and recorded as if the caller " +
            "made it");
    }

    [Fact]
    public async Task Route_WithAPayloadThatNamesAModel_Returns400()
    {
        var request = RouteRequestBuilder.Canonical()
            .With("payload", new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["question"] = "Summarise the desk's overnight risk.",
                ["model"] = "gpt-5.6-sol",
            });

        using var response = await PostAsync(request);

        response.Status.Should().Be(HttpStatusCode.BadRequest,
            "payload is opaque to the router but is screened for keys that amount to the caller " +
            "choosing its own model. An opaque field is the obvious place to smuggle one");
    }

    [Fact]
    public async Task Route_WhenHeaderAndBodyCorrelationIdsDisagree_Returns400()
    {
        var request = RouteRequestBuilder.Canonical();
        using var message = new HttpRequestMessage(HttpMethod.Post, Route)
        {
            Content = request.AsContent(),
        };
        message.Headers.Add("X-Correlation-Id", Guid.NewGuid().ToString());

        using var httpResponse = await factory.Authorized.SendAsync(message);
        using var response = await RouteResponse.ReadAsync(httpResponse);

        response.Status.Should().Be(HttpStatusCode.BadRequest,
            "a conflict is a 400 rather than a precedence rule: splitting one interaction across " +
            "two ids breaks the single-query reconstruction AC-8 depends on");
    }

    [Theory]
    [MemberData(nameof(OutcomeProbes))]
    public async Task Route_CarriesTheCorrelationIdInTheResponseHeaderToo(
        string probe, decimal ceiling, string classification, int tokens)
    {
        _ = probe;
        var request = RouteRequestBuilder.Canonical()
            .With("costCeilingUsd", ceiling)
            .With("dataClassification", classification)
            .With("complexityHints", RouteRequestBuilder.Hints(tokens, true, true, true));

        using var httpResponse = await factory.Authorized.PostAsync(
            new Uri(Route, UriKind.Relative), request.AsContent());

        httpResponse.Headers.TryGetValues("X-Correlation-Id", out var values).Should().BeTrue(
            "the contract requires the correlation id on every response in the body and in the " +
            "X-Correlation-Id header");
        values.Should().ContainSingle().Which.Should().Be(request.CorrelationId);
    }

    // ---- Authorisation -----------------------------------------------------------------------

    [Fact]
    public async Task Route_WithoutACredential_IsNeverServed()
    {
        var request = RouteRequestBuilder.Canonical();

        using var httpResponse = await factory.Anonymous.PostAsync(new Uri(Route, UriKind.Relative), request.AsContent());
        using var response = await RouteResponse.ReadAsync(httpResponse);

        response.Status.Should().Be(HttpStatusCode.Forbidden,
            "the contract names one status for 'not permitted to invoke'. An anonymous caller " +
            "reaching the router at all would mean Principle IV is enforced by convention " +
            "rather than by the pipeline");
    }

    [Fact]
    public async Task Route_WithATokenLackingTheRouterInvokeRole_Returns403()
    {
        var request = RouteRequestBuilder.Canonical();

        using var httpResponse = await factory.WrongRole.PostAsync(
            new Uri(Route, UriKind.Relative), request.AsContent());
        using var response = await RouteResponse.ReadAsync(httpResponse);

        response.Status.Should().Be(HttpStatusCode.Forbidden,
            "contracts/router-api.md: 403 when the caller lacks the Router.Invoke app role. " +
            "Holding some other role is not holding this one");
    }

    [Fact]
    public async Task Route_WhenRefused_StillEchoesTheCorrelationId()
    {
        var request = RouteRequestBuilder.Canonical();

        using var httpResponse = await factory.WrongRole.PostAsync(
            new Uri(Route, UriKind.Relative), request.AsContent());
        using var response = await RouteResponse.ReadAsync(httpResponse);

        response.CorrelationId.Should().NotBeNullOrWhiteSpace(
            "AC-8 reconstruction has to work for the requests that were refused, which are " +
            "precisely the ones an auditor asks about");
    }

    private async Task<RouteResponse> PostAsync(RouteRequestBuilder request)
    {
        using var httpResponse = await factory.Authorized.PostAsync(
            new Uri(Route, UriKind.Relative), request.AsContent());
        return await RouteResponse.ReadAsync(httpResponse);
    }
}
