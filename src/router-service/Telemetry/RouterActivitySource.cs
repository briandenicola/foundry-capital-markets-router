namespace Fcmr.RouterService.Telemetry;

/// <summary>
/// The router's own trace source.
///
/// Kept here rather than in <c>Fcmr.ServiceDefaults</c> because each service names its own spans;
/// the shared registration takes the name as an argument so a service cannot silently export
/// under another service's identity.
/// </summary>
public static class RouterActivitySource
{
    public const string Name = "Fcmr.RouterService";
}
