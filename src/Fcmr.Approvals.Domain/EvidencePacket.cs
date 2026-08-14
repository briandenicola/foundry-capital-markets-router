using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Fcmr.Approvals.Domain;

/// <summary>A retrieved source that supported the proposal. Attribution, not decoration.</summary>
public sealed record EvidenceSource
{
    public required string DocumentId { get; init; }
    public required string ChunkId { get; init; }

    /// <summary>The text actually shown to the approver. Hashed, so it cannot be edited afterwards.</summary>
    public required string Excerpt { get; init; }

    /// <summary>Retrieval score as presented. Part of the hash: a re-ranked packet is a different packet.</summary>
    public required double Score { get; init; }
}

/// <summary>
/// The routing decision that produced the proposal, flattened to primitives.
///
/// Deliberately a copy of the fields rather than a project reference to Fcmr.Router.Decisions. Two
/// reasons: that assembly is frozen, and an evidence packet must be readable years later by
/// whatever can parse JSON, without needing the type that wrote it.
/// </summary>
public sealed record RoutingDecisionSummary
{
    public required string Outcome { get; init; }
    public required double ComplexityScore { get; init; }
    public required decimal CostCeilingUsd { get; init; }
    public string? SelectedTier { get; init; }
    public string? SelectedDeployment { get; init; }
    public string? SelectedVendor { get; init; }
    public string? PolicySetId { get; init; }
    public int? PolicySetVersion { get; init; }

    /// <summary>The rationale shown to the approver, verbatim.</summary>
    public required string Rationale { get; init; }
}

/// <summary>
/// What the agent proposes to do. It proposes; it does not commit.
/// </summary>
public sealed record ProposedAction
{
    /// <summary>Lane-specific, for example RouteOrder, EscalateAlert, PublishResearch.</summary>
    public required string Kind { get; init; }

    /// <summary>One line, shown in the approval queue.</summary>
    public required string Summary { get; init; }

    /// <summary>Lane-specific parameters. Ordered canonically at hash time, so map order is not material.</summary>
    public IReadOnlyDictionary<string, string> Fields { get; init; } =
        new Dictionary<string, string>(StringComparer.Ordinal);
}

/// <summary>
/// Everything presented to the approver at decision time.
///
/// This packet is what the hash covers, and the hash is the reason anyone can later prove that the
/// evidence approved is the evidence executed. Nothing in this assembly can create a packet from
/// absent data: every required member must be supplied by the lane that actually retrieved it.
/// Per ADR-007 and Principle III, missing evidence is reported as missing, never invented to make
/// a packet well-formed.
/// </summary>
public sealed record EvidencePacket
{
    public required string CorrelationId { get; init; }
    public required Lane Lane { get; init; }

    /// <summary>The request as received. Ordered canonically at hash time.</summary>
    public IReadOnlyDictionary<string, string> Inputs { get; init; } =
        new Dictionary<string, string>(StringComparer.Ordinal);

    /// <summary>
    /// Sources retrieved and shown. Ordered canonically at hash time by (documentId, chunkId),
    /// because a citation set is a set: presenting the same four sources in a different order is
    /// the same evidence, and a hash that disagreed would fire on a UI sort change. Adding,
    /// removing, or editing a source does change the hash — that is the case that matters.
    /// </summary>
    public IReadOnlyList<EvidenceSource> RetrievedSources { get; init; } = [];

    public required RoutingDecisionSummary RoutingDecision { get; init; }
    public required ProposedAction ProposedAction { get; init; }

    /// <summary>
    /// Claims that could not be attributed, carried into the packet so the approver sees what was
    /// withheld. Principle III: withheld and explicitly reported, never silently dropped.
    /// </summary>
    public IReadOnlyList<string> UnattributableClaims { get; init; } = [];
}

/// <summary>
/// Canonicalises an evidence packet and hashes it with SHA-256.
///
/// <para>
/// The hash is computed over a <em>canonical form derived from the typed packet</em>, never over
/// serialised bytes. That single choice is what makes it stable across JSON round-trips, property
/// reordering, and pretty-printing: those all change the bytes and none of them can reach the
/// canonical form. A hash that changes on round-trip is worse than no hash, because it teaches
/// people to ignore the one alarm that matters.
/// </para>
/// <para>
/// The canonical form is length-prefixed on both the label and the value:
/// <c>len:label=len:value\n</c>. Length prefixing is not decoration — without it, the fields
/// ("ab", "c") and ("a", "bc") produce identical bytes, and an attacker who controls two adjacent
/// strings can move text between them without moving the hash. There is a test for exactly that.
/// </para>
/// <para>
/// Numbers use invariant, round-trippable formatting, decimals are trimmed to a canonical scale so
/// 1.50 and 1.5 agree, and instants are normalised to UTC. The form is deliberately plain text so
/// an auditor can regenerate it by hand and compare; <see cref="Canonicalize"/> is public for that
/// purpose.
/// </para>
/// </summary>
public static class EvidencePacketHasher
{
    /// <summary>Named in the audit record so the algorithm can be proven, not assumed.</summary>
    public const string Algorithm = "SHA-256";

