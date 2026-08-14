namespace Fcmr.Demo.Data;

/// <summary>
/// A small xorshift generator with an explicit, stable algorithm.
///
/// System.Random is deliberately not used. Its sequence for a given seed is an implementation
/// detail that has changed between .NET versions, so a corpus generated on one machine would not
/// match one generated on another. The demo claims reproducibility out loud — the surveillance
/// ranking is shown twice and asserted to be identical — so the generator underneath it has to be
/// stable across runtimes, not merely stable within one.
/// </summary>
public sealed class DeterministicRandom
{
    private ulong _state;

    public DeterministicRandom(ulong seed)
    {
        // A zero state is absorbing for xorshift, so displace it to a fixed non-zero constant.
        _state = seed == 0 ? 0x9E3779B97F4A7C15UL : seed;
    }

    public ulong NextUInt64()
    {
        var x = _state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        _state = x;
        return unchecked(x * 0x2545F4914F6CDD1DUL);
    }

    /// <summary>Uniform in [0, maxExclusive).</summary>
    public int Next(int maxExclusive)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxExclusive);
        return (int)(NextUInt64() % (ulong)maxExclusive);
    }

    /// <summary>Uniform in [minInclusive, maxExclusive).</summary>
    public int Next(int minInclusive, int maxExclusive)
    {
        ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(minInclusive, maxExclusive);
        return minInclusive + Next(maxExclusive - minInclusive);
    }

    /// <summary>Uniform in [0.0, 1.0).</summary>
    public double NextDouble() => (NextUInt64() >> 11) * (1.0 / 9007199254740992.0);

    public bool NextBool(double probability) => NextDouble() < probability;

    public T Pick<T>(IReadOnlyList<T> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentOutOfRangeException.ThrowIfZero(items.Count);
        return items[Next(items.Count)];
    }

    /// <summary>Rounded to four places so the value survives a JSON round trip unchanged.</summary>
    public decimal NextDecimal(decimal minInclusive, decimal maxExclusive) =>
        Math.Round(minInclusive + ((decimal)NextDouble() * (maxExclusive - minInclusive)), 4);

    /// <summary>
    /// A derived generator for one independent stream.
    ///
    /// Each generator draws from its own stream so that changing the number of research documents
    /// cannot shift the communications or the alerts. Without this, adding one document silently
    /// rewrites every downstream fixture and the rehearsed demo stops matching.
    /// </summary>
    public static DeterministicRandom ForStream(ulong seed, string streamName)
    {
        ArgumentNullException.ThrowIfNull(streamName);

        // FNV-1a over the stream name, mixed with the master seed.
        var hash = 14695981039346656037UL;
        foreach (var ch in streamName)
        {
            hash ^= ch;
            hash = unchecked(hash * 1099511628211UL);
        }

        return new DeterministicRandom(unchecked(seed ^ hash));
    }
}
