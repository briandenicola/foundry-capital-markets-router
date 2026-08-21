using Fcmr.OrderRouting.Domain;
using Fcmr.OrderRoutingService.Contracts;
using Fcmr.OrderRoutingService.Persistence;
using Fcmr.ServiceDefaults.Correlation;
using Fcmr.ServiceDefaults.Security;

namespace Fcmr.OrderRoutingService.Endpoints;

/// <summary>App roles for this lane.</summary>
public static class OrderRoutingRoles
{
    /// <summary>May ask for a route proposal. Proposing changes nothing.</summary>
    public const string Proposer = "OrderRouting.Propose";

    /// <summary>May present an approval and cause a simulated fill.</summary>
    public const string Executor = "OrderRouting.Execute";
}

/// <summary>
/// HTTP surface for the order routing lane.
///
/// The handlers translate and store; they hold no routing or policy rules of their own. Venue
/// ranking, every policy boundary, and the whole approval refusal ladder live in
/// <c>Fcmr.OrderRouting.Domain</c>, which is covered at 100% and testable with no host. A rule
/// re-implemented here would be a second, untested copy free to drift from the one under test.
///
/// This lane needs no model to work. Per T-027f, policy evaluation is deterministic code the agent
/// explains rather than a judgement the agent makes — so every endpoint below is fully
/// implemented, and none of them returns the ADR-007 not-implemented refusal.
/// </summary>
public static class OrderRoutingEndpoints
{
    public static void MapOrderRoutingEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.MapPost("/v1/route-proposals", ProposeAsync)
            .AddEndpointFilter(new RequireAppRoleFilter(OrderRoutingRoles.Proposer))
            .WithName("CreateRouteProposal");

        app.MapGet("/v1/route-proposals/{proposalId}", Get)
            .AddEndpointFilter(new RequireAppRoleFilter(OrderRoutingRoles.Proposer))
            .WithName("GetRouteProposal");

