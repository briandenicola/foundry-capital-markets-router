using System.Diagnostics;
using Fcmr.Router.Decisions;
using Fcmr.RouterService.Configuration;
using Fcmr.RouterService.Contracts;
using Fcmr.ServiceDefaults.Correlation;
using Fcmr.RouterService.Persistence;
using Microsoft.Extensions.Options;

namespace Fcmr.RouterService.Routing;

/// <summary>
/// POST /v1/route.
///
/// This is translation, not decision. It validates the wire shape, resolves the governing policy
/// set and the deployment catalog, hands all of it to <see cref="RoutingPlanner.Plan"/>, records
/// what came back, and maps the outcome to a status code.
///
/// It calls <see cref="RoutingPlanner"/> and nothing beneath it. <see cref="PolicyGate"/> runs
/// before <see cref="TierSelector"/> inside the planner, and that ordering is the guarantee that
/// cost optimisation can never reach a model governance excluded. A handler that called
/// TierSelector directly would look identical in the happy path and would have silently removed
/// the gate.
/// </summary>
public sealed class RouteRequestHandler(
    IModelCatalog catalog,
    IPolicySetRepository policySets,
    IRoutingDecisionStore decisions,
    IOptionsMonitor<RouterOptions> options,
    ICorrelationIdAccessor correlation,
    TimeProvider time,
    ILogger<RouteRequestHandler> logger)
{
    private static readonly Action<ILogger, string, string, string, Exception?> DecisionRecorded =
        LoggerMessage.Define<string, string, string>(
            LogLevel.Information,
            new EventId(10, nameof(DecisionRecorded)),
            "Routing decision {Outcome} for lane {Lane}: {Rationale}");

    private static readonly Action<ILogger, string, Exception?> GovernanceUnavailable =
        LoggerMessage.Define<string>(
            LogLevel.Error,
            new EventId(11, nameof(GovernanceUnavailable)),
            "Policy set {PolicySetId} could not be resolved; the request was refused rather than routed ungoverned.");

    public async Task<RouteHttpResult> HandleAsync(RouteRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var started = time.GetTimestamp();

        if (!correlation.TryAdoptFromBody(request.CorrelationId))
        {
            return Problem(
                StatusCodes.Status400BadRequest,
                "CorrelationIdConflict",
                "The correlationId in the request body does not match the one supplied in the " +
                $"{CorrelationIdFormat.HeaderName} header. Send one or the other, or send them equal.");
        }

        var errors = RouteRequestValidator.Validate(request);
        if (errors.Count > 0)
        {
            return Problem(
                StatusCodes.Status400BadRequest,
                "InvalidRequest",
                "The request could not be routed as submitted.",
                details: errors);
        }

        var models = catalog.Current();
        if (models.Count == 0)
        {
            return Problem(
                StatusCodes.Status503ServiceUnavailable,
                RouteStatusMapper.NoTierAvailable,
                "No model deployments are configured. The router does not fall back to an unrouted direct call.");
        }

        var policyOptions = options.CurrentValue.Policy;
        var policy = await policySets
            .GetAsync(policyOptions.BusinessUnit, policyOptions.SetId, ct)
            .ConfigureAwait(false);

        if (policy is null)
        {
            // Routing without a policy set would mean routing ungoverned, which is worse than not
            // routing at all. Principle IV puts governance first and unconditionally.
            GovernanceUnavailable(logger, policyOptions.SetId, null);
            return Problem(
                StatusCodes.Status503ServiceUnavailable,
                "GovernanceUnavailable",
                $"Policy set '{policyOptions.SetId}' for business unit '{policyOptions.BusinessUnit}' " +
                "could not be resolved. The request was refused rather than routed ungoverned.");
        }

        var hints = new ComplexityHints
        {
            InputTokenEstimate = request.ComplexityHints!.InputTokenEstimate,
            RequiresMultiStep = request.ComplexityHints.RequiresMultiStep,
            RequiresRetrieval = request.ComplexityHints.RequiresRetrieval,
            RequiresToolCalls = request.ComplexityHints.RequiresToolCalls,
        };

        var decision = RoutingPlanner.Plan(
            new RoutingRequest
            {
                Hints = hints,
                CostCeilingUsd = request.CostCeilingUsd!.Value,
                DataClassification = request.DataClassification!.Value,
                ExecutionRegion = request.ExecutionRegion,
            },
            models,
            policy);

        var latencyMs = (int)time.GetElapsedTime(started).TotalMilliseconds;

        await decisions.SaveAsync(
            new RoutingDecisionRecord
            {
                Id = Guid.NewGuid().ToString(),
                CorrelationId = correlation.Value,
                Lane = request.Lane!.Value,
                TaskKind = request.TaskKind!,
                Decision = decision,
                ComplexityInputs = hints,
                CreatedAt = time.GetUtcNow(),
                LatencyMs = latencyMs,
            },
            ct).ConfigureAwait(false);

        DecisionRecorded(logger, decision.Outcome.ToString(), request.Lane.Value.ToString(), decision.Rationale, null);
        Activity.Current?.SetTag("router.outcome", decision.Outcome.ToString());

        var status = RouteStatusMapper.StatusFor(decision, models);

        if (status is StatusCodes.Status200OK)
        {
            return new RouteHttpResult(status, new RouteResponse
            {
                CorrelationId = correlation.Value,
                Decision = decision,
                Result = null,
                Metrics = new RouteMetricsDto { LatencyMs = latencyMs },
                Inference = InferenceFor(decision),
            });
        }

        return new RouteHttpResult(status, new RouteErrorResponse
        {
            CorrelationId = correlation.Value,
            Error = RouteStatusMapper.ErrorCodeFor(status),
            Message = decision.Rationale,
            Decision = decision,
        });
    }

    /// <summary>
    /// States plainly whether a model ran. See ADR-008.
    ///
    /// T-015 wires the decision, not the call. Rather than let the absence of a result be inferred
    /// from a null, the response says so in words the UI can render, because a screen that shows a
    /// decision without saying no model ran is a screen that implies one did.
    /// </summary>
    private static InferenceStatusDto InferenceFor(RoutingDecision decision) =>
        decision.Outcome is RoutingOutcome.RefusedByPolicy
            ? new InferenceStatusDto
            {
                State = InferenceState.NotReached,
                Detail = "Governance policy left no eligible deployment, so no model call was attempted.",
            }
            : new InferenceStatusDto
            {
                State = InferenceState.NotInvoked,
                Detail = "The routing decision is live and recorded. Model invocation through the AI " +
                         "gateway is not yet wired, and no result has been produced for this request.",
            };

    private RouteHttpResult Problem(int status, string error, string message, IReadOnlyList<string>? details = null) =>
        new(status, new RouteErrorResponse
        {
            CorrelationId = correlation.Value,
            Error = error,
            Message = message,
            Details = details,
        });
}
