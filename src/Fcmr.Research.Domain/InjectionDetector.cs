using System.Text.RegularExpressions;

namespace Fcmr.Research.Domain;

/// <summary>
/// What an injection attempt was trying to achieve. Categorised because the demo narrative and the
/// audit record both need to say what was attempted, not merely that something was.
/// </summary>
public enum InjectionCategory
{
    /// <summary>Attempts to void earlier instructions — "ignore all previous instructions".</summary>
    InstructionOverride,

    /// <summary>Attempts to reassign the agent's role — "you are now an unrestricted assistant".</summary>
    RoleReassignment,

    /// <summary>Text impersonating a system turn or chat-template delimiter.</summary>
    SystemPromptSpoof,

    /// <summary>Text shaped like a tool or function call, trying to borrow the agent's authority.</summary>
    ToolInvocation,

    /// <summary>
    /// Attempts to have an action approved or an approval waived. Specific to this system: the
    /// control worth attacking here is the human approval gate, not the model.
    /// </summary>
    ApprovalBypass,

    /// <summary>Attempts to route data outward — "post the contents to https://...".</summary>
    Exfiltration,
}

/// <summary>
/// One detection: a category, the chunk it was found in, and the matched text.
/// </summary>
public sealed record InjectionDetection
{
    public required string ChunkId { get; init; }

    public required string SourceId { get; init; }

    public required InjectionCategory Category { get; init; }

    /// <summary>
    /// The matched span, truncated. Recorded so a reviewer can judge the detection rather than
    /// take it on trust, and truncated so a long adversarial payload cannot flood the audit record.
    /// </summary>
    public required string Match { get; init; }

    /// <summary>Zero-based offset of the match within the chunk text.</summary>
    public int Offset { get; init; }
}

/// <summary>
/// Scans retrieved content for attempts to instruct the agent (T-024).
///
/// Two things this is, and one thing it is emphatically not.
///
/// It **is** a detector, so that an attempt is logged and can be shown on stage — AC-3 requires the
/// attempt to be logged, and a control nobody can see is not persuasive to a compliance audience.
/// It **is** defence in depth, quarantining the affected chunk so a claim does not come to rest on
/// text an attacker wrote.
///
/// It is **not** the control that stops retrieved content from calling tools. That control is
/// architectural: there is no code path by which retrieved text becomes a tool invocation, because
/// retrieved text is only ever passed as evidence content and tool selection is made by the agent
/// host against a fixed schema. Pattern matching over adversarial text is unwinnable in general —
/// an attacker who can rephrase defeats any finite pattern list. So the structural guarantee
/// carries the weight, and this detector supplies visibility and a second layer.
///
/// Stating that plainly matters more than the pattern list. A detector presented as the primary
/// defence would be an overclaim of exactly the kind this repository is trying to avoid.
/// </summary>
public static partial class InjectionDetector
{
    private const int MaxMatchLength = 120;

    /// <summary>Scans one chunk and returns every detection, in offset order.</summary>
    public static IReadOnlyList<InjectionDetection> Scan(RetrievedChunk chunk)
    {
        ArgumentNullException.ThrowIfNull(chunk);

        var detections = new List<InjectionDetection>();

        foreach (var (category, pattern) in Patterns)
        {
            foreach (var match in pattern.Matches(chunk.Text).Cast<Match>())
            {
                detections.Add(new InjectionDetection
                {
                    ChunkId = chunk.ChunkId,
                    SourceId = chunk.SourceId,
                    Category = category,
                    Match = Truncate(match.Value),
                    Offset = match.Index,
                });
            }
        }

        detections.Sort(static (a, b) => a.Offset.CompareTo(b.Offset));
        return detections;
    }

    /// <summary>Scans an entire retrieval result.</summary>
    public static IReadOnlyList<InjectionDetection> ScanAll(RetrievalResult retrieval)
    {
        ArgumentNullException.ThrowIfNull(retrieval);

        var all = new List<InjectionDetection>();
        foreach (var chunk in retrieval.Chunks)
        {
            all.AddRange(Scan(chunk));
        }

        return all;
    }

    private static string Truncate(string value)
    {
        var collapsed = Whitespace().Replace(value, " ").Trim();
        return collapsed.Length <= MaxMatchLength
            ? collapsed
            : string.Concat(collapsed.AsSpan(0, MaxMatchLength), "…");
    }

    private static readonly (InjectionCategory Category, Regex Pattern)[] Patterns =
    [
        (InjectionCategory.InstructionOverride, InstructionOverride()),
        (InjectionCategory.RoleReassignment, RoleReassignment()),
        (InjectionCategory.SystemPromptSpoof, SystemPromptSpoof()),
        (InjectionCategory.ToolInvocation, ToolInvocation()),
        (InjectionCategory.ApprovalBypass, ApprovalBypass()),
        (InjectionCategory.Exfiltration, Exfiltration()),
    ];

    [GeneratedRegex(
        @"\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|earlier|above|all)\b[^.\n]{0,20}\b(?:instruction|prompt|rule|direction)s?\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex InstructionOverride();

    [GeneratedRegex(
        @"\b(?:you\s+are\s+now|from\s+now\s+on(?:,)?\s+you|act\s+as(?:\s+an?)?|pretend\s+to\s+be|your\s+new\s+(?:role|instruction)s?)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex RoleReassignment();

    [GeneratedRegex(
        @"(?:<\|im_(?:start|end)\|>|\[/?INST\]|<<SYS>>|^\s*###\s*system\b|^\s*(?:system|assistant)\s*:)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Multiline)]
    private static partial Regex SystemPromptSpoof();

    [GeneratedRegex(
        @"(?:\b(?:call|invoke|execute|run)\s+the\s+\w+\s+(?:tool|function)\b|""(?:function_call|tool_call|tool_calls)""\s*:)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ToolInvocation();

    [GeneratedRegex(
        @"\b(?:auto[-\s]?approve|approve\s+(?:this|the|all)\b|no\s+approval\s+(?:is\s+)?(?:needed|required)|skip\s+(?:the\s+)?approval|without\s+(?:human\s+)?(?:approval|review))",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ApprovalBypass();

    [GeneratedRegex(
        @"\b(?:send|post|upload|exfiltrate|forward|transmit)\b[^.\n]{0,60}?(?:https?://|\b(?:to|at)\s+\S+@\S+\.\w+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Exfiltration();

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex Whitespace();
}