    /// <summary>Version of the canonical form. Changing the form changes every hash, so it is announced.</summary>
    public const string CanonicalFormVersion = "fcmr-evidence-canonical-v1";

    public static string ComputeHash(EvidencePacket packet)
    {
        ArgumentNullException.ThrowIfNull(packet);

        var bytes = SHA256.HashData(new UTF8Encoding(false).GetBytes(Canonicalize(packet)));
        return Convert.ToHexStringLower(bytes);
    }

    /// <summary>
    /// The exact text that gets hashed. Public so that anyone holding the packet can reproduce the
    /// hash independently of this code — an integrity claim nobody can check is an assurance, and
    /// assurances are what this repository exists to replace.
    /// </summary>
    public static string Canonicalize(EvidencePacket packet)
    {
        ArgumentNullException.ThrowIfNull(packet);

        var w = new CanonicalWriter();
        w.Text("form", CanonicalFormVersion);
        w.Text("correlationId", packet.CorrelationId);
        w.Text("lane", packet.Lane.ToString());

        w.Map("inputs", packet.Inputs);

        var sources = packet.RetrievedSources
            .OrderBy(s => s.DocumentId, StringComparer.Ordinal)
            .ThenBy(s => s.ChunkId, StringComparer.Ordinal)
            .ThenBy(s => s.Excerpt, StringComparer.Ordinal)
            .ToList();

        w.Count("retrievedSources", sources.Count);
        for (var i = 0; i < sources.Count; i++)
        {
            var prefix = $"retrievedSources[{i.ToString(CultureInfo.InvariantCulture)}]";
            w.Text($"{prefix}.documentId", sources[i].DocumentId);
            w.Text($"{prefix}.chunkId", sources[i].ChunkId);
            w.Text($"{prefix}.excerpt", sources[i].Excerpt);
            w.Number($"{prefix}.score", sources[i].Score);
        }

        var d = packet.RoutingDecision;
        w.Text("routingDecision.outcome", d.Outcome);
        w.Number("routingDecision.complexityScore", d.ComplexityScore);
        w.Money("routingDecision.costCeilingUsd", d.CostCeilingUsd);
        w.Text("routingDecision.selectedTier", d.SelectedTier);
        w.Text("routingDecision.selectedDeployment", d.SelectedDeployment);
        w.Text("routingDecision.selectedVendor", d.SelectedVendor);
        w.Text("routingDecision.policySetId", d.PolicySetId);
        w.Integer("routingDecision.policySetVersion", d.PolicySetVersion);
        w.Text("routingDecision.rationale", d.Rationale);

        w.Text("proposedAction.kind", packet.ProposedAction.Kind);
        w.Text("proposedAction.summary", packet.ProposedAction.Summary);
        w.Map("proposedAction.fields", packet.ProposedAction.Fields);

        // Order is preserved here, unlike sources: an ordered list of withheld claims is how it was
        // shown to the approver, and reordering prose changes what was read.
        w.Count("unattributableClaims", packet.UnattributableClaims.Count);
        for (var i = 0; i < packet.UnattributableClaims.Count; i++)
        {
            w.Text($"unattributableClaims[{i.ToString(CultureInfo.InvariantCulture)}]", packet.UnattributableClaims[i]);
        }

        return w.ToString();
    }

    private sealed class CanonicalWriter
    {
        private readonly StringBuilder _sb = new();

        public void Text(string label, string? value) =>
            Emit(label, value is null ? "null:" : "str:" + value);

        public void Number(string label, double value) =>
            Emit(label, "num:" + value.ToString("R", CultureInfo.InvariantCulture));

        public void Integer(string label, int? value) =>
            Emit(label, value is null ? "null:" : "int:" + value.Value.ToString(CultureInfo.InvariantCulture));

        /// <summary>
        /// Decimals are normalised so trailing zeros cannot change the hash. 1.50 and 1.5 are the
        /// same amount of money, and a JSON round-trip is free to rewrite one as the other.
        /// </summary>
        public void Money(string label, decimal value)
        {
            var normalised = value / 1.000000000000000000000000000000000m;
            Emit(label, "dec:" + normalised.ToString(CultureInfo.InvariantCulture));
        }

        public void Count(string label, int value) =>
            Emit(label, "cnt:" + value.ToString(CultureInfo.InvariantCulture));

        public void Map(string label, IReadOnlyDictionary<string, string> map)
        {
            Emit(label, "cnt:" + map.Count.ToString(CultureInfo.InvariantCulture));
            foreach (var key in map.Keys.OrderBy(k => k, StringComparer.Ordinal))
            {
                Emit($"{label}{{{key}}}", "str:" + map[key]);
            }
        }

        private void Emit(string label, string typedValue) =>
            _sb.Append(label.Length.ToString(CultureInfo.InvariantCulture))
               .Append(':').Append(label).Append('=')
               .Append(typedValue.Length.ToString(CultureInfo.InvariantCulture))
               .Append(':').Append(typedValue).Append('\n');

        public override string ToString() => _sb.ToString();
    }
}
