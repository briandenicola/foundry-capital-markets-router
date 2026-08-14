using Azure.Identity;
using Azure.Monitor.OpenTelemetry.AspNetCore;
using OpenTelemetry.Trace;

namespace Fcmr.RouterService.Telemetry;

/// <summary>
/// Application Insights wiring, by configuration and managed identity.
///
/// Two properties are load-bearing:
///
/// The connection string is read from configuration and is never committed. It is injected at
/// deploy time and carries no credential of its own — ingestion authenticates with the container
/// app's managed identity via <see cref="DefaultAzureCredential"/>, which is what keeps this
/// inside Principle VIII rather than smuggling a key in under another name.
///
/// When no connection string is present, telemetry is simply not exported. The service still
/// builds, still starts, and still runs its tests with no Azure resource in reach. A host that
/// cannot start without a cloud dependency is a host nobody can test.
/// </summary>
public static class TelemetryRegistration
{
    public const string ConnectionStringKey = "ApplicationInsights:ConnectionString";

    public static IServiceCollection AddRouterTelemetry(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var connectionString = configuration[ConnectionStringKey]
                               ?? configuration["APPLICATIONINSIGHTS_CONNECTION_STRING"];

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return services;
        }

        services
            .AddOpenTelemetry()
            .UseAzureMonitor(o =>
            {
                o.ConnectionString = connectionString;
                o.Credential = new DefaultAzureCredential();

                // ADR-004 puts the scoreboard on Application Insights with a five-second freshness
                // budget, and disables sampling for router telemetry. A sampled decision is a
                // decision missing from the audit trail, and Principle VI does not have a sampling
                // clause.
                o.SamplingRatio = 1.0f;
            })
            .WithTracing(t => t.AddSource(RouterActivitySource.Name));

        return services;
    }
}

public static class RouterActivitySource
{
    public const string Name = "Fcmr.RouterService";
}
