namespace Fcmr.Router.Decisions;

/// <summary>One field an approver changed, rendered for the diff and the audit event.</summary>
public sealed record PolicySetFieldChange
{
    public required string Field { get; init; }
    public required string From { get; init; }
    public required string To { get; init; }
}

/// <summary>
/// A partial update. Null means "not supplied", which is distinct from "set to empty" —
/// conflating the two would let an omitted field silently clear a governance control.
/// </summary>
public sealed record PolicySetUpdate
{
    public required string Id { get; init; }
    public required string BusinessUnit { get; init; }

    /// <summary>Required. A mismatch is a 409 and is never merged.</summary>
    public required int ExpectedVersion { get; init; }

    /// <summary>Entra object id of the approver. Recorded on the set and on the audit event.</summary>
    public required string UpdatedBy { get; init; }

    public IReadOnlySet<ModelVendor>? ApprovedVendors { get; init; }
    public IReadOnlyDictionary<ModelVendor, DataClassification>? MaxClassification { get; init; }
    public IReadOnlySet<string>? AllowedRegions { get; init; }
    public decimal? MaxCostPerRequestUsd { get; init; }
    public bool? PermitsRestrictedData { get; init; }
}

/// <summary>The result of an accepted change: the new state plus what actually changed.</summary>
public sealed record PolicySetChangeResult
{
    public required PolicySet PolicySet { get; init; }
    public required IReadOnlyList<PolicySetFieldChange> Changed { get; init; }
    public required DateTimeOffset EffectiveFrom { get; init; }
}

public interface IPolicySetRepository
{
    Task<IReadOnlyList<PolicySet>> ListAsync(string businessUnit, CancellationToken ct = default);

    Task<PolicySet?> GetAsync(string businessUnit, string id, CancellationToken ct = default);

    Task<PolicySetChangeResult> UpdateAsync(PolicySetUpdate update, CancellationToken ct = default);

    /// <summary>Most recent first. Backs the claim that the control's own changes are auditable.</summary>
    Task<IReadOnlyList<PolicySetChangeResult>> HistoryAsync(
        string businessUnit, string id, int take = 20, CancellationToken ct = default);
}

/// <summary>
/// In-memory policy set store with the same optimistic-concurrency semantics as the Cosmos
/// implementation that will replace it.
///
/// This exists so the policy engine, its validation rules, and its concurrency behaviour can be
/// built and proven before any Azure resource exists. The Cosmos version substitutes
/// <c>version</c> for an ETag precondition; the observable contract — stale writes are rejected,
/// never merged — is identical, which is what makes this a fair stand-in rather than a mock that
/// flatters the design.
/// </summary>
public sealed class InMemoryPolicySetRepository : IPolicySetRepository
{
    private readonly Lock _gate = new();
    private readonly Dictionary<string, PolicySet> _sets = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<PolicySetChangeResult>> _history = new(StringComparer.Ordinal);
    private readonly TimeProvider _time;

    public InMemoryPolicySetRepository(IEnumerable<PolicySet>? seed = null, TimeProvider? timeProvider = null)
    {
        _time = timeProvider ?? TimeProvider.System;

        foreach (var set in seed ?? [])
        {
            // Seeded sets are validated on the way in. A baseline that could not have been
            // written through the API is a baseline that will surprise someone later.
            PolicySetValidator.Validate(set);
            _sets[Key(set.BusinessUnit, set.Id)] = set;
        }
    }

    public Task<IReadOnlyList<PolicySet>> ListAsync(string businessUnit, CancellationToken ct = default)
    {
        lock (_gate)
        {
            IReadOnlyList<PolicySet> result = _sets.Values
                .Where(s => string.Equals(s.BusinessUnit, businessUnit, StringComparison.Ordinal))
                .OrderBy(s => s.Id, StringComparer.Ordinal)
                .ToList();

            return Task.FromResult(result);
        }
    }

    public Task<PolicySet?> GetAsync(string businessUnit, string id, CancellationToken ct = default)
    {
        lock (_gate)
        {
            _sets.TryGetValue(Key(businessUnit, id), out var set);
            return Task.FromResult(set);
        }
    }

