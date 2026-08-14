# Demo Runbook — 2026-09-10

## Before the day

| When | Action |
|---|---|
| 9/5 | Build freeze. Feature work stops. |
| 9/6 | Full timed rebuild from zero. Record the elapsed time. |
| 9/8 | Rehearse the full narrative end to end, twice. |
| 9/9 | Rehearse the fallback path. Rebuild the environment fresh. Seed data. |
| 9/10 morning | Smoke check every beat below. Do not change anything after this. |

## Pre-flight

```bash
task cloud:up            # must complete under 45 minutes
task app:deploy
task app:seed            # seed 20260910
task cloud:prove-private # confirm the denial demonstration works today
```

Confirm: two Entra identities are available, one holding Approver and one not. The segregation-of-
duties and unprivileged-denial beats both need them.

## Narrative

### Beat 1 — Frame the four objections (2 min)

State them in the audience's own language: it is not private enough, the spend is unbounded, we
cannot let it act alone, and we will be locked into whichever vendor we pick this year. Say that
each will be answered with a demonstration rather than a claim.

Then set the frame the rest of the hour hangs from: **models are temporary, governance is
strategic.** Every model named today will be superseded. The exchange is what survives that.

### Beat 2 — Private by construction (4 min)

Run `task cloud:prove-private`. Show the public access attempt failing. Then show the same
operation succeeding from inside the VNet.

Then show the CI policy job. The point is not that it is private today; it is that it cannot
silently stop being private.

*This beat answers the compliance veto. It is table stakes, not a wow moment. Do not linger.*

### Beat 3 — The model swap nobody deployed for (6 min) — PRIMARY

This is the beat the demo exists for. Do not rush it and do not narrate over the pause.

Submit a research request through the UI. Note out loud that **the application never named a
model** — it submitted a business request. Show the resulting execution plan: the request was
decomposed into tasks, and different tasks went to different vendors, because different vendors
are better at different things.

Now open the policy set and **disable Anthropic**. Change nothing else. No redeploy, no code
change, no prompt change.

Resubmit the identical request.

Stop talking. Let the room watch the plan rebuild itself around the remaining approved vendors,
and let them read the exclusion reason: *Vendor Anthropic is not approved under policy set
'CapitalMarkets-US'.*

Then say the only line this beat needs:

> The application did not change. The prompt did not change. Policy changed, and the architecture
> obeyed. That is the difference between using a model and governing one.

Follow it immediately with the harder version. Set the request's data classification to
**Restricted** and resubmit. Every hosted vendor is excluded by policy, and execution lands on the
open-weight model running on dedicated capacity inside the VNet — the only destination cleared for
that data.

*This beat answers the lock-in objection, and it answers it with a mechanism rather than a
roadmap. If the audience takes one thing away, it should be this.*

### Beat 4 — Router economics (6 min) — PRIMARY

Run a batch of comparable requests. Open the scoreboard.

Show per-request cost, latency, tier, and rationale. Drill into one decision and read the
rationale aloud — it names the deciding factor in plain language.

Then the comparison view: aggregate cost against a premium-tier baseline, with the delta as a
percentage.

Pre-empt the quality objection before it is raised: the quality number is deterministic and
recomputable, not model-graded. Say why that choice was made.

*This is the beat for the AI decision maker. It is the budget argument.*

### Beat 5 — Surveillance triage (6 min) — PRIMARY

Show the untriaged queue: 500 synthetic alerts. Run triage.

Show the ranked queue with rationale and assembled evidence. Open the top alert and walk the
evidence.

Propose escalation. It does not escalate — it enters the approval queue.

*This is the beat for trade leadership. It is the headcount and backlog argument.*

### Beat 6 — Human in the loop (5 min)

Open the approval queue and the evidence packet.

Attempt to approve as the proposing identity. It is refused with segregation of duties. Emphasise
that the API refused it, not the UI.

Approve as the second identity. Show the action executing and the audit record written.

Show an expired proposal. Timeout produced no action.

### Beat 7 — Attributed research (4 min) — SECONDARY

Ask a research question. Show inline citations and the coverage percentage.

Then show the unattributable-claims panel: the things it declined to say, and why.

*That panel is the point. A system that refuses is more trustworthy than one that never fails.*

### Beat 8 — Audit, unrehearsed (3 min)

Invite someone in the room to pick any interaction from the session. Query its `correlationId`.
Reconstruct the full chain live.

*Take the unrehearsed pick. A rehearsed one is worth nothing and the room can tell.*

### Beat 9 — Close (2 min)

Restate the three objections and what answered each. Name what was deliberately excluded: real
execution, real data, high availability, multi-region. Credibility comes from the exclusions as
much as from the demonstrations.

## Failure recovery

| Failure | Response |
|---|---|
| Scoreboard stale beyond five seconds | Switch the source to the Cosmos change feed by configuration. Rehearsed on 9/9. |
| A lane service is unhealthy | Skip its beat. Beats 3, 4, and 5 are independent. Never debug live. |
| Foundry throttling | Fall back to the seeded pre-recorded batch. Say plainly that it is pre-recorded. |
| Azure access fails entirely | Run the local fallback. Label it as the fallback. Do not present Beat 2 from it — the private-posture claim cannot be made from a local environment. |
| A question you cannot answer | Say so and write it down. This audience trusts an admission far more than a confident guess. |

## Do not

- Do not present the local fallback as evidence of the private posture.
- Do not describe the simulated OMS as anything other than simulated.
- Do not defend the quality metric by adding an LLM-as-judge number on the fly.
- Do not skip Beat 8's unrehearsed pick. It is the most persuasive three minutes in the deck.
