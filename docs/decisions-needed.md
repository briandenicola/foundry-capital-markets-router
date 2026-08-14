# Decisions needed

Forks where `docs/requirements.md` and the decisions locked during discovery disagree. These are
recorded rather than silently resolved, because each is a judgement call that belongs to the demo
owner.

Nothing here blocks the scaffold. Each has a working default so the repository stands up today.

| # | Fork | Status |
|---|---|---|
| 1 | Orchestration SDK | **Resolved** — Foundry hosted agents |
| 2 | Which wow moment leads | **Resolved** — scoreboard and surveillance stay primary |
| 3 | Routing signal breadth | **Resolved** — Feature 002 Slice A in build, Slice B deferred |
| 4 | Three lanes or research only | Open |

---

## 1. Orchestration: M365 Agents SDK or Foundry hosted agents — RESOLVED

**Resolution: Foundry hosted agents + MCP.** Confirmed by the demo owner. `requirements.md`
specifies the M365 Agents SDK; we are deliberately diverging from it.

**Rationale.** The stated environment requirement is a locked-down Azure network simulating a
regulated client. An M365-surfaced agent pulls the demo out of that boundary and weakens the very
posture the audience came to see. Recorded in ADR 005.

**Consequence.** The Vite scoreboard UI is the only presentation surface. There is no Teams
integration and none is planned. If a future audience asks for Teams, treat it as a new feature
with its own ADR, not as a configuration change — the identity and network models differ.

---

## 2. Which wow moment leads — RESOLVED

**Resolution: the router economics scoreboard and surveillance triage remain the primary beats.**
Confirmed by the demo owner. `requirements.md` Scene 9 is explicitly set aside for now.

The policy-driven model swap is retained as **Beat 5, SUPPORTING**, positioned after both primary
beats. It is not cut, for two reasons: the capability is real and already implemented in
`PolicyGate`, and it is the only beat that answers the vendor lock-in objection. It simply is not
the headline.

**Consequence for the runbook.** Beat 5 is the designated compression point if the demo runs long.
Compress it; do not cut it. Cutting it leaves the four-objection framing in Beat 1 with a promise
the demo never keeps.

---

## 3. Routing signals: expand beyond cost and complexity — RESOLVED

**Resolution: Feature 002 Slice A is in the 9/10 build; Slice B is deferred.**

Data classification and region restriction are already implemented in `PolicyGate` and are being
wired into the routing path (T-208…T-212). Intent classification and task decomposition move to a
Phase 2 backlog (T-251…T-255).

**Rationale.** Feature 001 already consumes the 22 days to 9/5. Slice A delivers everything Beat 5
needs — a policy change that visibly reroutes an unchanged request — and none of that claim depends
on decomposition. A single-task request routed under policy proves governance just as well as a
five-task plan, in less stage time.

Slice B is specified rather than dropped, so the "what's next" conversation has substance behind it.

---

## 4. Scope: three lanes or research only — OPEN

**The conflict.** Discovery required three lanes — research, surveillance, order routing.
`requirements.md` scripts only the Capital Markets Research Assistant.

**Current resolution:** research is the fully-built showcase lane; surveillance and order routing
are real services that exercise the same router, present to prove the exchange is general rather
than a single-purpose demo. They receive proportionally less narrative time.

**Recommendation:** keep this. Three lanes is what makes it an *exchange*; one lane is an
application. But do not give surveillance and order routing equal stage time — show them briefly
as proof of generality.

**Needs confirmation, not a decision,** unless you disagree.

---

## 5. APIM is in the docs and the constitution but not in the Terraform — OPEN

**The conflict.** `docs/architecture.md` places an "APIM AI Gateway" in the component diagram and
at step 4 of the data flow, and the constitution states that *all model traffic transits APIM as AI
gateway for token metering, cost ceilings and content-safety enforcement*. There is no
`azurerm_api_management` resource in either stack, no APIM subnet, and no private DNS zone for it.
It is not forgotten — **T-008** schedules it in Phase 1 — but it is unbuilt, and Phase 1 is the
part of the plan already competing with the managed-compute and hosted-agent spikes.

This was found while generating the architecture diagrams: the diagram could not be drawn from the
Terraform and match the prose. The diagrams follow the Terraform and mark APIM as
**NOT IN TERRAFORM** in red.

**Why it matters.** Realism Checklist item 5 promises a cost ceiling enforced in two independent
places — policy and gateway. Today it is enforced in one, in application code, by the same team
that benefits from the number being low. To a compliance audience that is the difference between a
control and an intention.

**The options.**