    public Task<PolicySetChangeResult> UpdateAsync(PolicySetUpdate update, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(update);

        lock (_gate)
        {
            var key = Key(update.BusinessUnit, update.Id);

            if (!_sets.TryGetValue(key, out var current))
            {
                throw new PolicySetNotFoundException(update.Id);
            }

            // Concurrency before validation: a stale write is rejected on the grounds that the
            // approver was not looking at the current state, regardless of what they proposed.
            if (current.Version != update.ExpectedVersion)
            {
                throw new PolicySetConcurrencyException(update.Id, update.ExpectedVersion, current.Version);
            }

            var now = _time.GetUtcNow();

            var proposed = current with
            {
                ApprovedVendors = update.ApprovedVendors ?? current.ApprovedVendors,
                MaxClassification = update.MaxClassification ?? current.MaxClassification,
                AllowedRegions = update.AllowedRegions ?? current.AllowedRegions,
                MaxCostPerRequestUsd = update.MaxCostPerRequestUsd ?? current.MaxCostPerRequestUsd,
                PermitsRestrictedData = update.PermitsRestrictedData ?? current.PermitsRestrictedData,
                Version = current.Version + 1,
                UpdatedBy = update.UpdatedBy,
                UpdatedAt = now,
            };

            PolicySetValidator.Validate(proposed);

            var changed = Diff(current, proposed);

            // A change that changes nothing still burns a version. The alternative is that two
            // approvers can hold the same expectedVersion and both believe they wrote last.
            var result = new PolicySetChangeResult
            {
                PolicySet = proposed,
                Changed = changed,
                EffectiveFrom = now,
            };

            _sets[key] = proposed;

            if (!_history.TryGetValue(key, out var log))
            {
                log = [];
                _history[key] = log;
            }

            log.Add(result);

            return Task.FromResult(result);
        }
    }

    public Task<IReadOnlyList<PolicySetChangeResult>> HistoryAsync(
        string businessUnit, string id, int take = 20, CancellationToken ct = default)
    {
        lock (_gate)
        {
            IReadOnlyList<PolicySetChangeResult> result =
                _history.TryGetValue(Key(businessUnit, id), out var log)
                    ? log.AsEnumerable().Reverse().Take(take).ToList()
                    : [];

            return Task.FromResult(result);
        }
    }

    /// <summary>
    /// Before-and-after for every field that moved. Returned to the UI so the policy screen can
    /// show exactly what the approver did without a second fetch, and written verbatim onto the
    /// PolicySetChanged audit event.
    /// </summary>
    public static IReadOnlyList<PolicySetFieldChange> Diff(PolicySet before, PolicySet after)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(after);

        var changes = new List<PolicySetFieldChange>();

        var beforeVendors = RenderVendors(before.ApprovedVendors);
        var afterVendors = RenderVendors(after.ApprovedVendors);
        if (!string.Equals(beforeVendors, afterVendors, StringComparison.Ordinal))
        {
            changes.Add(new PolicySetFieldChange
            {
                Field = "approvedVendors",
                From = beforeVendors,
                To = afterVendors,
            });
        }

        var beforeClass = RenderClassifications(before.MaxClassification);
        var afterClass = RenderClassifications(after.MaxClassification);
        if (!string.Equals(beforeClass, afterClass, StringComparison.Ordinal))
        {
            changes.Add(new PolicySetFieldChange
            {
                Field = "maxClassification",
                From = beforeClass,
                To = afterClass,
            });
        }

        var beforeRegions = RenderRegions(before.AllowedRegions);
        var afterRegions = RenderRegions(after.AllowedRegions);
        if (!string.Equals(beforeRegions, afterRegions, StringComparison.Ordinal))
        {
            changes.Add(new PolicySetFieldChange
            {
                Field = "allowedRegions",
                From = beforeRegions,
                To = afterRegions,
            });
        }

        if (before.MaxCostPerRequestUsd != after.MaxCostPerRequestUsd)
        {
            changes.Add(new PolicySetFieldChange
            {
                Field = "maxCostPerRequestUsd",
                From = before.MaxCostPerRequestUsd.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture),
                To = after.MaxCostPerRequestUsd.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture),
            });
        }

        if (before.PermitsRestrictedData != after.PermitsRestrictedData)
        {
            changes.Add(new PolicySetFieldChange
            {
                Field = "permitsRestrictedData",
                From = before.PermitsRestrictedData.ToString(),
                To = after.PermitsRestrictedData.ToString(),
            });
        }

        return changes;
    }

    private static string RenderVendors(IReadOnlySet<ModelVendor> vendors) =>
        string.Join(", ", vendors.Select(v => v.ToString()).OrderBy(v => v, StringComparer.Ordinal));

    private static string RenderRegions(IReadOnlySet<string> regions) =>
        string.Join(", ", regions.OrderBy(r => r, StringComparer.Ordinal));

    private static string RenderClassifications(IReadOnlyDictionary<ModelVendor, DataClassification> map) =>
        string.Join(", ", map
            .OrderBy(kv => kv.Key.ToString(), StringComparer.Ordinal)
            .Select(kv => $"{kv.Key}={kv.Value}"));

    private static string Key(string businessUnit, string id) => $"{businessUnit}/{id}";
}
