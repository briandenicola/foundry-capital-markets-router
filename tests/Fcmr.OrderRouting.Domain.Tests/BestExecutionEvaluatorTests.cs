using FluentAssertions;
using Fcmr.OrderRouting.Domain;
using Xunit;

namespace Fcmr.OrderRouting.Domain.Tests;

public static class Fixtures
{
    public static OrderIntent Order(
        int quantity = 1_000,
        decimal limit = 101m,
        OrderSide side = OrderSide.Buy,
        decimal arrivalMid = 100m) => new()
        {
            OrderId = "ord-1",
            CorrelationId = "corr-1",
            Symbol = "ATLN",
            Side = side,
            Quantity = quantity,
            LimitPrice = limit,
            ArrivalMidPrice = arrivalMid,
            TraderId = "TRD-1041",
        };

    public static VenueQuote Quote(
        string code = "XLIT",
        decimal mid = 100m,
        decimal spread = 0.05m,
        int liquidity = 50_000,
        decimal feeBps = 0m,
        VenueType type = VenueType.Lit) => new()
        {
            VenueCode = code,
            Type = type,
            MidPrice = mid,
            Spread = spread,
            DisplayedLiquidity = liquidity,
            FeeBps = feeBps,
        };
}

public class BestExecutionEvaluatorTests
{
    [Fact]
    public void An_ordinary_order_on_an_approved_venue_is_eligible()
    {
        var evaluation = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(), Fixtures.Quote(), BestExecutionPolicy.Default);

