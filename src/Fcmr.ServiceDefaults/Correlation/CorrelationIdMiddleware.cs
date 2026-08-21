using System.Diagnostics;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Fcmr.ServiceDefaults.Correlation;

/// <summary>
/// Establishes the correlation id for every request, echoes it, and puts it in the logging scope.
///
/// Principle VI requires any single interaction to be reconstructable end to end in one query. That
/// only holds if the id is attached before anything can log, is attached on every path including
/// failures, and leaves on the response so the caller can quote it back. All three happen here
/// rather than in the endpoint, because an endpoint that is never reached still logs.
/// </summary>
public sealed class CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> logger)
{
    private static readonly Action<ILogger, string, string, Exception?> RequestStarted =
        LoggerMessage.Define<string, string>(
            LogLevel.Debug,
            new EventId(1, nameof(RequestStarted)),
            "Request accepted with correlation id from {CorrelationIdSource}: {CorrelationId}");

    public async Task InvokeAsync(HttpContext context, ICorrelationIdAccessor accessor)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(accessor);

        var writable = (CorrelationIdAccessor)accessor;

        var supplied = context.Request.Headers[CorrelationIdFormat.HeaderName].ToString();

        if (CorrelationIdFormat.IsAcceptable(supplied))
        {
            writable.Establish(supplied, CorrelationIdSource.Header);
        }
        else
        {
            writable.Establish(Guid.NewGuid().ToString(), CorrelationIdSource.Generated);
        }

        // Written on OnStarting rather than now, so an id adopted from the request body after this
        // point still reaches the caller. The header is the only copy a caller gets on a 4xx.
        context.Response.OnStarting(static state =>
        {
            var (ctx, acc) = ((HttpContext, ICorrelationIdAccessor))state;
            ctx.Response.Headers[CorrelationIdFormat.HeaderName] = acc.Value;
            return Task.CompletedTask;
        }, (context, accessor));

        // Carried on the Activity as well as the log scope: Application Insights correlates on the
        // operation, and the demo's audit query joins telemetry to Cosmos records on this tag.
        Activity.Current?.SetTag("correlationId", accessor.Value);

        using (logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = accessor }))
        {
            RequestStarted(logger, accessor.Source.ToString(), accessor.Value, null);
            await next(context).ConfigureAwait(false);
        }
    }
}

public static class CorrelationIdExtensions
{
    public static IServiceCollection AddCorrelationId(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<CorrelationIdAccessor>();
        services.AddScoped<ICorrelationIdAccessor>(sp => sp.GetRequiredService<CorrelationIdAccessor>());
        return services;
    }

    public static IApplicationBuilder UseCorrelationId(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        return app.UseMiddleware<CorrelationIdMiddleware>();
    }
}
