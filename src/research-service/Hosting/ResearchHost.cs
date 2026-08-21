using Fcmr.ServiceDefaults.Security;

namespace Fcmr.ResearchService.Hosting;

/// <summary>The research lane's own trace source.</summary>
public static class ResearchActivitySource
{
    public const string Name = "Fcmr.ResearchService";
}

public static class ResearchAuthorization
{
    public static FcmrAuthorization Create() => new(
        enabledConfigurationKey: "Research:Authorization:Enabled",
        disabledControl: "Research app-role enforcement",
        consequence:
            "Research output is attributable to the analyst who requested it (Principle VI). " +
            "Unauthenticated, the audit record names nobody, and the coverage figure on a brief " +
            "cannot be traced to who accepted it.");
}