        evaluation.IsEligible.Should().BeTrue();
        evaluation.Breaches.Should().BeEmpty();
    }

    [Fact]
    public void Refuses_a_venue_that_is_not_approved()
    {
        var evaluation = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(), Fixtures.Quote(code: "DARK-2"), BestExecutionPolicy.Default);

        var breach = evaluation.Breaches.Should().ContainSingle().Subject;
        breach.Boundary.Should().Be(PolicyBoundary.VenueNotApproved);
        breach.Explanation.Should().Contain("VenueNotApproved at DARK-2");
    }

    [Fact]
    public void Refuses_a_dark_venue_for_an_order_below_the_block_floor()
    {
        var evaluation = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(quantity: 500),
            Fixtures.Quote(code: "DARK-1", type: VenueType.Dark),
            BestExecutionPolicy.Default);

        evaluation.Breaches.Select(b => b.Boundary)
            .Should().Contain(PolicyBoundary.DarkPoolMinimumSize);
        evaluation.Breaches.Single(b => b.Boundary == PolicyBoundary.DarkPoolMinimumSize)
            .Explanation.Should().Contain("10,000 shares minimum");
    }

    [Fact]
    public void Allows_a_dark_venue_for_a_block()
    {
        var evaluation = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(quantity: 12_000),
            Fixtures.Quote(code: "DARK-1", type: VenueType.Dark, liquidity: 200_000),
            BestExecutionPolicy.Default);

        evaluation.IsEligible.Should().BeTrue();
        evaluation.Cost.SpreadCostBps.Should().Be(0m, "dark venues execute at the midpoint");
    }

    [Fact]
    public void Refuses_an_order_taking_too_much_of_the_displayed_liquidity()
    {
        // 30,000 of 50,000 displayed is 60%, against a 20% ceiling.
        var evaluation = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(quantity: 30_000, limit: 200m),
            Fixtures.Quote(),
            BestExecutionPolicy.Default);

        evaluation.Breaches.Select(b => b.Boundary)
            .Should().Contain(PolicyBoundary.ParticipationRateExceeded);
    }

    [Fact]
    public void Refuses_a_spread_wider_than_the_desk_tolerates()
    {
        // 0.40 on a 100.00 mid is 40 bps, against a 25 bps ceiling.
        var evaluation = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(limit: 200m), Fixtures.Quote(spread: 0.40m), BestExecutionPolicy.Default);

        var breach = evaluation.Breaches.Single(b => b.Boundary == PolicyBoundary.SpreadToleranceExceeded);
        breach.Permitted.Should().Be("25 bps");
        breach.Observed.Should().Be("40.00 bps");
    }

    [Fact]
    public void Refuses_a_projected_price_through_a_buy_limit()
    {
        var evaluation = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(limit: 100.01m), Fixtures.Quote(), BestExecutionPolicy.Default);

        evaluation.Breaches.Select(b => b.Boundary)
            .Should().Contain(PolicyBoundary.LimitPriceBreached);
    }

    [Fact]
    public void Refuses_a_projected_price_through_a_sell_limit()
    {
        var evaluation = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(side: OrderSide.Sell, limit: 99.99m),
            Fixtures.Quote(),
            BestExecutionPolicy.Default);

        evaluation.Breaches.Select(b => b.Boundary)
            .Should().Contain(PolicyBoundary.LimitPriceBreached);
    }

    [Fact]
    public void A_sell_projects_below_the_mid_and_a_buy_above_it()
    {
        var buy = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(limit: 200m), Fixtures.Quote(), BestExecutionPolicy.Default);
        var sell = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(side: OrderSide.Sell, limit: 1m), Fixtures.Quote(), BestExecutionPolicy.Default);

        buy.Cost.ProjectedPrice.Should().BeGreaterThan(100m);
        sell.Cost.ProjectedPrice.Should().BeLessThan(100m);
    }

    [Fact]
    public void A_rebate_reduces_total_cost_and_may_take_it_negative()
    {
        var evaluation = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(limit: 200m),
            Fixtures.Quote(spread: 0.01m, liquidity: 1_000_000, feeBps: -5m),
            BestExecutionPolicy.Default);

        evaluation.Cost.FeeBps.Should().Be(-5m);
        evaluation.Cost.TotalCostBps.Should().BeLessThan(0m,
            "a rebate exceeding spread and impact is price improvement, and hiding it would misstate cost");
    }

    [Fact]
    public void Notional_ceiling_is_an_order_level_boundary()
    {
        var breaches = BestExecutionEvaluator.EvaluateOrder(
            Fixtures.Order(quantity: 500_000, limit: 100m), BestExecutionPolicy.Default);

        breaches.Should().ContainSingle()
            .Which.Boundary.Should().Be(PolicyBoundary.NotionalCeilingExceeded);
        breaches[0].VenueCode.Should().BeNull("this breach is not about any venue");
        breaches[0].Explanation.Should().StartWith("NotionalCeilingExceeded: permitted");
    }

    [Fact]
    public void A_venue_with_no_displayed_liquidity_breaches_participation_rather_than_dividing_by_zero()
    {
        var evaluation = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(), Fixtures.Quote(liquidity: 0), BestExecutionPolicy.Default);

        evaluation.Breaches.Select(b => b.Boundary)
            .Should().Contain(PolicyBoundary.ParticipationRateExceeded);
    }

    [Fact]
    public void Liquidity_rationale_states_the_numbers_it_rests_on()
    {
        var evaluation = BestExecutionEvaluator.EvaluateVenue(
            Fixtures.Order(quantity: 5_000, limit: 200m), Fixtures.Quote(), BestExecutionPolicy.Default);

        evaluation.LiquidityRationale.Should().Contain("50,000 shares at the touch");
        evaluation.LiquidityRationale.Should().Contain("10.0%");
    }

    [Fact]
    public void Evaluation_is_reproducible()
    {
        var order = Fixtures.Order(limit: 200m);
        var quote = Fixtures.Quote();

        var first = BestExecutionEvaluator.EvaluateVenue(order, quote, BestExecutionPolicy.Default);
        var second = BestExecutionEvaluator.EvaluateVenue(order, quote, BestExecutionPolicy.Default);

        second.Cost.Should().Be(first.Cost);
    }
}
