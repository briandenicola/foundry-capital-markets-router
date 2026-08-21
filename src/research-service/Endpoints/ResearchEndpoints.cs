using Fcmr.Research.Domain;
using Fcmr.ResearchService.Contracts;
using Fcmr.ServiceDefaults.Agents;
using Fcmr.ServiceDefaults.Correlation;
using Fcmr.ServiceDefaults.Security;

namespace Fcmr.ResearchService.Endpoints;

/// <summary>App roles for this lane.</summary>
public static class ResearchRoles
{
    public const string Analyst = "Research.Read";
}

/// <summary>
/// HTTP surface for the research lane.
///
/// <b>Implemented:</b> the attribution gate, the injection scanner, and coverage reporting. These
/// are the controls the compliance audience is here to see, and none of them needs a model.
///
/// <b>Refused:</b> synthesis. Turning retrieved evidence into claims is inference. The hosted
/// agent (T-023) is not built, and ADR-007 forbids a stand-in — a canned brief shown to this
/// audience would demonstrate the opposite of what the demo claims. <c>POST /v1/research/briefs</c>
/// answers 501 and names the deterministic endpoint that does work.
///
/// The gate takes claims as input for the same reason surveillance takes scores: that is exactly
/// the seam the agent will fill. When synthesis lands, this endpoint does not change.
/// </summary>
public static class ResearchEndpoints
{
    public static void MapResearchEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.MapPost("/v1/research/attribution", Attribute)
            .AddEndpointFilter(new RequireAppRoleFilter(ResearchRoles.Analyst))
            .WithName("ApplyAttributionGate");

        app.MapPost("/v1/research/briefs", Synthesise)
            .AddEndpointFilter(new RequireAppRoleFilter(ResearchRoles.Analyst))
            .WithName("SynthesiseBrief");
    }

    /// <summary>
    /// Applies the attribution gate to a set of claims against the evidence retrieved for them.
    ///
    /// Withheld claims are returned in full, with a reason. They are never dropped: a brief that
    /// silently omits what could not be supported looks identical to one that had nothing to omit,
    /// and the difference is the whole control (AC-3, Principle III).
    /// </summary>
    private static IResult Attribute(
        AttributionRequest request,
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

        if (request.Claims is null || request.Retrieval is null)
        {
            return Error(correlation, StatusCodes.Status400BadRequest,
                "InvalidRequest", "Both claims and retrieval are required.");
        }

        RetrievalResult retrieval;
        try
        {
            retrieval = new RetrievalResult(request.Retrieval.Select(c => c.ToDomain()));
        }
        catch (ArgumentException ex)
        {
            // Duplicate chunk ids, most likely. Deduplicating silently would let one chunk stand in
            // for another and change which claims pass.
            return Error(correlation, StatusCodes.Status400BadRequest, "InvalidRetrieval", ex.Message);
        }

        var policy = request.MinimumCoveragePercent is { } bar
            ? ResearchPolicy.Default with { MinimumCoveragePercent = bar }
            : ResearchPolicy.Default;

        var synthesis = AttributionGate.Apply(
            request.Claims.Select(c => c.ToDomain()), retrieval, policy);

        return Results.Ok(new
        {
            coverage = new
            {
                synthesis.Coverage.TotalClaims,
                synthesis.Coverage.AttributedClaims,
                synthesis.Coverage.WithheldClaims,
                percent = synthesis.Coverage.Percent,
                meetsBar = synthesis.Coverage.MeetsBar(policy),
                barPercent = policy.MinimumCoveragePercent,
            },
            published = synthesis.Claims.Select(c => new
            {
                c.Claim.ClaimId,
                c.Claim.Text,
                citations = c.Claim.Citations.Select(x => new { x.ChunkId, x.Quote }),
                supporting = c.SupportingChunks.Select(s => new
                {
                    s.ChunkId,
                    s.SourceId,
                    s.SourceTitle,
                }),
            }),

            // Reported, never dropped.
            withheld = synthesis.UnattributableClaims.Select(u => new
            {
                u.Claim.ClaimId,
                u.Claim.Text,
                reason = u.Reason.ToString(),
                u.Explanation,
                u.UnresolvedChunkIds,
            }),
            injectionDetections = synthesis.InjectionDetections.Select(d => new
            {
                d.ChunkId,
                d.SourceId,
                category = d.Category.ToString(),
                d.Match,
                d.Offset,
            }),
            synthesis.QuarantinedChunkIds,
            correlationId = correlation.Value,
        });
    }

    /// <summary>Would synthesise a brief. Cannot, and says so.</summary>
    private static IResult Synthesise(ICorrelationIdAccessor correlation) =>
        AgentRuntime.NotImplemented(
            capability: "Synthesising a research brief from retrieved evidence",
            correlationId: correlation?.Value ?? string.Empty,
            deterministicAlternative:
                "POST /v1/research/attribution, which gates claims you supply against retrieval");

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
