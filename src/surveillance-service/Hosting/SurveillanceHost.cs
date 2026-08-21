using Fcmr.ServiceDefaults.Security;

namespace Fcmr.SurveillanceService.Hosting;

/// <summary>The surveillance lane's own trace source.</summary>
public static class SurveillanceActivitySource
{
    public const string Name = "Fcmr.SurveillanceService";
}

public static class SurveillanceAuthorization
{
    public static FcmrAuthorization Create() => new(
        enabledConfigurationKey: "Surveillance:Authorization:Enabled",
        disabledControl: "Surveillance app-role enforcement",
        consequence:
            "Escalating or dismissing an alert is a consequential action requiring a recorded " +
            "human approval (Principle I). Unauthenticated, this service cannot establish who " +
            "proposed or who approved, so segregation of duties compares nothing.");
}
