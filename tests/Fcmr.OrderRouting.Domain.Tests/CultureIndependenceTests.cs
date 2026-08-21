using System.Globalization;
using FluentAssertions;
using Fcmr.OrderRouting.Domain;
using Xunit;

namespace Fcmr.OrderRouting.Domain.Tests;

/// <summary>
/// Locks in a bug found while writing these tests: the rationale and breach strings were built
/// with plain interpolation, which formats using the *current* culture. On a machine set to
/// de-DE the decimal separator flips and the projected cost renders differently, so two rehearsals
/// on two laptops would disagree while the code claimed to be reproducible.
///
/// Reproducibility that holds only on the author's machine is the kind of claim this repository
/// exists to avoid making, so it is asserted rather than assumed.
/// </summary>
public class CultureIndependenceTests
{
    private static readonly CultureInfo[] Cultures =
    [
        CultureInfo.InvariantCulture,
        new("de-DE"),
        new("fr-FR"),
        new("ja-JP"),
    ];

    private static T UnderCulture<T>(CultureInfo culture, Func<T> action)
    {
        var previous = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = culture;
            return action();
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
        }
    }

    [Fact]
    public void Liquidity_rationale_is_identical_in_every_culture()
    {
        var rendered = Cultures.Select(c => UnderCulture(c, () =>
            BestExecutionEvaluator.EvaluateVenue(
                Fixtures.Order(quantity: 5_000, limit: 200m),
                Fixtures.Quote(),
                BestExecutionPolicy.Default).LiquidityRationale)).ToArray();

        rendered.Distinct(StringComparer.Ordinal).Should().ContainSingle(
            "the same order on the same venue must read identically on every machine");
    }

    [Fact]
    public void Breach_explanations_are_identical_in_every_culture()
    {
        var rendered = Cultures.Select(c => UnderCulture(c, () =>
            string.Join("|", BestExecutionEvaluator.EvaluateVenue(
                Fixtures.Order(quantity: 30_000, limit: 100.01m),
                Fixtures.Quote(spread: 0.40m),
                BestExecutionPolicy.Default).Breaches.Select(b => b.Explanation)))).ToArray();

        rendered.Distinct(StringComparer.Ordinal).Should().ContainSingle();
    }

    [Fact]
    public void Best_execution_justification_is_identical_in_every_culture()
    {
        var rendered = Cultures.Select(c => UnderCulture(c, () =>
            RoutePlanner.Plan(
                Fixtures.Order(limit: 200m),
                [
                    Fixtures.Quote("XLIT", spread: 0.02m),
                    Fixtures.Quote("XMER", spread: 0.06m, feeBps: -1.5m),
                    Fixtures.Quote("DARK-2"),
                ],
                BestExecutionPolicy.Default,
                "agent-orderrouting").Proposal!.BestExecutionJustification)).ToArray();

        rendered.Distinct(StringComparer.Ordinal).Should().ContainSingle();
    }

    [Fact]
    public void Order_level_breach_explanation_is_identical_in_every_culture()
    {
        var rendered = Cultures.Select(c => UnderCulture(c, () =>
            BestExecutionEvaluator.EvaluateOrder(
                Fixtures.Order(quantity: 500_000, limit: 100m),
                BestExecutionPolicy.Default)[0].Explanation)).ToArray();

        rendered.Distinct(StringComparer.Ordinal).Should().ContainSingle();
    }
}
