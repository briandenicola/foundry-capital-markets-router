using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

public class ComplexityScorerTests
{
    [Fact]
    public void Score_WithNoSignals_IsZero()
    {
        ComplexityScorer.Score(new ComplexityHints()).Should().Be(0.0);
    }

    [Fact]
    public void Score_WithAllSignalsSaturated_IsOne()
    {
        var hints = new ComplexityHints
        {
            InputTokenEstimate = 64_000,
            RequiresMultiStep = true,
            RequiresRetrieval = true,
            RequiresToolCalls = true,
        };

        ComplexityScorer.Score(hints).Should().Be(1.0);
    }

    [Fact]
    public void Score_IsDeterministic()
    {
        var hints = new ComplexityHints
        {
            InputTokenEstimate = 12_000,
            RequiresMultiStep = true,
            RequiresRetrieval = true,
        };

        var first = ComplexityScorer.Score(hints);
        var second = ComplexityScorer.Score(hints);

        second.Should().Be(first, "the same request must route the same way on stage as in rehearsal");
    }

    [Fact]
    public void Score_TokenSignalSaturates_SoLongerInputDoesNotKeepRaisingIt()
    {
        var atSaturation = ComplexityScorer.Score(new ComplexityHints { InputTokenEstimate = 32_000 });
        var farBeyond = ComplexityScorer.Score(new ComplexityHints { InputTokenEstimate = 500_000 });

        farBeyond.Should().Be(atSaturation);
    }

    [Theory]
    [InlineData(0.0, ModelTier.Economy)]
    [InlineData(0.34, ModelTier.Economy)]
    [InlineData(0.35, ModelTier.Standard)]
    [InlineData(0.69, ModelTier.Standard)]
    [InlineData(0.70, ModelTier.Premium)]
    [InlineData(1.0, ModelTier.Premium)]
    public void IndicatedTier_HonoursThresholdBoundaries(double score, ModelTier expected)
    {
        ComplexityScorer.IndicatedTier(score).Should().Be(expected);
    }

    [Fact]
    public void Score_NegativeTokenEstimate_IsTreatedAsZero()
    {
        var hints = new ComplexityHints { InputTokenEstimate = -5_000 };

        ComplexityScorer.Score(hints).Should().Be(0.0);
    }
}
