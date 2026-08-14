# 007. No fallback may simulate agent reasoning

- **Status**: Accepted
- **Date**: 2026-08-14
- **Amends**: the Delivery Constraints clause of `.specify/memory/constitution.md` requiring a
  local, no-Azure fallback path.

## Context

The demo makes one claim that cannot be made by any other means: **a real agent, reasoning live,
inside a governed private environment.** Every other claim — private networking, policy routing,
approval gates, cost attribution — could in principle be argued from a slide deck. The agentic
claim cannot. It is the reason the audience is in the room.

The plan as written contained a mechanism that would quietly destroy that claim. T-027h built a
determinism harness that recorded agent transcripts, and T-040 replayed those transcripts as a
local, no-Azure fallback so that "the narrative survives losing the network."

Consider what that produces on stage. The network fails, the fallback engages, and the screen shows
an agent selecting tools, reasoning across steps, and citing sources — none of which is happening.
The audience is watching a recording of reasoning while being told they are watching reasoning. The
label "fallback" in the corner of the UI does not repair this, because the thing being falsified is
not the *data source*; it is **whether any inference occurred at all**.

There is a second, worse property. A transcript replay cannot fail. It will happily "reason" about
a question the agent has never seen, because it is not reasoning — it is playing back. The moment
someone asks for Beat 8's unrehearsed pick, the fallback either produces a confident answer to a
question it never received, or it visibly breaks in the least recoverable way possible. Both
outcomes are worse than having no fallback.

This audience's entire professional instinct is detecting a control that is asserted rather than
enforced. Handing them a simulation of the one thing that cannot be simulated is not a hedge
against failure. It is the failure.

## Decision

**No fallback, mock, replay, or fixture may stand in for live model inference or live agent
reasoning in any demonstrated path.**

If the agent cannot run, the demo says the agent cannot run.

The governing test for any current or future fallback:

> A fallback is permitted when it changes **where real evidence is read from**.
> A fallback is forbidden when it changes **whether the evidence is real**.

Applied to what exists today:

| Mechanism | Verdict | Why |
|---|---|---|
| Recorded agent transcript replay (T-027h → T-040) | **Removed** | Changes whether inference happened. This is the whole of the objection. |
| Local no-Azure narrative path (T-040) | **Removed** | Cannot exist without the above. Its only content was replay. |
| Scoreboard reads Cosmos change feed instead of App Insights (ADR-004) | **Kept** | Same real telemetry from a real request, read by a different path. Surfaces as `degraded` with the reason on screen. |
| `partial` / `degraded` UI states | **Kept, and load-bearing** | These are the *opposite* of masking: they force a screen to declare incompleteness. Removing them makes masking easier, not harder. |
| Simulated OMS | **Kept** | We cannot place real trades into a real market. Disclosed on the record itself, not as a corner disclaimer (T-034). The simulation is of *market execution*, never of reasoning. |
| Seeded synthetic corpus | **Kept** | Fixes the agent's *inputs* so runs are comparable. The agent still reasons over them live. |
| Pinned temperature / fixed seeds | **Kept** | Constrains sampling, does not replace inference. The model still runs. |

The distinction that survives all of these: **inputs may be fixed and evidence may be re-read;
reasoning is always live.**

## Consequences

**We accept a demo that can fail in front of the audience.** If Azure is unreachable on 9/10, the
agentic beats do not run. This is a deliberate, eyes-open trade: a demo that can fail is the only
kind whose success means anything. A demo that cannot fail has not demonstrated anything.

Mitigation moves from *substitution* to *resilience and disclosure*:

1. **Reduce the probability of failure** rather than paper over it — rehearse on the real
   environment, keep the environment warm on 9/9 rather than rebuilding into the demo, and hold
   quota headroom.
2. **Fail informatively.** When a lane cannot reach a model, the UI states which dependency failed
   and what the request would have done. Showing the *governed refusal* of an unrunnable request is
   still a true demonstration of the control plane, and it is honest.
3. **Have a non-simulating contingency.** If the agents cannot run, present the recorded transcripts
   **as a recording, out of the product UI**, narrated as "here is what this did in rehearsal." A
   video honestly labelled is fine. A live-looking UI replaying a script is not. The difference is
   entirely whether the audience could mistake it for the real thing.
4. **The private-posture beats survive independently.** Beat 2 is Terraform, portal, and denied
   connections; it does not need an agent. If inference is down, the governance story is still fully
   demonstrable — which is a good argument for keeping the two claims separable.

**Cost:** we lose the guarantee that the full narrative runs on 9/10 under any conditions. That
guarantee was never real; it was the appearance of one.

## Alternatives considered

- **Keep replay, label it harder.** Rejected. No label is sufficient, because the audience cannot
  distinguish a labelled replay from a labelled live run by looking, and the claim under test is
  precisely the one the label concedes. It also invites the question we least want: "so how much of
  what we saw earlier was real?" — retroactively contaminating the beats that *were* live.
- **Replay only on network failure, silently.** Rejected outright, and worth naming so it is never
  proposed again: a silent substitution of recorded reasoning for live reasoning is
  indistinguishable from fabricating the demo.
- **A small local model as the fallback.** Rejected for 9/10. It is genuinely live inference and so
  passes the test above — but it is a different system with different governance, and explaining
  that under pressure costs more than the beat is worth. Reconsider post-demo as a real
  sovereignty story rather than as a hedge.
