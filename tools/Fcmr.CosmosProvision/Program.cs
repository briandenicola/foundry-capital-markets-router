using Microsoft.Azure.Cosmos;

namespace Fcmr.CosmosProvision;

/// <summary>
/// Creates the fcmr database and containers in the local Cosmos emulator.
///
/// <para>
/// Terraform owns this in every real environment; the emulator is unreachable from Terraform, so
/// something has to do it locally. The risk that follows is drift — a container added to
/// <c>infrastructure/cosmos.tf</c> and not here, or partitioned differently — which would make
/// local tests pass against a shape that does not exist in Azure. <c>scripts/policy-cosmos-containers-match.sh</c>
/// fails the build when the two disagree, so the duplication is checked rather than trusted.
/// </para>
/// <para>
/// Deliberately not a general-purpose migration tool. It creates what is missing and touches
/// nothing that exists.
/// </para>
/// </summary>
internal static class Program
{
    /// <summary>
    /// Mirrors <c>local.cosmos_containers</c> in <c>infrastructure/cosmos.tf</c>, name and
    /// partition key path. Kept in the same order for a readable diff when they diverge.
    /// </summary>
    private static readonly (string Name, string PartitionKeyPath)[] Containers =
    [
        ("routerDecisions", "/correlationId"),
        ("approvals", "/correlationId"),
        ("surveillanceAlerts", "/batchId"),
        ("researchQueries", "/correlationId"),
        ("orderProposals", "/correlationId"),
        ("auditEvents", "/correlationId"),
    ];

    private static async Task<int> Main(string[] args)
    {
        var endpoint = Arg(args, 0) ?? Environment.GetEnvironmentVariable("COSMOS_EMULATOR_ENDPOINT")
            ?? "https://localhost:8081/";
        var database = Arg(args, 1) ?? "fcmr";
        var key = Environment.GetEnvironmentVariable("COSMOS_EMULATOR_KEY");

        if (string.IsNullOrWhiteSpace(key))
        {
            await Console.Error.WriteLineAsync(
                "COSMOS_EMULATOR_KEY is not set. 'task cosmos:up' generates the key and prints the " +
                "export line; it is never committed to this repository.");
            return 1;
        }

        var options = new CosmosClientOptions
        {
            ConnectionMode = ConnectionMode.Gateway,

            // The emulator serves a self-signed certificate. This tool only ever talks to the
            // emulator -- it has no managed-identity path at all -- so there is no configuration in
            // which this leniency could be pointed at a real account.
            ServerCertificateCustomValidationCallback = (_, _, _) => true,
        };

        using var client = new CosmosClient(endpoint, key, options);

        Console.WriteLine($"Provisioning '{database}' at {endpoint}");

        var db = await client.CreateDatabaseIfNotExistsAsync(database);

        foreach (var (name, partitionKeyPath) in Containers)
        {
            var response = await db.Database.CreateContainerIfNotExistsAsync(
                new ContainerProperties(name, partitionKeyPath)
                {
                    PartitionKeyDefinitionVersion = PartitionKeyDefinitionVersion.V2,
                });

            var verb = response.StatusCode == System.Net.HttpStatusCode.Created ? "created" : "present";
            Console.WriteLine($"  {name} ({partitionKeyPath}) {verb}");
        }

        Console.WriteLine("Done.");
        return 0;
    }

    private static string? Arg(string[] args, int index) =>
        args.Length > index && !string.IsNullOrWhiteSpace(args[index]) ? args[index] : null;
}
