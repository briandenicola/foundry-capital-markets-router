using System.Text.Json;
using System.Text.Json.Serialization;
using Azure.Identity;
using Microsoft.Azure.Cosmos;

namespace Fcmr.RouterService.Persistence;

/// <summary>Binds the <c>Cosmos</c> configuration section.</summary>
public sealed class CosmosOptions
{
    public const string SectionName = "Cosmos";

    /// <summary>Account endpoint, for example <c>https://fcmr-abc123-cosmos.documents.azure.com:443/</c>.</summary>
    public string AccountEndpoint { get; set; } = string.Empty;

    public string Database { get; set; } = "fcmr";

    public string DecisionsContainer { get; set; } = "routerDecisions";

    /// <summary>
    /// Whether the router persists to Cosmos at all.
    ///
    /// Off leaves <see cref="InMemoryRoutingDecisionStore"/> registered, which is right for a unit
    /// test host and wrong for anything a person will look at afterwards. Deliberately defaults to
    /// off: a service that silently tries to reach a Cosmos account that was never configured
    /// fails in a way that reads like a network problem.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Points the client at the local Cosmos emulator.
    ///
    /// The emulator does not accept Entra tokens — it authenticates with a single well-known key
    /// and nothing else — so this is the one path where a key is used. It is confined to the
    /// Development environment by <see cref="CosmosClientFactory.Create"/>, which throws rather
    /// than degrading if anything else sets it. The key itself is never in source, config, or an
    /// image: it is read from <c>COSMOS_EMULATOR_KEY</c> at run time and supplied by
    /// <c>task cosmos:up</c>.
    /// </summary>
    public bool UseEmulator { get; set; }
}

/// <summary>
/// Builds the <see cref="CosmosClient"/>, and refuses to build one that would authenticate with a
/// key outside local development.
///
/// <para>
/// Principle: managed identity only. The real account already enforces this from the other side —
/// <c>infrastructure/cosmos.tf</c> sets <c>local_authentication_enabled = false</c>, so a key
/// presented to it is rejected regardless of what the client believes. This guard exists anyway,
/// because a control that lives in exactly one place is one Terraform edit away from being gone,
/// and because a startup failure names the problem far more clearly than a 401 from the data plane.
/// </para>
/// <para>
/// The emulator escape hatch is genuinely necessary — the Linux emulator supports no other
/// authentication — and is therefore made as narrow as it can be: Development only, key from the
/// environment only, and never a value that can be committed.
/// </para>
/// </summary>
public static class CosmosClientFactory
{
    /// <summary>Environment variable carrying the emulator key. Never read outside Development.</summary>
    public const string EmulatorKeyVariable = "COSMOS_EMULATOR_KEY";

    public static CosmosClient Create(CosmosOptions options, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(environment);

        if (string.IsNullOrWhiteSpace(options.AccountEndpoint))
        {
            throw new InvalidOperationException(
                "Cosmos:Enabled is true but Cosmos:AccountEndpoint is empty. The service will not " +
                "start without somewhere to record what it decided.");
        }

        var clientOptions = new CosmosClientOptions { ConnectionMode = ConnectionMode.Direct };

        // The same System.Text.Json configuration the HTTP layer uses, not the SDK's Newtonsoft
        // default. camelCase matches the shape data-model.md publishes, and enums are written as
        // names: a stored decision holding "2" where it should hold "Denied" is one enum reorder
        // away from being wrong, and unlike an HTTP response it is wrong permanently.
        clientOptions.UseSystemTextJsonSerializerWithOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            Converters = { new JsonStringEnumConverter() },
        };

        if (!options.UseEmulator)
        {
            return new CosmosClient(options.AccountEndpoint, Credential(), clientOptions);
        }

        if (!environment.IsDevelopment())
        {
            throw new InvalidOperationException(
                $"Cosmos:UseEmulator is set in the '{environment.EnvironmentName}' environment. The " +
                "emulator path authenticates with a key, and key authentication is permitted only " +
                "on a developer's machine. Managed identity is not a preference here; it is the " +
                "control that makes 'no shared secrets' true.");
        }

        var key = Environment.GetEnvironmentVariable(EmulatorKeyVariable);

        if (string.IsNullOrWhiteSpace(key))
        {
            throw new InvalidOperationException(
                $"Cosmos:UseEmulator is set but {EmulatorKeyVariable} is not in the environment. The " +
                "emulator key is deliberately not committed anywhere in this repository; run " +
                "'task cosmos:up', which starts the emulator and exports it.");
        }

        // The emulator serves a self-signed certificate. Validation is bypassed for it and only for
        // it -- this branch is already unreachable outside Development, so there is no configuration
        // that turns certificate checking off against a real account.
        clientOptions.ConnectionMode = ConnectionMode.Gateway;
        clientOptions.ServerCertificateCustomValidationCallback = (_, _, _) => true;

        return new CosmosClient(options.AccountEndpoint, key, clientOptions);
    }

    private static DefaultAzureCredential Credential() =>
        new DefaultAzureCredential(new DefaultAzureCredentialOptions
        {
            // Container Apps injects the user-assigned identity's client id. Left unset locally,
            // where the developer's az login is used instead.
            ManagedIdentityClientId = Environment.GetEnvironmentVariable("AZURE_CLIENT_ID"),
        });
}
