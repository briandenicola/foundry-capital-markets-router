using Xunit;
using Fcmr.RouterService.Persistence;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Hosting;

namespace Fcmr.Persistence.Tests;

/// <summary>
/// Connects the suite to the local Cosmos emulator, or fails with an instruction.
///
/// <para>
/// It fails rather than skips. A skipped integration suite reports green, and a green board that
/// means "nothing ran" is worse than a red one — the whole reason this suite exists is that the
/// in-memory store was flattering the design, and a suite that quietly does not run would flatter
/// it in a new way.
/// </para>
/// <para>
/// The client is built by <see cref="CosmosClientFactory"/>, not by hand. Testing persistence
/// through a differently-configured client would leave the serializer settings — camelCase, enums
/// as names — unexercised, and those are precisely the settings that decide whether a document
/// written today is readable next year.
/// </para>
/// </summary>
public sealed class CosmosEmulatorFixture : IAsyncLifetime
{
    public const string EndpointVariable = "COSMOS_EMULATOR_ENDPOINT";
    private const string DefaultEndpoint = "https://localhost:8081/";

    public CosmosClient Client { get; private set; } = null!;

    public CosmosOptions Options { get; } = new()
    {
        Enabled = true,
        UseEmulator = true,
        AccountEndpoint = Environment.GetEnvironmentVariable(EndpointVariable) ?? DefaultEndpoint,
        Database = "fcmr",
        DecisionsContainer = "routerDecisions",
    };

    public CosmosRoutingDecisionStore Store { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        if (string.IsNullOrWhiteSpace(
            Environment.GetEnvironmentVariable(CosmosClientFactory.EmulatorKeyVariable)))
        {
            throw new InvalidOperationException(
                $"{CosmosClientFactory.EmulatorKeyVariable} is not set, so the persistence suite has " +
                "nothing to connect to.\n\n" +
                "  task cosmos:up\n" +
                "  export COSMOS_EMULATOR_KEY='<printed by the task above>'\n" +
                "  task cosmos:test\n\n" +
                "This suite is excluded from the default test run for exactly this reason. It is " +
                "not skipped when the emulator is absent, because a persistence suite that reports " +
                "green without connecting to anything is the failure mode it was written to prevent.");
        }

        // Development is asserted, not assumed: CosmosClientFactory refuses the key path anywhere
        // else, and this call is also the test that the refusal is wired the right way round.
        Client = CosmosClientFactory.Create(Options, new HostingEnvironment { EnvironmentName = Environments.Development });

        try
        {
            await Client.GetContainer(Options.Database, Options.DecisionsContainer)
                .ReadContainerAsync().ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is CosmosException or HttpRequestException)
        {
            throw new InvalidOperationException(
                $"The emulator answered but '{Options.Database}/{Options.DecisionsContainer}' is not " +
                "there. Run 'task cosmos:init' to create the containers, which mirror " +
                "infrastructure/cosmos.tf.", ex);
        }

        Store = new CosmosRoutingDecisionStore(Client, Options);
    }

    public Task DisposeAsync()
    {
        Client?.Dispose();
        return Task.CompletedTask;
    }
}

/// <summary>Minimal <see cref="IHostEnvironment"/>, so the fixture need not spin up a host.</summary>
internal sealed class HostingEnvironment : IHostEnvironment
{
    public string EnvironmentName { get; set; } = Environments.Development;
    public string ApplicationName { get; set; } = "Fcmr.Persistence.Tests";
    public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
    public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
        new Microsoft.Extensions.FileProviders.NullFileProvider();
}

// CA1711 objects to the 'Collection' suffix. It is xunit's own convention for a collection
// definition, and renaming it to satisfy the analyser would make the fixture harder to recognise
// for no benefit.
#pragma warning disable CA1711
[CollectionDefinition(nameof(CosmosEmulatorCollection))]
public sealed class CosmosEmulatorCollection : ICollectionFixture<CosmosEmulatorFixture>;
#pragma warning restore CA1711
