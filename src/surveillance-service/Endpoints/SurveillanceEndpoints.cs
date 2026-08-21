using Fcmr.ServiceDefaults.Agents;
using Fcmr.ServiceDefaults.Correlation;
using Fcmr.ServiceDefaults.Security;
using Fcmr.Surveillance.Domain;
using Fcmr.SurveillanceService.Contracts;

namespace Fcmr.SurveillanceService.Endpoints;

/// <summary>App roles for this lane.</summary>
public static class SurveillanceRoles
{
    /// <summary>May run triage and draft escalations. Drafting changes nothing.</summary>
    public const string Analyst = "Surveillance.Triage";

    /// <summary>May apply an approved escalation and change an alert's state.</summary>
    public const string Reviewer = "Surveillance.Review";
}

/// <summary>
/// HTTP surface for the surveillance lane.
///
/// The split between what works and what refuses is the point of this file.
///
/// <b>Implemented:</b> ranking, gap reporting, evidence assembly, memo drafting, and the approval
/// gate. All of it deterministic, all of it served normally, none of it needing a model.
///
/// <b>Refused:</b> the one endpoint that would have to score alerts itself. Scoring is inference,
/// the hosted agent (T-027e) is not built, and ADR-007 forbids standing anything in for it. So
/// <c>POST /v1/triage/runs</c> answers 501 and names what it would need, rather than returning a
/// queue ordered by something that never reasoned about anything.
///
/// The ranking endpoint takes assessments as input precisely because that is the seam the agent
/// will call once it exists: the agent scores, this service ranks. Nothing about the deterministic
/// half has to change when the agent lands.
/// </summary>
public static class SurveillanceEndpoints
{
    public static void MapSurveillanceEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.MapPost("/v1/triage/rankings", Rank)
            .AddEndpointFilter(new RequireAppRoleFilter(SurveillanceRoles.Analyst))
            .WithName("RankTriageBatch");

        app.MapPost("/v1/triage/runs", RunTriage)
            .AddEndpointFilter(new RequireAppRoleFilter(SurveillanceRoles.Analyst))
            .WithName("RunTriage");

        app.MapPost("/v1/escalations/drafts", DraftEscalation)
            .AddEndpointFilter(new RequireAppRoleFilter(SurveillanceRoles.Analyst))
            .WithName("DraftEscalation");

