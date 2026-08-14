# Scoreboard UI design

Vite, React, TypeScript. Entra authentication, role-aware navigation.

Three of the four wow moments are screens in this application. The UI is not a viewer over the
interesting part of the system — for the audience, it **is** the system. Everything below is
written for a projector in a room of sceptical people, not for a desk.

## Design constraints

**The audience reads this from ten feet away.** Dense tables and 12px labels are unreadable on a
projector. Type scale starts larger than a normal admin tool, and every screen has one number that
is deliberately the largest thing on it.

**Nothing may look rehearsed.** No pre-baked screenshots, no seeded animations. If a value is on
screen it came from the API just now. Beat 8 has an audience member choose a record at random;
that only survives if the UI never special-cases anything.

**Every claim on screen is drillable.** A number a presenter cannot open is a number the audience
assumes is decorative. Cost, rank, and quality all open to the record behind them.

**Degradation is visible, not silent.** If the scoreboard falls back to the Cosmos change feed
(ADR 004), the UI says so. A demo that hides its own failure is one bad question from collapse.

## Screen inventory

| # | Screen | Route | Roles | Task | Beat |
|---|---|---|---|---|---|
| 1 | Request console | `/` | Router.Invoke | T-028 | 3, 5 |
| 2 | Live scoreboard | `/scoreboard` | Router.Read | T-029 | 3 |
| 3 | Cost comparison | `/scoreboard/comparison` | Router.Read | T-030 | 3 — **wow B** |
| 4 | Decision detail | `/decisions/:id` | Router.Read | T-029 | 3, 8 |
| 5 | Surveillance triage | `/surveillance` | Router.Read | T-031 | 4 — **wow C** |
| 6 | Alert detail | `/surveillance/:id` | Router.Read | T-031 | 4 |
| 7 | Approval queue | `/approvals` | Approver | T-032 | 6 |
| 8 | Approval detail | `/approvals/:id` | Approver | T-032 | 6 |
| 9 | Research | `/research` | Router.Invoke | T-033 | 7 — **wow D** |
| 10 | Order routing | `/orders` | Router.Invoke | T-034 | — |
| 11 | Audit reconstruction | `/audit/:correlationId` | Router.Read | T-020 | 8 |
| 12 | Policy sets | `/policy` | Approver | new | 5 |

Screen 12 does not exist in the current task list. It is required for Beat 5 — the policy swap has
to happen *somewhere*, and doing it in the Azure portal breaks the narrative that governance is a
first-class surface.

## Screens that carry a wow moment

### 3 — Cost comparison (wow B)

One number dominates: **percentage saved against an all-premium baseline.** Everything else is
supporting evidence.

Below it, a per-request table with tier, cost, latency, and rationale, and a bar showing actual
against baseline. The presenter drills one row mid-sentence and reads the rationale aloud, so the
rationale must be a plain sentence naming the deciding factor — not a JSON blob and not a score.

Refresh is 5 seconds (AC-5), and the UI shows the timestamp of the data, not a spinner. A stale
number that admits it is stale beats a fresh-looking lie.

### 5 — Surveillance triage (wow C)

500+ alerts, ranked, with rationale and evidence count per row. Virtualised list — 500 DOM rows
will stutter on projector hardware and the stutter reads as "this doesn't scale."

The rank column shows the score and is sortable, but **defaults to model rank**, because the point
is that the ranking is the product. A visible seed indicator supports the reproducibility claim in
AC-6: same seed, same order, provable on stage.

### 9 — Research (wow D)

Inline citations rendered as clickable superscripts that open the source chunk. A coverage
percentage in the header.

**The unattributable-claims panel is the point of this screen**, not a footnote. It is always
present, and when empty it says "no unattributable claims" rather than disappearing. A panel that
only appears on failure teaches the audience it is an error state; a panel that is always there
teaches them it is a control.

## Component and state architecture

```text
src/webui/src/
  app/            router, auth provider, role guards, error boundary
  components/     presentational only, no fetching
  features/       one folder per screen: hooks, queries, view
  lib/            api client, Entra token acquisition, formatters
  types/          generated from contracts/*.md schemas
```

**Data fetching.** TanStack Query. Polling at 5s for live views with `refetchOnWindowFocus`
disabled — a presenter alt-tabbing must not trigger a visible refetch mid-sentence.

**Why polling and not push.** SignalR would be lower latency, but it adds a service to the private
network, a reconnect path to rehearse, and a new failure mode on stage. The budget is 5 seconds
and polling meets it. Revisit only if AC-5 measurements fail (T-029).

**Types are generated from the contracts**, not hand-written. Hand-written types drift from the API
and the drift surfaces during a demo.

**No global state store.** Server state lives in TanStack Query; UI state is local. There is no
client state complex enough to justify more.

## Required states

Every data view implements all five. Missing states are how demos break — the empty state nobody
built is the one that renders during the live run.

| State | Requirement |
|---|---|
| Loading | Skeleton matching final layout. No layout shift on a projector |
| Empty | Explains what would populate it and how to trigger it |
| Error | Names what failed and what still works. Never a bare "Something went wrong" |
| Partial | Some lanes returned, some did not — show what exists, mark what is missing |
| Degraded | Fallback data source or stale data, labelled inline |

## Auth and roles

MSAL browser, Entra app roles: `Router.Invoke`, `Router.Read`, `Approver`.

**Unauthorised navigation is hidden, and unauthorised actions are visibly blocked.** These are
different on purpose. Beat 6 requires showing a user who lacks `Approver` being refused — if the
button were merely hidden there would be nothing to demonstrate. The approve control renders
disabled with the reason stated.

## Open questions

1. Screen 12 (policy sets) is unscheduled. Beat 5 needs it, even if read-mostly with a single
   vendor toggle.
2. Whether the request console exposes data classification as a user control. It is needed for the
   Restricted-data demonstration, but it edges towards the application choosing routing inputs.
   Current position: classification is a property of the *request*, not a routing preference, so
   exposing it is consistent with Principle IV.
