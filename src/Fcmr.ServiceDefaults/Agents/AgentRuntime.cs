using Microsoft.AspNetCore.Http;

namespace Fcmr.ServiceDefaults.Agents;

/// <summary>
/// The response every endpoint returns when it would need live model inference to answer.
///
/// ADR-007 forbids any fallback, mock, replay, or fixture standing in for live reasoning. The
/// hosted agents (T-027) are not built, so the endpoints that depend on them cannot answer — and
/// the one thing they must not do is answer anyway.
///
/// This is deliberately a hard, explicit 501 rather than an empty result, a plausible-looking
/// stub, or a zero-confidence placeholder. Each of those is a path by which a screen shows
/// something that looks like the output of reasoning that did not occur, which is the exact
/// failure ADR-007 exists to prevent. If the agent cannot run, the demo says the agent cannot run.
///
/// Note what is <em>not</em> gated by this: the deterministic governance logic in each lane is
/// fully implemented and served normally. Attribution, ranking, best-execution evaluation, and
/// every approval gate work today without a model. Only the inference step is missing, and only
/// the endpoints that genuinely need it refuse.
/// </summary>
public static class AgentRuntime
{
    public const string ErrorCode = "AgentRuntimeNotImplemented";

    /// <param name="capability">What the caller asked for, in the lane's own words.</param>
    /// <param name="correlationId">Echoed so a refusal is as traceable as a success.</param>
    /// <param name="deterministicAlternative">
    /// The endpoint that does work today, where one covers part of the need. Offered because the
    /// useful half of every lane is implemented, and a bare 501 hides that.
    /// </param>
    public static IResult NotImplemented(
        string capability,
        string correlationId,
        string? deterministicAlternative = null)
    {
        var detail =
            $"{capability} requires live model inference, and the hosted agent runtime (T-027) is " +
            "not built. This endpoint returns 501 rather than a stub, replay, or placeholder " +
            "result: ADR-007 forbids any fallback that changes whether reasoning actually " +
            "occurred. No output is better than output nobody reasoned to.";

        if (!string.IsNullOrWhiteSpace(deterministicAlternative))
        {
            detail +=
                " The deterministic part of this lane is implemented and served by " +
                $"{deterministicAlternative}.";
        }

        return Results.Json(
            new
            {
                error = ErrorCode,
                detail,
                correlationId,
                adr = "docs/adr/007-no-simulated-agent-reasoning.md",
            },
            statusCode: StatusCodes.Status501NotImplemented);
    }
}
