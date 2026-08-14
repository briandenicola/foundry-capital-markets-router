# Decisions needed

Open forks where `docs/requirements.md` and the decisions locked during discovery disagree. These
are recorded rather than silently resolved, because each one is a judgement call that belongs to
the demo owner.

Nothing here blocks the scaffold. Each has a working default so the repository stands up today.

---

## 1. Orchestration: M365 Agents SDK or Foundry hosted agents

**The conflict.** `requirements.md` specifies the M365 Agents SDK. Discovery locked Foundry hosted
agents with MCP tools, recorded in ADR 005.

**Why it matters.** This is the genuine architectural fork in the repository, not a preference.
The two produce different deployment topologies, different identity models, and different demo
surfaces. Retrofitting later is not a refactor; it is a rewrite of the orchestration layer.

| | Foundry hosted agents + MCP (current) | M365 Agents SDK |
|---|---|---|
| Surface | Custom Vite UI | Teams / M365 |
| Fits "locked-down Azure" posture | Directly | Requires M365 tenant reach |
| Tool model | MCP | SDK-native |
| Matches requirements.md | No | Yes |

**Current default:** Foundry hosted agents, per your explicit instruction during discovery.

**Recommendation:** keep Foundry hosted agents. The stated environment requirement is a locked-down
Azure network simulating a regulated client; an M365-surfaced agent pulls the demo out of that
boundary and weakens the very posture the audience came to see.

**Needs your call.**

---

## 2. Which wow moment leads

**The conflict.** Discovery selected the cost-and-quality scoreboard as the primary wow. Reading
`requirements.md`, its Scene 9 — disable a vendor by policy, rerun the identical request, watch
execution replan to a different vendor with the application and prompt unchanged — is arguably
stronger for this audience.

**Why it matters.** The scoreboard proves optimisation. The policy swap proves **control**. A
compliance and trade-leadership audience has seen cost charts before. Very few have seen a vendor
removed live without an application change.

The scoreboard also carries a risk the policy swap does not: it invites the audience to argue
about your numbers. The policy swap invites no arithmetic.

**Recommendation:** lead with the policy swap, land the scoreboard second as supporting evidence.
Both are already in the runbook; this is an ordering decision, cheap to change.

**Needs your call.**

---

## 3. Routing signals: expand beyond cost and complexity

**The conflict.** Feature 001 routes on cost and task complexity, per discovery. `requirements.md`
additionally requires intent, confidence target, and **data classification**.

**Status:** partially resolved already. `PolicyGate` implements data classification and region
restriction, since a governance demo without data classification is not a governance demo. Intent
classification and confidence targets are specified in Feature 002 but not implemented.

**Needs your call** only on whether Feature 002 is in scope for 9/10.

---

## 4. Scope: three lanes or research only

**The conflict.** Discovery required three lanes — research, surveillance, order routing.
`requirements.md` scripts only the Capital Markets Research Assistant.

**Current resolution:** research is the fully-built showcase lane; surveillance and order routing
are real services that exercise the same router, present to prove the exchange is general rather
than a single-purpose demo. They receive proportionally less narrative time.

**Recommendation:** keep this. Three lanes is what makes it an *exchange*; one lane is an
application. But do not give surveillance and order routing equal stage time — show them briefly
as proof of generality.

**Needs confirmation, not a decision,** unless you disagree.