- **A. Build it.** APIM Developer or Basic v2 in an internal VNet, all Foundry traffic through it.
  Real, but it is a week of work plus a private DNS zone and an ~8-hour first deploy for the classic
  SKU. It buys a control the story already claims.
- **B. Drop the claim.** Amend the constitution and `docs/architecture.md` to state that cost
  ceilings are enforced in the router and audited in Cosmos, and that gateway-level metering is
  Phase 2. Honest, cheap, and weakens Beat 9 slightly.
- **C. Stub it.** Leave the prose, show a slide. **Not acceptable** — the demo's premise is a real
  lockdown environment, and the first architect who asks to see the APIM instance ends the credibility
  of everything else on the screen.

**Recommendation: B for 9/10, A as the stated next increment.** The demo's claim is that governance
decides the vendor, which `PolicyGate` fully delivers without APIM. Claiming a second enforcement
point that does not exist risks the one claim that does.

**Owner: Brian. Needed by 8/22** — after that, option A no longer fits before the freeze.

---

## 6. Hosted agents do not traverse the router — OPEN

**The conflict.** The demo's headline is *every model call passes through one governed chokepoint*.
Lane services hold no Foundry role; `apps/roles.tf` grants "Azure AI Developer" on the project to
`router-service` alone, which is what makes the chokepoint real for lane-service→model calls.

But we chose **Foundry hosted agents**. A hosted agent executes under the *Foundry project
identity* and invokes its own model deployment inside Foundry. That call does not pass through
`router-service`, is not evaluated by `PolicyGate`, and does not appear on the cost scoreboard.

**Why it matters.** It is the sharpest question a technical reviewer can ask in Beat 4, and the
scoreboard in Beat 9 may be showing a sample while presenting as a total. Being asked this on stage
and not having an answer costs more than the gap itself.

**The options.**

- **A. Constrain the agents.** Hosted agents perform tool use and orchestration only; every model
  inference is a tool call back into `router-service`. Preserves the claim exactly. Costs latency
  and some of the reason for using hosted agents at all.
- **B. Narrow the claim.** "Every *application* model call is governed; agent-internal reasoning is
  metered by Foundry and reconciled in the scoreboard." Truthful, and needs the scoreboard to show
  two sources rather than one.
- **C. Reconcile after the fact.** Pull Foundry's own token telemetry into the scoreboard so the
  total is correct even though the enforcement point is not universal. Governance-by-detection
  rather than governance-by-prevention — a real distinction to this audience.

**Recommendation: A for the research lane, B stated plainly for the rest.** The research lane is
the showcase and is worth the latency. Say the boundary out loud in Beat 4 rather than being
caught at it — naming your own limitation is what makes the rest of the claims believable.

**Blocked on T-027a** (the Foundry hosted-agent spike), which is the first thing that needs Azure.

---

## 7. Smaller divergences found while diagramming — FYI

Recorded here so they are decided rather than discovered:

1. **`privatelink.openai.azure.com` is declared but has no private endpoint.** `locals.tf` creates
   six DNS zones; `private-endpoints.tf` creates five endpoints. Either dead config or an
   unfinished intent — resolve before an auditor asks.
2. **Log Analytics and App Insights have no private endpoint.** There is no AMPLS. Principle II
   says all Azure data-plane traffic traverses private endpoints; telemetry ingestion does not.
   Decide whether telemetry counts as a data plane, and make `policy-no-public-endpoints.sh` take
   that position explicitly.
3. **Serverless model deployments are never actually created.** `local.serverless_models` is only
   an output; there is no `Microsoft.CognitiveServices/accounts/deployments` resource. The catalog
   and the demo both assume these exist. **This will fail on first deploy.**
4. **Region restriction is all-or-nothing.** `PolicyGate.Evaluate` compares one `executionRegion`
   against `AllowedRegions` and, on mismatch, excludes the entire catalog with an identical reason
   — including the open-weight model running inside our own VNet, which is the one candidate a
   region rule should never exclude.
5. **`Downgraded` has no policy equivalent.** If policy removes the indicated tier's candidates,
   `TierSelector` reports `Routed` at a lower tier because it never saw the removed ones. Beat 5's
   restricted-data path therefore renders as a plain `Routed` unless the UI gives `policyExclusions`
   equal prominence to `candidateTiers` (T-216).
6. **The audit store is not technically append-only.** `auditEvents` is an ordinary Cosmos SQL
   container; immutability is a property of the writing code, not the store. For an audience whose
   entire objection is auditability, either close this with a deny-write role split or state it in
   Beat 9's exclusions.
