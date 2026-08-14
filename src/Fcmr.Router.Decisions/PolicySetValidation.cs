namespace Fcmr.Router.Decisions;

/// <summary>
/// Why a proposed policy change was rejected.
///
/// The transport status lives alongside the reason on purpose. contracts/policy-api.md draws a
/// deliberate line between 400 (the change is malformed) and 422 (the change is well-formed but
/// would create a policy set that refuses work it is declared to permit). Keeping the mapping
/// here means the distinction cannot quietly drift away from the published contract.
/// </summary>
public enum PolicyValidationFailure
{
    /// <summary>maxClassification names a vendor that is not in approvedVendors. 400.</summary>
    ClassificationNamesUnapprovedVendor,

    /// <summary>An approved vendor has no maxClassification entry, so it could never be selected. 400.</summary>
    ApprovedVendorHasNoClassification,

    /// <summary>
    /// The set is declared to permit Restricted data, but no approved vendor may process it. 422.
    ///
    /// Accepting this silently produces a policy set that refuses every restricted request, which
    /// surfaces as a demo failure rather than as a validation error.
    /// </summary>
    RestrictedDataUnservable,
}

public sealed record PolicyValidationError
{
    public required PolicyValidationFailure Failure { get; init; }
    public required string Message { get; init; }

    /// <summary>HTTP status the API layer must return for this failure.</summary>
    public int StatusCode => Failure switch
    {
        PolicyValidationFailure.RestrictedDataUnservable => 422,
        _ => 400,
    };
}

public sealed class PolicySetValidationException(PolicyValidationError error)
    : InvalidOperationException(error.Message)
{
    public PolicyValidationError Error { get; } = error;
}

/// <summary>Raised when a write presents a stale expectedVersion. Maps to 409.</summary>
public sealed class PolicySetConcurrencyException(string id, int expectedVersion, int actualVersion)
    : InvalidOperationException(
        $"Policy set '{id}' is at version {actualVersion}; the change expected version {expectedVersion}. " +
        "The change was rejected rather than merged.")
{
    public string PolicySetId { get; } = id;
    public int ExpectedVersion { get; } = expectedVersion;
    public int ActualVersion { get; } = actualVersion;
}

public sealed class PolicySetNotFoundException(string id)
    : InvalidOperationException($"Policy set '{id}' was not found.")
{
    public string PolicySetId { get; } = id;
}

public static class PolicySetValidator
{
    /// <summary>
    /// Validates a fully-resolved policy set. Throws on the first failure rather than collecting,
    /// because the API surfaces one status code and a compound status would be a lie.
    /// </summary>
    public static void Validate(PolicySet candidate)
    {
        ArgumentNullException.ThrowIfNull(candidate);

        foreach (var vendor in candidate.MaxClassification.Keys)
        {
            if (!candidate.ApprovedVendors.Contains(vendor))
            {
                throw new PolicySetValidationException(new PolicyValidationError
                {
                    Failure = PolicyValidationFailure.ClassificationNamesUnapprovedVendor,
                    Message =
                        $"maxClassification names vendor {vendor}, which is not in approvedVendors. " +
                        "A classification limit for an unapproved vendor has no effect and hides intent.",
                });
            }
        }

        foreach (var vendor in candidate.ApprovedVendors)
        {
            if (!candidate.MaxClassification.ContainsKey(vendor))
            {
                throw new PolicySetValidationException(new PolicyValidationError
                {
                    Failure = PolicyValidationFailure.ApprovedVendorHasNoClassification,
                    Message =
                        $"Vendor {vendor} is approved but has no maxClassification entry, so the gate would " +
                        "exclude it from every request. Approving a vendor that can never be selected is " +
                        "almost certainly not what the approver meant.",
                });
            }
        }

        if (candidate.PermitsRestrictedData && !CanServeRestricted(candidate))
        {
            throw new PolicySetValidationException(new PolicyValidationError
            {
                Failure = PolicyValidationFailure.RestrictedDataUnservable,
                Message =
                    $"Policy set '{candidate.Id}' is declared to permit Restricted data, but no approved " +
                    "vendor may process it. Every restricted request would be refused.",
            });
        }
    }

    public static bool CanServeRestricted(PolicySet candidate)
    {
        ArgumentNullException.ThrowIfNull(candidate);

        return candidate.ApprovedVendors.Any(v =>
            candidate.MaxClassification.TryGetValue(v, out var max) &&
            max >= DataClassification.Restricted);
    }
}
