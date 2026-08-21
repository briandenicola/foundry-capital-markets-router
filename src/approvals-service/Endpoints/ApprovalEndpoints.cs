using Fcmr.Approvals.Domain;
using Fcmr.ApprovalsService.Contracts;
using Fcmr.ServiceDefaults.Correlation;
using Fcmr.ApprovalsService.Persistence;
using Fcmr.ApprovalsService.Security;

namespace Fcmr.ApprovalsService.Endpoints;

/// <summary>
/// Serves <c>specs/001-router-core/contracts/approval-api.md</c>.
///
/// The handler translates HTTP to the domain and back, and holds no rules of its own. Segregation
/// of duties, terminal-state finality, expiry, and the reason requirement are all enforced inside
/// <see cref="Approval"/> and its state machine, which is covered at 99%. A rule implemented here
/// as well would be a second, untested copy that can drift from the one under test.
/// </summary>
public static class ApprovalEndpoints
{
    public static void MapApprovalEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.MapPost("/v1/approvals", CreateAsync)
            .AddEndpointFilter(new RequireAppRoleFilter(ApprovalRoles.Proposer))
            .WithName("CreateApproval");

        app.MapGet("/v1/approvals", ListAsync)
            .AddEndpointFilter(new RequireAppRoleFilter(ApprovalRoles.Approver))
            .WithName("ListApprovals");

        app.MapGet("/v1/approvals/{id}", GetAsync)
            .AddEndpointFilter(new RequireAppRoleFilter(ApprovalRoles.Approver))
            .WithName("GetApproval");

