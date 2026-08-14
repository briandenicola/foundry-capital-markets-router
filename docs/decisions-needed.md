# Decisions needed

Forks where `docs/requirements.md` and the decisions locked during discovery disagree. These are
recorded rather than silently resolved, because each is a judgement call that belongs to the demo
owner.

Nothing here blocks the scaffold. Each has a working default so the repository stands up today.

| # | Fork | Status |
|---|---|---|
| 1 | Orchestration SDK | **Resolved** — Foundry hosted agents |
| 2 | Which wow moment leads | **Resolved** — scoreboard and surveillance stay primary |
| 3 | Routing signal breadth | Open |
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

## 3. Routing signals: expand beyond cost and complexity — OPEN

**The conflict.** Feature 001 routes on cost and task complexity, per discovery. `requirements.md`
additionally requires intent, confidence target, and **data classification**.

**Status:** partially resolved already. `PolicyGate` implements data classification and region
restriction, since a governance demo without data classification is not a governance demo. Intent
classification and confidence targets are specified in Feature 002 but not implemented.

**Needs your call** only on whether Feature 002 is in scope for 9/10.

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