        app.MapPost("/v1/escalations", ApplyEscalation)
            .AddEndpointFilter(new RequireAppRoleFilter(SurveillanceRoles.Reviewer))
            .WithName("ApplyEscalation");
    }

    /// <summary>
    /// Ranks a batch from scores produced elsewhere.
    ///
    /// Fully implemented, and reproducible: the same alerts and assessments produce the same queue
    /// regardless of the order they arrive in, which is what AC-6 requires and what the agent's
    /// bounded-parallelism scoring would otherwise destroy.
    /// </summary>
    private static IResult Rank(
        RankBatchRequest request,
        ICorrelationIdAccessor correlation)
    {
        if (request is null)
        {
            return Error(correlation, StatusCodes.Status400BadRequest,
                "InvalidRequest", "No request body was supplied.");
        }

        if (!correlation.TryAdoptFromBody(request.CorrelationId))
        {
            return Error(correlation, StatusCodes.Status400BadRequest, "CorrelationIdConflict",
                "The correlationId in the request body does not match the one supplied in the " +
                $"{CorrelationIdFormat.HeaderName} header. Send one or the other, or send them equal.");
        }

        if (request.Alerts is null || request.Alerts.Count == 0)
        {
            return Error(correlation, StatusCodes.Status400BadRequest,
                "InvalidRequest", "At least one alert is required.");
        }

        List<AlertUnderTriage> alerts;
        List<AlertAssessment> assessments;

        try
        {
            alerts = [.. request.Alerts.Select(a => a.ToDomain())];
            assessments = [.. (request.Assessments ?? []).Select(a => a.ToDomain())];
        }
        catch (ArgumentOutOfRangeException ex)
        {
            // A risk score outside 0–100 is a caller defect, not a server fault. Clamping it would
            // silently reposition an alert in a queue somebody is about to act on.
            return Error(correlation, StatusCodes.Status400BadRequest, "InvalidRiskScore", ex.Message);
        }

        var batch = TriageRanker.Rank(alerts, assessments);

        return Results.Ok(new
        {
            submittedCount = batch.SubmittedCount,
            isComplete = batch.IsComplete,
            ranked = batch.Ranked.Select(r => new
            {
                r.Rank,
                alertId = r.Alert.AlertId,
                r.Alert.Symbol,
                r.Alert.TraderId,
                r.Alert.AlertType,
                riskScore = r.Assessment.RiskScore,
                rationale = r.Assessment.Rationale,
                evidence = r.Assessment.Evidence.Select(e => new
                {
                    kind = e.Kind.ToString(),
                    e.ArtefactId,
                    e.Excerpt,
                }),
                r.IsComplete,
            }),

            // Reported alongside the queue, never omitted. A partially-scored batch presented as a
            // finished queue is the failure mode that matters: the alerts a model silently failed
            // on are not randomly distributed.
            gaps = batch.Gaps.Select(g => new
            {
                g.AlertId,
                deficiency = g.Deficiency.ToString(),
                g.Explanation,
            }),
            correlationId = correlation.Value,
        });
    }

    /// <summary>
    /// Would score a batch and rank it. Cannot, and says so.
    /// </summary>
    private static IResult RunTriage(ICorrelationIdAccessor correlation) =>
        AgentRuntime.NotImplemented(
            capability: "Scoring an alert batch",
            correlationId: correlation?.Value ?? string.Empty,
            deterministicAlternative:
                "POST /v1/triage/rankings, which ranks reproducibly from scores you supply");

    private static IResult DraftEscalation(
        DraftEscalationRequest request,
        HttpContext http,
        ICorrelationIdAccessor correlation,
        TimeProvider clock)
    {
        if (request is null)
        {
            return Error(correlation, StatusCodes.Status400BadRequest,
                "InvalidRequest", "No request body was supplied.");
        }

        // The proposing identity comes from the validated token and from nowhere else, so that
        // segregation of duties compares two values the caller cannot choose. See ADR-011.
        var proposedBy = FcmrAuthorization.ObjectId(http?.User) ?? "anonymous-development-caller";

        RankedAlert ranked;
        try
        {
            ranked = new RankedAlert
            {
                Rank = request.QueueRank,
                Alert = request.Alert.ToDomain(),
                Assessment = request.Assessment.ToDomain(),
            };
        }
        catch (ArgumentOutOfRangeException ex)
        {
            return Error(correlation, StatusCodes.Status400BadRequest, "InvalidRiskScore", ex.Message);
        }

        var outcome = EscalationGate.Draft(
            ranked, EscalationPolicy.Default, correlation.Value, proposedBy, clock.GetUtcNow());

        if (!outcome.Drafted)
        {
            // 422: understood and refused on policy grounds, not malformed. Refusing to draft
            // without evidence is a control — a memo carrying a rank and nothing to read asks an
            // approver to endorse a number.
            return Results.Json(
                new
                {
                    drafted = false,
                    refusal = outcome.Refusal?.ToString(),
                    detail = outcome.RefusalExplanation,
                    correlationId = correlation.Value,
                },
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }

        var memo = outcome.Memo!;

        return Results.Json(
            new
            {
                drafted = true,
                memo = new
                {
                    memo.AlertId,
                    memo.CorrelationId,
                    memo.QueueRank,
                    memo.RiskScore,
                    memo.Symbol,
                    memo.TraderId,
                    memo.AlertType,
                    memo.Rationale,
                    evidence = memo.Evidence.Select(e => new
                    {
                        kind = e.Kind.ToString(),
                        e.ArtefactId,
                        e.Excerpt,
                    }),
                    memo.ProposedBy,
                    memo.DraftedAt,
                    memo.Summary,

                    // On the row, always. Drafting changed nothing and the screen must say so.
                    memo.Status,
                },
                correlationId = correlation.Value,
            },
            statusCode: StatusCodes.Status201Created);
    }

    private static IResult ApplyEscalation(
        ApplyEscalationRequest request,
        HttpContext http,
        ICorrelationIdAccessor correlation,
        TimeProvider clock)
    {
        if (request is null)
        {
            return Error(correlation, StatusCodes.Status400BadRequest,
                "InvalidRequest", "No request body was supplied.");
        }

        var approvedBy = FcmrAuthorization.ObjectId(http?.User) ?? request.Approval?.ApprovedBy;

        if (request.Approval is null || string.IsNullOrWhiteSpace(approvedBy))
        {
            return Error(correlation, StatusCodes.Status403Forbidden, "ApprovalRequired",
                "No approval was presented. An alert's state does not change without one.");
        }

        var memo = request.Memo.ToDomain();

        var authorization = new EscalationAuthorization
        {
            AlertId = request.Approval.AlertId,
            CorrelationId = request.Approval.CorrelationId,
            ApprovedBy = approvedBy,
            ApprovedAt = request.Approval.ApprovedAt,
            ExpiresAt = request.Approval.ExpiresAt,
            AuthorisedState = request.Approval.AuthorisedState,
        };

        var outcome = EscalationGate.Apply(memo, authorization, clock.GetUtcNow());

        if (!outcome.Applied)
        {
            return Results.Json(
                new
                {
                    applied = false,
                    refusal = outcome.Refusal?.ToString(),
                    detail = outcome.RefusalExplanation,
                    correlationId = correlation.Value,
                },
                statusCode: StatusCodes.Status403Forbidden);
        }

        var change = outcome.Change!;

        return Results.Json(
            new
            {
                applied = true,
                change = new
                {
                    change.AlertId,
                    change.CorrelationId,
                    previousState = change.PreviousState.ToString(),
                    newState = change.NewState.ToString(),
                    change.ApprovedBy,
                    change.ProposedBy,
                    change.ChangedAt,
                },
                correlationId = correlation.Value,
            },
            statusCode: StatusCodes.Status201Created);
    }

    private static IResult Error(
        ICorrelationIdAccessor correlation,
        int status,
        string error,
        string detail) =>
        Results.Json(
            new
            {
                error,
                detail,
                correlationId = correlation?.Value ?? string.Empty,
            },
            statusCode: status);
}