        app.MapPost("/v1/approvals/{id}/decision", DecideAsync)
            .AddEndpointFilter(new RequireAppRoleFilter(ApprovalRoles.Approver))
            .WithName("DecideApproval");
    }

    private static async Task<IResult> CreateAsync(
        CreateApprovalRequest request,
        HttpContext http,
        IApprovalStore store,
        ICorrelationIdAccessor correlation,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Error(correlation, StatusCodes.Status400BadRequest, "EvidenceRequired",
                "No request body was supplied.");
        }

        if (RejectedIdentityMembers.Find(request.Extra) is { } offending)
        {
            return Error(correlation, StatusCodes.Status400BadRequest, "IdentityNotAccepted",
                $"The request supplied '{offending}'. The proposing identity is read from the validated " +
                "token and is never accepted from a request, so that segregation of duties compares two " +
                "values the caller cannot choose. See ADR-011.");
        }

        var proposedBy = ApprovalsAuthorization.ObjectId(http?.User);

        if (string.IsNullOrWhiteSpace(proposedBy))
        {
            return Error(correlation, StatusCodes.Status403Forbidden, "Forbidden",
                "The token carries no object id, so the proposing identity cannot be established. " +
                "Segregation of duties compares the approver against the proposer, and that comparison " +
                "is meaningless without one.");
        }

        if (request.EvidencePacket is null)
        {
            return Error(correlation, StatusCodes.Status400BadRequest, "EvidenceRequired",
                "No evidence packet was supplied. Evidence that does not exist is reported as missing, " +
                "never manufactured to make a record well-formed. See ADR-007.");
        }

        if (request.ExpiresAt is not { } expiresAt)
        {
            return Error(correlation, StatusCodes.Status400BadRequest, "ExpiryRequired",
                "No expiresAt was supplied. A proposal that never expires is a standing authorisation.");
        }

        var result = Approval.Propose(
            id: Guid.NewGuid().ToString(),
            lane: request.Lane,
            evidencePacket: request.EvidencePacket,
            proposedByObjectId: proposedBy,
            expiresAt: expiresAt,
            clock: clock);

        if (!result.IsAccepted)
        {
            var refusal = result.Refusal!;
            return Error(correlation, StatusFor(refusal.Kind), refusal.Kind.ToString(), refusal.Reason);
        }

        var approval = result.Approval!;

        await store.CreateAsync(approval, cancellationToken).ConfigureAwait(false);

        // Invariant 3: the audit record is written before the call returns. The domain hands it
        // back with the result precisely so this cannot be forgotten.
        if (result.AuditEvent is { } audit)
        {
            await store.AppendAuditAsync(audit, cancellationToken).ConfigureAwait(false);
        }

        return Results.Json(
            ApprovalResponse.From(approval, includePacket: true),
            statusCode: StatusCodes.Status201Created);
    }

    private static async Task<IResult> ListAsync(
        string? state,
        IApprovalStore store,
        CancellationToken cancellationToken)
    {
        ApprovalState? filter = Enum.TryParse<ApprovalState>(state, ignoreCase: true, out var parsed)
            ? parsed
            : null;

        var approvals = await store.ListAsync(filter, cancellationToken).ConfigureAwait(false);

        return Results.Ok(approvals.Select(a => ApprovalResponse.From(a, includePacket: false)).ToList());
    }

    private static async Task<IResult> GetAsync(
        string id,
        IApprovalStore store,
        ICorrelationIdAccessor correlation,
        CancellationToken cancellationToken)
    {
        var approval = await store.GetAsync(id, cancellationToken).ConfigureAwait(false);

        return approval is null
            ? Error(correlation, StatusCodes.Status404NotFound, "NotFound", $"No proposal with id '{id}'.")
            : Results.Ok(ApprovalResponse.From(approval, includePacket: true));
    }

    private static async Task<IResult> DecideAsync(
        string id,
        DecisionRequest request,
        HttpContext http,
        IApprovalStore store,
        ICorrelationIdAccessor correlation,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var approval = await store.GetAsync(id, cancellationToken).ConfigureAwait(false);

        if (approval is null)
        {
            return Error(correlation, StatusCodes.Status404NotFound, "NotFound", $"No proposal with id '{id}'.");
        }

        if (RejectedIdentityMembers.Find(request?.Extra) is { } offending)
        {
            return Error(correlation, StatusCodes.Status400BadRequest, "IdentityNotAccepted",
                $"The request supplied '{offending}'. The deciding identity is read from the validated " +
                "token and is never accepted from a request. See ADR-011.");
        }

        var decidedBy = ApprovalsAuthorization.ObjectId(http?.User);

        if (string.IsNullOrWhiteSpace(decidedBy))
        {
            return Error(correlation, StatusCodes.Status403Forbidden, "Forbidden",
                "The token carries no object id, so the deciding identity cannot be established.");
        }

        // Expiry is checked before the decision is applied, and the transition is recorded rather
        // than inferred. Invariant 2 says expiry never implies approval; leaving the proposal
        // Pending after a 410 would mean the fact that it expired exists only in the reader's head.
        if (approval.HasPassedExpiry(clock) && approval.State == ApprovalState.PendingApproval)
        {
            var expiry = approval.Expire(clock);

            if (expiry.IsAccepted)
            {
                await store.UpdateAsync(expiry.Approval!, cancellationToken).ConfigureAwait(false);
            }

            await store.AppendAuditAsync(expiry.AuditEvent, cancellationToken).ConfigureAwait(false);

            return Error(correlation, StatusCodes.Status410Gone, "Expired",
                "The proposal passed expiresAt. It will never execute, and expiry is not approval.");
        }

        var decision = request?.Decision;

        var result = string.Equals(decision, "Rejected", StringComparison.OrdinalIgnoreCase)
            ? approval.Reject(decidedBy, request?.Reason ?? string.Empty, clock)
            : string.Equals(decision, "Approved", StringComparison.OrdinalIgnoreCase)
                ? approval.Approve(decidedBy, clock, request?.Reason)
                : null;

        if (result is null)
        {
            return Error(correlation, StatusCodes.Status400BadRequest, "InvalidDecision",
                $"Decision must be 'Approved' or 'Rejected'. Received '{decision}'.");
        }

        // Written for refusals as well as decisions. "Someone tried to approve their own proposal
        // and was stopped" is exactly the record a compliance reviewer comes looking for.
        await store.AppendAuditAsync(result.AuditEvent, cancellationToken).ConfigureAwait(false);

        if (!result.IsAccepted)
        {
            var refusal = result.Refusal!;
            return Error(correlation, StatusFor(refusal.Kind), refusal.Kind.ToString(), refusal.Reason);
        }

        await store.UpdateAsync(result.Approval!, cancellationToken).ConfigureAwait(false);

        return Results.Ok(ApprovalResponse.From(result.Approval!, includePacket: false));
    }

    /// <summary>
    /// Maps a domain refusal to the status the contract publishes.
    ///
    /// Expired is 410 and everything terminal is 409 because "you are too late" and "someone
    /// already decided" are materially different answers to a compliance question, and collapsing
    /// them loses the one fact that matters most: nobody approved this.
    /// </summary>
    private static int StatusFor(ApprovalRefusalKind kind) => kind switch
    {
        ApprovalRefusalKind.SegregationOfDuties => StatusCodes.Status409Conflict,
        ApprovalRefusalKind.InvalidTransition => StatusCodes.Status409Conflict,
        ApprovalRefusalKind.NotYetExpired => StatusCodes.Status409Conflict,
        ApprovalRefusalKind.Expired => StatusCodes.Status410Gone,
        _ => StatusCodes.Status400BadRequest,
    };

    private static IResult Error(ICorrelationIdAccessor correlation, int status, string error, string detail) =>
        Results.Json(
            new ApprovalErrorResponse
            {
                Error = error,
                Detail = detail,
                CorrelationId = correlation?.Value ?? string.Empty,
            },
            statusCode: status);
}

/// <summary>Enforces one app role on one endpoint.</summary>
public sealed class RequireAppRoleFilter(string requiredRole) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var configuration = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        var environment = context.HttpContext.RequestServices.GetRequiredService<IHostEnvironment>();

        if (!ApprovalsAuthorization.IsEnforced(configuration, environment))
        {
            return await next(context).ConfigureAwait(false);
        }

        if (ApprovalsAuthorization.HasRole(context.HttpContext.User, requiredRole))
        {
            return await next(context).ConfigureAwait(false);
        }

        var correlation = context.HttpContext.RequestServices.GetRequiredService<ICorrelationIdAccessor>();

        return Results.Json(
            new ApprovalErrorResponse
            {
                Error = "Forbidden",
                Detail = $"The caller does not carry the {requiredRole} app role.",
                CorrelationId = correlation.Value,
            },
            statusCode: StatusCodes.Status403Forbidden);
    }
}
