namespace Fcmr.ServiceDefaults.Security;

/// <summary>
/// Detects whether the process is running somewhere real, regardless of what it has been told to
/// call its environment.
///
/// Every service in this repository can, in principle, be started with its authorisation switched
/// off — that is what makes it testable and runnable on a workstation with no tenant. The danger
/// is not the switch; it is the switch surviving into a deployment. <c>ASPNETCORE_ENVIRONMENT</c>
/// is caller-supplied configuration and can be set to Development on a container app by accident
/// or by a misapplied environment block, at which point every gate in the service opens quietly
/// and keeps returning 200s.
///
/// These variables are set by the platform, not by us. Their presence is evidence the host is not
/// a developer's machine, and a service that finds one while unauthenticated refuses to start.
/// Failing to boot is loud, immediate, and recoverable; running open is none of those.
///
/// Extracted from the two copies that were living in <c>RouterAuthorization</c> and
/// <c>ApprovalsAuthorization</c>. This is a security control, and a security control maintained in
/// parallel in five services is a security control that will eventually differ in one of them.
/// </summary>
public static class ManagedPlatform
{
    private static readonly string[] Markers =
    [
        "CONTAINER_APP_NAME",
        "CONTAINER_APP_REVISION",
        "CONTAINER_APP_ENV_DNS_SUFFIX",
        "WEBSITE_SITE_NAME",
        "KUBERNETES_SERVICE_HOST",
        "MSI_ENDPOINT",
        "IDENTITY_ENDPOINT",
    ];

    /// <summary>
    /// The first platform marker present, or null on a host that shows none.
    /// </summary>
    /// <param name="lookup">
    /// Environment lookup, injected so the guard is testable without mutating process state — a
    /// test that sets a real environment variable leaks into every test that runs after it.
    /// </param>
    public static string? DetectMarker(Func<string, string?> lookup)
    {
        ArgumentNullException.ThrowIfNull(lookup);
        return Array.Find(Markers, m => !string.IsNullOrEmpty(lookup(m)));
    }

    /// <summary>
    /// Throws when authorisation is disabled on a host that is demonstrably not a workstation.
    /// </summary>
    /// <param name="isEnforced">Whether the calling service currently enforces authorisation.</param>
    /// <param name="disabledControl">
    /// The control that is off, phrased to read before "is disabled" — for example
    /// "Router.Invoke enforcement". Named in the exception so the operator knows what refused.
    /// </param>
    /// <param name="consequence">
    /// What running open would actually mean for this service. Stated per-service because
    /// "authorisation is off" is not an argument; "the approval gate is standing open while still
    /// returning 200s that look like approvals" is.
    /// </param>
    /// <param name="settingPath">The configuration key an operator would set to fix it.</param>
    /// <param name="lookup">Environment lookup.</param>
    public static void GuardAgainstUnauthenticatedDeployment(
        bool isEnforced,
        string disabledControl,
        string consequence,
        string settingPath,
        Func<string, string?> lookup)
    {
        if (isEnforced)
        {
            return;
        }

        var marker = DetectMarker(lookup);
        if (marker is null)
        {
            return;
        }

        throw new InvalidOperationException(
            $"{disabledControl} is disabled, but '{marker}' shows this process is running on a " +
            "managed Azure platform rather than a developer workstation. " +
            $"{consequence} Remove the Development environment setting, or set {settingPath} to true.");
    }
}
