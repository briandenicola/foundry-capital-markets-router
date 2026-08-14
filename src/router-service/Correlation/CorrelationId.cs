using System.Diagnostics.CodeAnalysis;

namespace Fcmr.RouterService.Correlation;

/// <summary>Where the correlation id in force came from.</summary>
public enum CorrelationIdSource
{
    /// <summary>The router minted it because the caller supplied none.</summary>
    Generated,

    /// <summary>Taken from the inbound header.</summary>
    Header,

    /// <summary>Taken from the request body, which the caller sent without a header.</summary>
    Body,
}

/// <summary>
/// Wire format rules for a caller-supplied correlation id.
///
/// The value is echoed in a response header and written into every log scope and audit record, so
/// it is validated rather than trusted. An unbounded or control-character id is a header-splitting
/// and log-forging vector, and a forged audit line is worse than a missing one.
/// </summary>
public static class CorrelationIdFormat
{
    public const string HeaderName = "X-Correlation-Id";

    public const int MaxLength = 128;

    public static bool IsAcceptable([NotNullWhen(true)] string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > MaxLength)
        {
            return false;
        }

        foreach (var c in value)
        {
            var ok = char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or ':';
            if (!ok)
            {
                return false;
            }
        }

        return true;
    }
}

/// <summary>
/// The correlation id for the request currently in flight.
///
/// Scoped, and deliberately mutable in one direction only: the contract carries the id in the
/// request body as well as the header, and the body cannot be read before the pipeline starts. So
/// the middleware establishes a value up front and the endpoint may adopt a body-supplied id when
/// — and only when — the router had generated one for want of anything better.
/// </summary>
public interface ICorrelationIdAccessor
{
    string Value { get; }

    CorrelationIdSource Source { get; }

    /// <summary>
    /// Adopt an id carried in the request body.
    ///
    /// Returns false when a caller-supplied header is already in force and the body disagrees with
    /// it. That is a caller defect, not something to resolve by precedence: silently picking one
    /// would split a single interaction across two ids and break AC-8's one-query reconstruction.
    /// </summary>
    bool TryAdoptFromBody(string? candidate);
}

public sealed class CorrelationIdAccessor : ICorrelationIdAccessor
{
    private string _value = string.Empty;

    public string Value => _value;

    public CorrelationIdSource Source { get; private set; }

    public void Establish(string value, CorrelationIdSource source)
    {
        _value = value;
        Source = source;
    }

    public bool TryAdoptFromBody(string? candidate)
    {
        if (!CorrelationIdFormat.IsAcceptable(candidate))
        {
            return true;
        }

        if (string.Equals(candidate, _value, StringComparison.Ordinal))
        {
            return true;
        }

        if (Source != CorrelationIdSource.Generated)
        {
            return false;
        }

        _value = candidate;
        Source = CorrelationIdSource.Body;
        return true;
    }

    /// <summary>
    /// Logging providers format scope values when the entry is written, so handing the accessor
    /// itself to the scope means a body-adopted id appears on lines logged before the adoption is
    /// visible to the code that logged them. One request, one id, whichever leg it arrived on.
    /// </summary>
    public override string ToString() => _value;
}
