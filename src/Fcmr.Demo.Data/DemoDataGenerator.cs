namespace Fcmr.Demo.Data;

public sealed record DemoDataOptions
{
    /// <summary>Master seed. The same seed must always produce a byte-identical fixture set.</summary>
    public ulong Seed { get; init; } = 0x0FC0_2026_0910UL;

    public int ResearchDocumentCount { get; init; } = 120;
    public int CommunicationCount { get; init; } = 4_000;
    public int OrderCount { get; init; } = 2_500;

    /// <summary>
    /// The acceptance criteria call for a 500-alert batch. Triage is only interesting at a volume
    /// no analyst could work through by hand, and 500 is the number the demo says out loud.
    /// </summary>
    public int AlertCount { get; init; } = 500;

    /// <summary>Proportion of communications planted as genuinely concerning.</summary>
    public double ConcerningCommunicationRate { get; init; } = 0.03;
}

/// <summary>
/// Builds the complete synthetic fixture set. Pure, offline, and reproducible.
///
/// Each collection draws from its own named stream, so changing the size of one collection does
/// not shift any other. That property is what lets the fixture set grow between rehearsals without
/// invalidating the run that was already rehearsed.
/// </summary>
public static class DemoDataGenerator
{
    public static DemoDataSet Generate(DemoDataOptions? options = null)
    {
        var opts = options ?? new DemoDataOptions();

        var documents = GenerateResearch(opts);
        var communications = GenerateCommunications(opts);
        var orders = GenerateOrders(opts);
        var executions = GenerateExecutions(opts, orders);
        var alerts = GenerateAlerts(opts, communications, orders);

        return new DemoDataSet
        {
            Seed = opts.Seed,
            ResearchDocuments = documents,
            Communications = communications,
            Orders = orders,
            Executions = executions,
            Alerts = alerts,
        };
    }

    private static List<ResearchDocument> GenerateResearch(DemoDataOptions opts)
    {
        var rng = DeterministicRandom.ForStream(opts.Seed, "research");
        var documents = new List<ResearchDocument>(opts.ResearchDocumentCount);

        string[] themes =
        [
            "margin compression", "order book depth", "settlement latency", "funding spreads",
            "sector rotation", "issuance pipeline", "counterparty concentration", "collateral haircuts",
        ];

        for (var i = 0; i < opts.ResearchDocumentCount; i++)
        {
            var symbol = rng.Pick(DemoUniverse.Symbols);
            var theme = rng.Pick(themes);
            var source = rng.Pick(DemoUniverse.ResearchSources);
            var docId = $"doc-{i:D4}";
            var published = DemoUniverse.Epoch.AddDays(-rng.Next(1, 180)).AddMinutes(rng.Next(0, 480));

            var chunkCount = rng.Next(3, 8);
            var chunks = new List<ResearchChunk>(chunkCount);

            for (var c = 0; c < chunkCount; c++)
            {
                // Each chunk states one checkable fact. Synthesis with per-claim attribution is
                // only demonstrable if the underlying passages contain discrete, citable claims.
                var figure = rng.NextDecimal(0.5m, 48.0m);
                var quarter = rng.Next(1, 5);

                chunks.Add(new ResearchChunk
                {
                    Id = $"{docId}-c{c:D2}",
                    DocumentId = docId,
                    Ordinal = c,
                    Text =
                        $"{symbol} {theme} moved {figure:0.00} percent in Q{quarter}. " +
                        $"The desk attributes the change to {rng.Pick(themes)} across {rng.Pick(DemoUniverse.Venues)}. " +
                        $"Coverage note {c + 1} of {chunkCount}.",
                });
            }

            documents.Add(new ResearchDocument
            {
                Id = docId,
                Title = $"{symbol} — {char.ToUpperInvariant(theme[0])}{theme[1..]} review",
                Source = source,
                Symbol = symbol,
                PublishedAt = published,
                Chunks = chunks,
            });
        }

        return documents;
    }

    private static List<Communication> GenerateCommunications(DemoDataOptions opts)
    {
        var rng = DeterministicRandom.ForStream(opts.Seed, "communications");
        var result = new List<Communication>(opts.CommunicationCount);

        string[] benign =
        [
            "Can you confirm the fill on that block before close.",
            "Sending the revised sheet over shortly.",
            "Client wants to work the balance across the session.",
            "No change to the limit, keep it resting.",
            "Settlement instructions came through fine this morning.",
            "Let's revisit sizing after the print.",
        ];

        // Deliberately ambiguous rather than cartoonish. A surveillance demo where the concerning
        // messages announce themselves proves only that string matching works.
        string[] concerning =
        [
            "Hold off on the sell until after the announcement lands.",
            "Heard from the other side of the wall, size it up before it's public.",
            "Keep this off the recorded line and just work it quietly.",
            "We can cross it internally and nobody has to see the print.",
            "Push the last few lots into the close to help the mark.",
            "Do the usual, buy it back tomorrow so it nets flat.",
        ];

        for (var i = 0; i < opts.CommunicationCount; i++)
        {
            var isConcerning = rng.NextBool(opts.ConcerningCommunicationRate);
            var symbol = rng.NextBool(0.8) ? rng.Pick(DemoUniverse.Symbols) : null;

            result.Add(new Communication
            {
                Id = $"comm-{i:D5}",
                Timestamp = DemoUniverse.Epoch.AddMinutes(-rng.Next(0, 20_160)),
                Channel = (CommunicationChannel)rng.Next(0, 3),
                FromParty = rng.Pick(DemoUniverse.Traders),
                ToParty = rng.NextBool(0.5)
                    ? rng.Pick(DemoUniverse.Traders)
                    : rng.Pick(DemoUniverse.Counterparties),
                Body = isConcerning ? rng.Pick(concerning) : rng.Pick(benign),
                Symbol = symbol,
                GroundTruthConcerning = isConcerning,
            });
        }

        return result;
    }

