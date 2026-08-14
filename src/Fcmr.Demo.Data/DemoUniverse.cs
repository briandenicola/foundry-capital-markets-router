namespace Fcmr.Demo.Data;

/// <summary>
/// The fictional instruments, venues, desks, and people the fixtures are built from.
///
/// Everything here is invented. No real issuer, employee, or counterparty appears anywhere in the
/// corpus: the demo runs in front of a regulated audience, and synthetic data that resembles a
/// real firm's book invites exactly the question the demo should not spend time on.
/// </summary>
public static class DemoUniverse
{
    public static readonly IReadOnlyList<string> Symbols =
    [
        "ATLN", "BRDG", "CRVN", "DLTA", "EVRT", "FLGN", "GRDN", "HLYX",
        "IRSA", "JVLN", "KSTL", "LMBD", "MRDN", "NVSA", "ORCL8", "PLRS",
    ];

    public static readonly IReadOnlyList<string> Venues =
    [
        "XLIT", "XMER", "XNOR", "XPAC", "DARK-1", "DARK-2",
    ];

    public static readonly IReadOnlyList<string> Traders =
    [
        "TRD-1041", "TRD-1052", "TRD-1078", "TRD-1093", "TRD-1110",
        "TRD-1124", "TRD-1139", "TRD-1157", "TRD-1163", "TRD-1188",
    ];

    public static readonly IReadOnlyList<string> Counterparties =
    [
        "Northwind Securities", "Halberd Capital", "Ridgeline Partners",
        "Fenwick Asset Management", "Corvus Trading", "Marlowe Brothers",
    ];

    public static readonly IReadOnlyList<string> ResearchSources =
    [
        "Internal Equity Research", "Sector Desk Note", "Macro Strategy Weekly",
        "Credit Committee Minutes", "Earnings Call Transcript",
    ];

    public static readonly IReadOnlyList<string> AlertTypes =
    [
        "PotentialFrontRunning", "UnusualPreAnnouncementActivity", "WashTradeSuspicion",
        "LayeringPattern", "OffVenueConcentration", "MarkingTheClose",
    ];

    /// <summary>Fixed epoch so every run produces identical timestamps for a given seed.</summary>
    public static readonly DateTimeOffset Epoch = new(2026, 8, 3, 13, 30, 0, TimeSpan.Zero);
}
