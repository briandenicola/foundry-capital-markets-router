using Fcmr.ServiceDefaults.Security;

namespace Fcmr.OrderRoutingService.Hosting;

/// <summary>The order routing lane's own trace source.</summary>
public static class OrderRoutingActivitySource
{
    public const string Name = "Fcmr.OrderRoutingService";
}

/// <summary>
/// Authorisation for this lane.
///
/// The consequence sentence is specific because "authorisation is disabled" is not something an
/// operator can act on, and this service is the only one in the estate that can cause a fill.
/// </summary>
public static class OrderRoutingAuthorization
{
    public static FcmrAuthorization Create() => new(
        enabledConfigurationKey: "OrderRouting:Authorization:Enabled",
        disabledControl: "Order routing app-role enforcement",
        consequence:
            "This service is the only path to an execution, and no consequential action may run " +
            "without a recorded human approval (Principle I). Unauthenticated, it cannot establish " +
            "who approved, so segregation of duties compares nothing.");
}