    private static List<Order> GenerateOrders(DemoDataOptions opts)
    {
        var rng = DeterministicRandom.ForStream(opts.Seed, "orders");
        var result = new List<Order>(opts.OrderCount);

        for (var i = 0; i < opts.OrderCount; i++)
        {
            result.Add(new Order
            {
                Id = $"ord-{i:D5}",
                Timestamp = DemoUniverse.Epoch.AddMinutes(-rng.Next(0, 20_160)),
                Symbol = rng.Pick(DemoUniverse.Symbols),
                Side = rng.NextBool(0.5) ? OrderSide.Buy : OrderSide.Sell,
                Quantity = rng.Next(1, 40) * 100,
                LimitPrice = rng.NextDecimal(8.0m, 420.0m),
                Venue = rng.Pick(DemoUniverse.Venues),
                TraderId = rng.Pick(DemoUniverse.Traders),
            });
        }

        return result;
    }

    private static List<Execution> GenerateExecutions(DemoDataOptions opts, List<Order> orders)
    {
        var rng = DeterministicRandom.ForStream(opts.Seed, "executions");
        var result = new List<Execution>();

        foreach (var order in orders)
        {
            // Partial fills are the norm; an all-or-nothing blotter looks synthetic at a glance
            // to exactly the audience this demo is for.
            var fills = rng.Next(1, 4);
            var remaining = order.Quantity;

            for (var f = 0; f < fills && remaining > 0; f++)
            {
                var isLast = f == fills - 1;
                var qty = isLast ? remaining : Math.Max(100, remaining / (fills - f));
                qty = Math.Min(qty, remaining);
                remaining -= qty;

                result.Add(new Execution
                {
                    Id = $"exe-{result.Count:D6}",
                    OrderId = order.Id,
                    Timestamp = order.Timestamp.AddSeconds(rng.Next(1, 900)),
                    Quantity = qty,
                    Price = Math.Round(order.LimitPrice * (decimal)(0.995 + (rng.NextDouble() * 0.01)), 4),
                    Venue = rng.NextBool(0.85) ? order.Venue : rng.Pick(DemoUniverse.Venues),
                });
            }
        }

        return result;
    }

    private static List<SurveillanceAlert> GenerateAlerts(
        DemoDataOptions opts,
        List<Communication> communications,
        List<Order> orders)
    {
        var rng = DeterministicRandom.ForStream(opts.Seed, "alerts");
        var result = new List<SurveillanceAlert>(opts.AlertCount);

        var concerningComms = communications.Where(c => c.GroundTruthConcerning).ToList();
        var benignComms = communications.Where(c => !c.GroundTruthConcerning).ToList();

        // Roughly a fifth of the batch is genuinely concerning. High enough that triage has real
        // work to do, low enough that ranking has to discriminate rather than pass everything.
        var concerningTarget = Math.Min(opts.AlertCount / 5, concerningComms.Count);

        for (var i = 0; i < opts.AlertCount; i++)
        {
            var isConcerning = i < concerningTarget;
            var seedComm = isConcerning
                ? concerningComms[i % concerningComms.Count]
                : rng.Pick(benignComms);

            var symbol = seedComm.Symbol ?? rng.Pick(DemoUniverse.Symbols);
            var trader = seedComm.FromParty;

            // Evidence must resolve. Prefer the same symbol and trader so the alert detail view
            // tells a coherent story rather than a random one.
            var relatedOrders = orders
                .Where(o => string.Equals(o.Symbol, symbol, StringComparison.Ordinal))
                .Take(3)
                .Select(o => o.Id)
                .ToList();

            if (relatedOrders.Count == 0)
            {
                relatedOrders = [rng.Pick(orders).Id];
            }

            var relatedComms = new List<string> { seedComm.Id };
            var extra = rng.Next(0, 3);
            for (var e = 0; e < extra; e++)
            {
                relatedComms.Add(rng.Pick(communications).Id);
            }

            result.Add(new SurveillanceAlert
            {
                Id = $"alert-{i:D4}",
                Timestamp = seedComm.Timestamp.AddMinutes(rng.Next(5, 120)),
                Symbol = symbol,
                TraderId = trader,
                AlertType = rng.Pick(DemoUniverse.AlertTypes),
                CommunicationIds = relatedComms,
                OrderIds = relatedOrders,
                GroundTruthConcerning = isConcerning,
            });
        }

        // Shuffle so the concerning alerts are not the first hundred rows. Ranking that only has
        // to preserve input order is not ranking.
        for (var i = result.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (result[i], result[j]) = (result[j], result[i]);
        }

        return result;
    }
}
