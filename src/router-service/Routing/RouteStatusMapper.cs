using Fcmr.Router.Decisions;

namespace Fcmr.RouterService.Routing;

/// <summary>A status code and a body, decided before either becomes an <c>IResult</c>.</summary>
public sealed record RouteHttpResult(int StatusCode, object Body);

/// <summary>
/// Translates a routing outcome into an HTTP status code.
///
/// This is the seam where the exchange's most important distinction either survives or is lost.
/// <see cref="RoutingOutcome.Denied"/> means "too expensive" and
/// <see cref="RoutingOutcome.RefusedByPolicy"/> means "not permitted"; they are different
/// conversations with different people. Collapsing them into one status would hand a governance
/// refusal to a caller as a payment problem, and a cost refusal to a compliance officer as a
/// policy event. So the mapping is a named, tested function rather than a switch buried in a
/// handler.
///
/// It reads a decision and the catalog that produced it. It never re-decides anything.
/// </summary>
public static class RouteStatusMapper
{
    public const string CostCeilingExceeded = "CostCeilingExceeded";
    public const string NoTierAvailable = "NoTierAvailable";

    public static int StatusFor(RoutingDecision decision, IReadOnlyList<TierPricing> catalog)
    {
        ArgumentNullException.ThrowIfNull(decision);
        ArgumentNullException.ThrowIfNull(catalog);

        return decision.Outcome switch
        {
            RoutingOutcome.Routed => StatusCodes.Status200OK,
            RoutingOutcome.Downgraded => StatusCodes.Status200OK,

            // A governed refusal is a successful, governed answer. Carrying it on an error status
            // would invite retry-on-error, and the one retry that must never succeed is the one
            // that finds a model governance has not approved.
            RoutingOutcome.RefusedByPolicy => StatusCodes.Status200OK,

            RoutingOutcome.Denied => NoPermittedModelAvailable(decision, catalog)
                ? StatusCodes.Status503ServiceUnavailable
                : StatusCodes.Status402PaymentRequired,

            _ => StatusCodes.Status500InternalServerError,
        };
    }

    public static string ErrorCodeFor(int statusCode) => statusCode switch
    {
        StatusCodes.Status402PaymentRequired => CostCeilingExceeded,
        StatusCodes.Status503ServiceUnavailable => NoTierAvailable,
        _ => "RouterError",
    };

    /// <summary>
    /// Distinguishes "nothing was affordable" from "nothing was up".
    ///
    /// The contract gives the second a 503 listing the tiers attempted. The decision record does
    /// not carry that distinction, and inferring it from the rationale prose would be a decision
    /// re-implemented in the transport. Instead this reads two facts the service already owns: the
    /// catalog it supplied, and which of those entries governance removed. If every candidate
    /// policy left standing is unavailable, no tier was up.
    /// </summary>
    private static bool NoPermittedModelAvailable(RoutingDecision decision, IReadOnlyList<TierPricing> catalog)
    {
        var excluded = decision.PolicyExclusions
            .Select(e => e.Deployment)
            .ToHashSet(StringComparer.Ordinal);

        var permitted = catalog.Where(c => !excluded.Contains(c.Deployment)).ToList();

        return permitted.Count > 0 && permitted.TrueForAll(c => !c.Available);
    }
}
