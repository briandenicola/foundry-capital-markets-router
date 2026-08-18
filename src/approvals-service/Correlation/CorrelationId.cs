using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;

namespace Fcmr.ApprovalsService.Correlation;

/// <summary>
/// Wire format rules for a caller-supplied correlation id.
///
/// The value is echoed in a response header and written into every audit record, so it is
/// validated rather than trusted. An unbounded or control-character id is a header-splitting and
/// log-forging vector, and a forged audit line is worse than a missing one.
///
/// NOTE (technical debt, deliberate): this duplicates the shape of
/// <c>Fcmr.RouterService.Correlation</c>, minus the body-adoption path the router needs because
/// its contract carries correlationId in the request body and this one does not. Two copies is
/// tolerable; five will not be. When the lane services land (T-023 to T-025) this belongs in a
/// shared assembly, and doing it then means the extraction is driven by three real callers rather
/// than by a guess.
/// </summary>
public static class CorrelationIdFormat
{
    public const string HeaderName = "X-Correlation-Id";

    public const int MaxLength = 128;

    public static bool IsAcceptable([NotNullWhen(true)] string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > MaxLength)
        {
            return false;
        }

        foreach (var c in value)
        {
            var ok = char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or ':';
            if (!ok)
            {
                return false;
            }
        }

        return true;
    }
}

/// <summary>The correlation id for the request currently in flight.</summary>
public interface ICorrelationIdAccessor
{
    string Value { get; }
}

public sealed class CorrelationIdAccessor : ICorrelationIdAccessor
{
    public string Value { get; private set; } = string.Empty;

    public void Establish(string value) => Value = value;

    public override string ToString() => Value;
}

/// <summary>
/// Establishes the correlation id for every request, echoes it, and puts it in the logging scope.
///
/// Principle VI requires any single interaction to be reconstructable end to end in one query.
/// That only holds if the id is attached before anything can log, on every path including
/// failures, and leaves on the response so the caller can quote it back. All three happen here
/// rather than in an endpoint, because an endpoint that is never reached still logs.
/// </summary>
public sealed class CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> logger)
{
    private static readonly Action<ILogger, string, Exception?> RequestStarted =
        LoggerMessage.Define<string>(
            LogLevel.Debug,
            new EventId(1, nameof(RequestStarted)),
            "Approvals request accepted with correlation id {CorrelationId}");

    public async Task InvokeAsync(HttpContext context, ICorrelationIdAccessor accessor)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(accessor);

        var writable = (CorrelationIdAccessor)accessor;
        var supplied = context.Request.Headers[CorrelationIdFormat.HeaderName].ToString();

        writable.Establish(
            CorrelationIdFormat.IsAcceptable(supplied) ? supplied : Guid.NewGuid().ToString());

        context.Response.OnStarting(static state =>
        {
            var (ctx, acc) = ((HttpContext, ICorrelationIdAccessor))state;
            ctx.Response.Headers[CorrelationIdFormat.HeaderName] = acc.Value;
            return Task.CompletedTask;
        }, (context, accessor));

        Activity.Current?.SetTag("correlationId", accessor.Value);

        using (logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = accessor }))
        {
            RequestStarted(logger, accessor.Value, null);
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