        app.MapPost("/v1/executions", ExecuteAsync)
            .AddEndpointFilter(new RequireAppRoleFilter(OrderRoutingRoles.Executor))
            .WithName("ExecuteRoute");
    }

    private static Task<IResult> ProposeAsync(
        RouteProposalRequest request,
        HttpContext http,
        IProposalStore store,
        ICorrelationIdAccessor correlation,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Task.FromResult(Error(correlation, StatusCodes.Status400BadRequest,
                "InvalidRequest", "No request body was supplied."));
        }

        if (!correlation.TryAdoptFromBody(request.CorrelationId))
        {
            return Task.FromResult(Error(correlation, StatusCodes.Status400BadRequest,
                "CorrelationIdConflict",
                "The correlationId in the request body does not match the one supplied in the " +
                $"{CorrelationIdFormat.HeaderName} header. Send one or the other, or send them equal."));
        }

        var errors = Validate(request);
        if (errors.Count > 0)
        {
            return Task.FromResult(Error(correlation, StatusCodes.Status400BadRequest,
                "InvalidRequest", "The order could not be routed as submitted.", errors));
        }

        // The proposing identity comes from the validated token and from nowhere else. Segregation
        // of duties compares the approver against this value, so a caller who could supply it
        // could approve their own order by presenting two different names. See ADR-011.
        var proposedBy = FcmrAuthorization.ObjectId(http?.User) ?? "anonymous-development-caller";

        var order = new OrderIntent
        {
            OrderId = request.OrderId,
            CorrelationId = correlation.Value,
            Symbol = request.Symbol,
            Side = request.Side,
            Quantity = request.Quantity,
            LimitPrice = request.LimitPrice ?? 0m,
            ArrivalMidPrice = request.ArrivalMidPrice,
        };

        var quotes = request.Quotes.Select(q => new VenueQuote
        {
            VenueCode = q.VenueCode,
            Type = q.Type,
            MidPrice = q.MidPrice,
            Spread = q.Spread,
            DisplayedLiquidity = q.DisplayedLiquidity,
            FeeBps = q.FeeBps,
        });

        var outcome = RoutePlanner.Plan(order, quotes, BestExecutionPolicy.Default, proposedBy);

        if (outcome.Status == RoutingStatus.Halted)
        {
            // 422, not 400. The request was well-formed and was understood; it was refused by
            // policy. A 400 would tell the caller to fix their JSON, which is not the problem, and
            // would make a governance refusal indistinguishable from a typo in the audit trail.
            return Task.FromResult(Results.Json(
                new
                {
                    status = "Halted",
                    haltSummary = outcome.HaltSummary,
                    breaches = outcome.Breaches.Select(b => new
                    {
                        boundary = b.Boundary.ToString(),
                        venueCode = b.VenueCode,
                        permitted = b.Permitted,
                        observed = b.Observed,
                        explanation = b.Explanation,
                    }),
                    considered = Considered(outcome),
                    correlationId = correlation.Value,
                },
                statusCode: StatusCodes.Status422UnprocessableEntity));
        }

        store.Save(outcome.Proposal!);

        return Task.FromResult(Results.Json(
            new
            {
                status = "Proposed",
                proposal = Describe(outcome.Proposal!),
                considered = Considered(outcome),
                correlationId = correlation.Value,
            },
            statusCode: StatusCodes.Status201Created));
    }

    private static IResult Get(
        string proposalId,
        IProposalStore store,
        ICorrelationIdAccessor correlation)
    {
        var proposal = store.Find(proposalId);

        return proposal is null
            ? Error(correlation, StatusCodes.Status404NotFound, "ProposalNotFound",
                $"No proposal {proposalId} is held by this service.")
            : Results.Ok(new { proposal = Describe(proposal), correlationId = correlation.Value });
    }

    private static IResult ExecuteAsync(
        ExecuteRouteRequest request,
        HttpContext http,
        IProposalStore store,
        ICorrelationIdAccessor correlation,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Error(correlation, StatusCodes.Status400BadRequest,
                "InvalidRequest", "No request body was supplied.");
        }

        var proposal = store.Find(request.ProposalId);
        if (proposal is null)
        {
            return Error(correlation, StatusCodes.Status404NotFound, "ProposalNotFound",
                $"No proposal {request.ProposalId} is held by this service. Executions are checked " +
                "against the stored proposal, never against one supplied at execution time.");
        }

        var approvedBy = FcmrAuthorization.ObjectId(http?.User);
        if (approvedBy is null && request.Approval is not null)
        {
            // Only reachable on a workstation with enforcement off; ManagedPlatform refuses to
            // start a service in this state anywhere real.
            approvedBy = request.Approval.ApprovedBy;
        }

        var authorization = request.Approval is null || string.IsNullOrWhiteSpace(approvedBy)
            ? null
            : new ExecutionAuthorization
            {
                ApprovalId = request.Approval.ApprovalId,
                ProposalId = request.ProposalId,
                CorrelationId = request.CorrelationId,
                ApprovedBy = approvedBy,
                ApprovedAt = request.Approval.ApprovedAt,
                ExpiresAt = request.Approval.ExpiresAt,
            };

        var result = SimulatedOms.Execute(proposal, authorization, clock.GetUtcNow());

        if (!result.Executed)
        {
            // 403: the request was understood and refused on authority grounds. Every refusal
            // reason here is a Principle I control, so none of them may answer 200 with an empty
            // body — a caller must not be able to mistake a refusal for a quiet success.
            return Results.Json(
                new
                {
                    executed = false,
                    refusal = result.RefusalReason?.ToString(),
                    detail = result.Explanation,
                    correlationId = correlation.Value,
                },
                statusCode: StatusCodes.Status403Forbidden);
        }

        // Replay protection after the domain approves, not before: a caller presenting an invalid
        // approval must not be able to burn a valid proposal by having it marked executed.
        if (!store.TryMarkExecuted(request.ProposalId))
        {
            return Results.Json(
                new
                {
                    executed = false,
                    refusal = "AlreadyExecuted",
                    detail =
                        $"Proposal {request.ProposalId} has already been executed. An approval is " +
                        "single-use; replaying one would double an order without a second human " +
                        "seeing it.",
                    correlationId = correlation.Value,
                },
                statusCode: StatusCodes.Status409Conflict);
        }

        var execution = result.Execution!;

        return Results.Json(
            new
            {
                executed = true,
                execution = new
                {
                    execution.ExecutionId,
                    execution.ProposalId,
                    execution.OrderId,
                    execution.CorrelationId,
                    execution.VenueCode,
                    execution.Quantity,
                    execution.Price,
                    execution.ExecutedAt,
                    execution.ApprovalId,

                    // T-034. On the row, always, so it survives projection into a view model.
                    execution.ExecutionMode,
                },
                correlationId = correlation.Value,
            },
            statusCode: StatusCodes.Status201Created);
    }

    private static object Describe(RouteProposal proposal) => new
    {
        proposal.ProposalId,
        proposal.OrderId,
        proposal.CorrelationId,
        proposal.VenueCode,
        proposal.Quantity,
        proposal.ProposedBy,
        cost = new
        {
            proposal.Cost.SpreadCostBps,
            proposal.Cost.ImpactBps,
            proposal.Cost.FeeBps,
            proposal.Cost.TotalCostBps,
            proposal.Cost.ProjectedPrice,
            proposal.Cost.ProjectedCostUsd,
            proposal.Cost.ParticipationRate,
        },
        proposal.LiquidityRationale,
        proposal.BestExecutionJustification,
    };

    private static object[] Considered(RoutingOutcome outcome) =>
        [.. outcome.Considered.Select(v => new
        {
            venueCode = v.Quote.VenueCode,
            venueType = v.Quote.Type.ToString(),
            totalCostBps = v.Cost.TotalCostBps,
            projectedCostUsd = v.Cost.ProjectedCostUsd,
            eligible = v.IsEligible,
            breaches = v.Breaches.Select(b => b.Boundary.ToString()),
        })];

    private static List<string> Validate(RouteProposalRequest request)
    {
        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(request.OrderId))
        {
            errors.Add("orderId is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Symbol))
        {
            errors.Add("symbol is required.");
        }

        if (request.Quantity <= 0)
        {
            errors.Add("quantity must be greater than zero.");
        }

        if (request.ArrivalMidPrice <= 0)
        {
            errors.Add("arrivalMidPrice must be greater than zero.");
        }

        if (request.Quotes is null || request.Quotes.Count == 0)
        {
            errors.Add("at least one venue quote is required; the router does not invent liquidity.");
        }

        return errors;
    }

    private static IResult Error(
        ICorrelationIdAccessor correlation,
        int status,
        string error,
        string detail,
        IReadOnlyList<string>? details = null) =>
        Results.Json(
            new OrderRoutingError
            {
                Error = error,
                Detail = detail,
                CorrelationId = correlation?.Value ?? string.Empty,
                Details = details,
            },
            statusCode: status);
}
