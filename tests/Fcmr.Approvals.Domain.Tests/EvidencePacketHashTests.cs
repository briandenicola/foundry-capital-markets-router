using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Fcmr.Approvals.Domain;
using Xunit;

namespace Fcmr.Approvals.Domain.Tests;

/// <summary>
/// The hash exists to answer one question: is the evidence they approved the evidence that got
/// executed? Two properties make that answer worth anything, and both are tested here — the hash
/// must not move when nothing material changed, and it must move when anything material did.
///
/// The first matters more than it looks. A hash that changes on a serialisation round-trip fires
/// constantly, everyone learns to ignore it, and the control is gone while still appearing on the
/// architecture diagram.
/// </summary>
public class EvidencePacketHashTests
{
    private static readonly JsonSerializerOptions Compact = new() { WriteIndented = false };
    private static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true };

    [Fact]
    public void HashIsStableAcrossAJsonRoundTrip()
    {
        var packet = Fixtures.Packet();
        var original = EvidencePacketHasher.ComputeHash(packet);

        var revived = JsonSerializer.Deserialize<EvidencePacket>(JsonSerializer.Serialize(packet, Compact), Compact)!;

        EvidencePacketHasher.ComputeHash(revived).Should().Be(original);
    }

    [Fact]
    public void HashIsStableAcrossPropertyReorderingAndWhitespace()
    {
        var packet = Fixtures.Packet();
        var original = EvidencePacketHasher.ComputeHash(packet);

        var node = JsonNode.Parse(JsonSerializer.Serialize(packet, Compact))!.AsObject();
        var shuffled = new JsonObject();
        foreach (var property in node.OrderByDescending(p => p.Key, StringComparer.Ordinal).ToList())
        {
            node.Remove(property.Key);
            shuffled[property.Key] = property.Value;
        }

        var reordered = JsonSerializer.Deserialize<EvidencePacket>(shuffled.ToJsonString(Pretty), Pretty)!;

        EvidencePacketHasher.ComputeHash(reordered).Should().Be(original,
            "the hash is computed over the typed canonical form, so JSON property order and indentation " +
            "cannot reach it");
    }

    [Fact]
    public void DictionaryInsertionOrderDoesNotChangeTheHash()
    {
        var packet = Fixtures.Packet();

        var reversedInputs = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var key in packet.Inputs.Keys.Reverse())
        {
            reversedInputs[key] = packet.Inputs[key];
        }

        var reordered = packet with { Inputs = reversedInputs };

        EvidencePacketHasher.ComputeHash(reordered).Should().Be(EvidencePacketHasher.ComputeHash(packet));
    }

    [Fact]
    public void ReorderingCitationsDoesNotChangeTheHashButChangingTheSetDoes()
    {
        var packet = Fixtures.Packet();
        var baseline = EvidencePacketHasher.ComputeHash(packet);

        var reordered = packet with { RetrievedSources = packet.RetrievedSources.Reverse().ToList() };
        EvidencePacketHasher.ComputeHash(reordered).Should().Be(baseline,
            "a citation set is a set; a UI sort order is not a change of evidence");

        var removed = packet with { RetrievedSources = packet.RetrievedSources.Take(1).ToList() };
        EvidencePacketHasher.ComputeHash(removed).Should().NotBe(baseline);

        var added = packet with
        {
            RetrievedSources = packet.RetrievedSources
                .Append(new EvidenceSource
                {
                    DocumentId = "doc-9",
                    ChunkId = "chunk-1",
                    Excerpt = "A source nobody showed the approver.",
                    Score = 0.5,
                })
                .ToList(),
        };
        EvidencePacketHasher.ComputeHash(added).Should().NotBe(baseline);
    }

    /// <summary>
    /// Every material field, mutated one at a time. Enumerated rather than sampled: "the hash
    /// covers the packet" is a claim, and a claim in this repository needs evidence per field.
    /// </summary>
    [Fact]
    public void AnyMaterialChangeMovesTheHash()
    {
        var packet = Fixtures.Packet();
        var baseline = EvidencePacketHasher.ComputeHash(packet);

        var mutations = new Dictionary<string, EvidencePacket>(StringComparer.Ordinal)
        {
            ["correlationId"] = packet with { CorrelationId = "corr-0002" },
            ["lane"] = packet with { Lane = Lane.Surveillance },
            ["inputs value"] = packet with
            {
                Inputs = new Dictionary<string, string>(packet.Inputs, StringComparer.Ordinal) { ["quantity"] = "250000" },
            },
            ["inputs key added"] = packet with
            {
                Inputs = new Dictionary<string, string>(packet.Inputs, StringComparer.Ordinal) { ["urgency"] = "High" },
            },
            ["source excerpt"] = packet with
            {
                RetrievedSources = [packet.RetrievedSources[0] with { Excerpt = "Venue B showed the tightest spread." }, packet.RetrievedSources[1]],
            },
            ["source score"] = packet with
            {
                RetrievedSources = [packet.RetrievedSources[0] with { Score = 0.82 }, packet.RetrievedSources[1]],
            },
            ["source documentId"] = packet with
            {
                RetrievedSources = [packet.RetrievedSources[0] with { DocumentId = "doc-8" }, packet.RetrievedSources[1]],
            },
            ["source chunkId"] = packet with
            {
                RetrievedSources = [packet.RetrievedSources[0] with { ChunkId = "chunk-3" }, packet.RetrievedSources[1]],
            },
            ["outcome"] = packet with { RoutingDecision = packet.RoutingDecision with { Outcome = "Downgraded" } },
            ["complexityScore"] = packet with { RoutingDecision = packet.RoutingDecision with { ComplexityScore = 0.63 } },
            ["costCeilingUsd"] = packet with { RoutingDecision = packet.RoutingDecision with { CostCeilingUsd = 5.00m } },
            ["selectedTier"] = packet with { RoutingDecision = packet.RoutingDecision with { SelectedTier = "Premium" } },
            ["selectedDeployment"] = packet with { RoutingDecision = packet.RoutingDecision with { SelectedDeployment = "anthropic-standard" } },
            ["selectedVendor"] = packet with { RoutingDecision = packet.RoutingDecision with { SelectedVendor = "Anthropic" } },
            ["policySetId"] = packet with { RoutingDecision = packet.RoutingDecision with { PolicySetId = "CapitalMarkets-EU" } },
            ["policySetVersion"] = packet with { RoutingDecision = packet.RoutingDecision with { PolicySetVersion = 4 } },
            ["policySetVersion null"] = packet with { RoutingDecision = packet.RoutingDecision with { PolicySetVersion = null } },
            ["rationale"] = packet with { RoutingDecision = packet.RoutingDecision with { Rationale = "Something else entirely." } },
            ["action kind"] = packet with { ProposedAction = packet.ProposedAction with { Kind = "CancelOrder" } },
            ["action summary"] = packet with { ProposedAction = packet.ProposedAction with { Summary = "Route 250,000 to Venue B." } },
            ["action field"] = packet with
            {
                ProposedAction = packet.ProposedAction with
                {
                    Fields = new Dictionary<string, string>(packet.ProposedAction.Fields, StringComparer.Ordinal) { ["venue"] = "VENUE-B" },
                },
            },
            ["unattributable claim edited"] = packet with { UnattributableClaims = ["Something was withheld."] },
            ["unattributable claim dropped"] = packet with { UnattributableClaims = [] },
        };

        var unchanged = mutations
            .Where(m => EvidencePacketHasher.ComputeHash(m.Value) == baseline)
            .Select(m => m.Key)
            .ToList();

        unchanged.Should().BeEmpty("every material field must be covered by the hash");
    }

    /// <summary>
    /// Without length prefixing, ("ab","c") and ("a","bc") canonicalise to the same bytes, and
    /// anyone who controls two adjacent strings can move text between them without moving the
    /// hash. That is a real forgery, not a theoretical one, so it has a real test.
    /// </summary>
    [Fact]
    public void TextCannotBeMovedBetweenAdjacentFieldsWithoutMovingTheHash()
    {
        var packet = Fixtures.Packet();

        var left = packet with
        {
            ProposedAction = packet.ProposedAction with { Kind = "Route", Summary = "OrderToVenueA" },
        };
        var right = packet with
        {
            ProposedAction = packet.ProposedAction with { Kind = "RouteOrder", Summary = "ToVenueA" },
        };

        EvidencePacketHasher.ComputeHash(left).Should().NotBe(EvidencePacketHasher.ComputeHash(right));
    }

    [Fact]
    public void EquivalentDecimalScalesAndDoubleFormatsAgree()
    {
        var packet = Fixtures.Packet();

        var trailingZeros = packet with { RoutingDecision = packet.RoutingDecision with { CostCeilingUsd = 0.5000m } };
        EvidencePacketHasher.ComputeHash(trailingZeros).Should().Be(EvidencePacketHasher.ComputeHash(packet),
            "0.5000 and 0.50 are the same ceiling, and a JSON round-trip is free to rewrite one as the other");

        var wholeNumber = packet with { RoutingDecision = packet.RoutingDecision with { ComplexityScore = 1.0 } };
        var wholeNumberAgain = packet with { RoutingDecision = packet.RoutingDecision with { ComplexityScore = 1 } };
        EvidencePacketHasher.ComputeHash(wholeNumber).Should().Be(EvidencePacketHasher.ComputeHash(wholeNumberAgain));
    }

    [Fact]
    public void ANullFieldAndAnEmptyStringAreDistinguished()
    {
        var packet = Fixtures.Packet();

        var nullTier = packet with { RoutingDecision = packet.RoutingDecision with { SelectedTier = null } };
        var emptyTier = packet with { RoutingDecision = packet.RoutingDecision with { SelectedTier = "" } };

        EvidencePacketHasher.ComputeHash(nullTier).Should().NotBe(EvidencePacketHasher.ComputeHash(emptyTier),
            "'no tier was selected' and 'a tier named empty string' are different statements");
    }

    [Fact]
    public void TheHashIsLowercaseSha256HexAndTheCanonicalFormIsReproducible()
    {
        var packet = Fixtures.Packet();
        var hash = EvidencePacketHasher.ComputeHash(packet);

        hash.Should().MatchRegex("^[0-9a-f]{64}$");
        EvidencePacketHasher.Algorithm.Should().Be("SHA-256");

        // Public canonicalisation is the point: an auditor holding the packet can regenerate the
        // hashed text themselves rather than taking this assembly's word for it.
        var canonical = EvidencePacketHasher.Canonicalize(packet);
        canonical.Should().StartWith("4:form=");
        canonical.Should().Contain(EvidencePacketHasher.CanonicalFormVersion);
        EvidencePacketHasher.Canonicalize(packet).Should().Be(canonical);

        var independent = Convert.ToHexStringLower(
            System.Security.Cryptography.SHA256.HashData(new System.Text.UTF8Encoding(false).GetBytes(canonical)));
        independent.Should().Be(hash);
    }

    [Fact]
    public void ProposalPinsTheHashOfTheEvidenceItWasGiven()
    {
        var clock = new TestClock(Fixtures.T0);
        var packet = Fixtures.Packet();
        var approval = Fixtures.Pending(clock, packet);

        approval.EvidencePacketHash.Should().Be(EvidencePacketHasher.ComputeHash(packet));
        approval.VerifyEvidenceIntegrity().Should().BeTrue();
    }

    [Fact]
    public void EditingTheStoredPacketBreaksIntegrityAndRefusesTheDecision()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        var tamperedPacket = pending.EvidencePacket with
        {
            ProposedAction = pending.EvidencePacket.ProposedAction with { Summary = "Route 250,000 SYNTH-CORP-4 to Venue B." },
        };
        var tampered = Fixtures.Rehydrated(pending, packet: tamperedPacket);

        tampered.VerifyEvidenceIntegrity().Should().BeFalse();

        var result = tampered.Approve(Fixtures.Approver, clock);

        result.IsAccepted.Should().BeFalse();
        result.Refusal!.Kind.Should().Be(ApprovalRefusalKind.EvidencePacketMismatch);
        result.Refusal.StatusCode.Should().Be(409);
    }

    [Fact]
    public void AnApproverWhoAcknowledgesADifferentHashIsRefused()
    {
        var clock = new TestClock(Fixtures.T0);
        var pending = Fixtures.Pending(clock);

        var mismatch = pending.Apply(
            new ApproveCommand
            {
                DecidedByObjectId = Fixtures.Approver,
                AcknowledgedEvidencePacketHash = new string('0', 64),
            },
            clock);

        mismatch.IsAccepted.Should().BeFalse();
        mismatch.Refusal!.Kind.Should().Be(ApprovalRefusalKind.EvidencePacketMismatch);

        var matching = pending.Apply(
            new ApproveCommand
            {
                DecidedByObjectId = Fixtures.Approver,
                AcknowledgedEvidencePacketHash = pending.EvidencePacketHash.ToUpperInvariant(),
            },
            clock);

        matching.IsAccepted.Should().BeTrue("hex casing is not a difference in evidence");

        var rejectMismatch = pending.Apply(
            new RejectCommand
            {
                DecidedByObjectId = Fixtures.Approver,
                Reason = "Not satisfied.",
                AcknowledgedEvidencePacketHash = new string('f', 64),
            },
            clock);

        rejectMismatch.Refusal!.Kind.Should().Be(ApprovalRefusalKind.EvidencePacketMismatch);
    }
}
