# Agent architecture

How the three lane agents are built, what tools they hold, and where their authority stops.

Governed by ADR 005 (hosted Foundry agents over prompt agents) and Principle V (every model call
goes through the router).

## The shape of an agent

Each lane is one hosted Foundry agent. The lane service is not the agent — it is the agent's
**custodian**: it owns the thread, supplies the tools, enforces the approval halt, and writes the
audit record. The agent reasons; the service is accountable.

```text
  lane service (C#, Container Apps)
      |
      |  1. creates thread, stamps correlationId
      |  2. submits the business request
      v
  hosted Foundry agent  --- tool call --->  MCP tool server (in the lane service)
      |                                          |
      |  3. model invocation                     |  4. tools reach data, never models
      v                                          v
  router-service  ---> APIM ---> model      Cosmos / AI Search / simulated OMS
```

Two boundaries are load-bearing and both are enforced by network policy, not convention:

1. **The agent's model access is the router's**, because the agent runs under the Foundry project
   identity and only the router holds the role assignment that permits a model deployment call.
2. **Tools reach data, never models.** No MCP tool wraps a model invocation. If a tool needs
   model output it calls the router like any other caller, and that call is routed and recorded.

## Why the router is not an agent

The exchange is deterministic code — policy evaluation, complexity scoring, tier selection. It is
the component a compliance audience will interrogate line by line, and it is the assembly under a
coverage gate. Making it an agent would mean explaining why the thing that enforces governance is
itself non-deterministic. It is a service, permanently.

## Agent inventory

| Agent | Lane | Decomposes work | Halts for approval | Wow moment |
|---|---|---|---|---|
| Research | research-service | Yes — retrieve, then synthesise per claim | No (read-only) | D (secondary) |
| Surveillance | surveillance-service | Yes — triage, then assemble evidence | Yes — escalation memo | C (primary) |
| Order routing | orderrouting-service | No — single proposal | Yes — every route | — |

### Research agent

**Job.** Answer an analyst question from the synthetic corpus with a citation on every claim.

**Tools.** `search_corpus`, `fetch_chunk`, `list_sources`. All read-only.

**The hard requirement is refusal.** Principle III means an unattributable claim is withheld and
reported, not softened. The agent must be able to return "I could not attribute this" as a
success, and the UI must show it as one. An agent that always answers has failed AC-3.

**Prompt-injection posture.** Retrieved chunks are data, never instructions. Chunks are wrapped in
a delimited envelope and the system prompt states that content inside it carries no tool authority.
Detections are logged as audit events (T-024). Assume the corpus contains an injection attempt,
because a demo corpus that has never been attacked proves nothing.

### Surveillance agent

**Job.** Rank a batch of at least 500 synthetic alerts, attach evidence and a rationale to each,
and draft an escalation memo for the top-ranked.

**Tools.** `fetch_alert_batch`, `fetch_communications`, `fetch_trade_context`, `submit_for_approval`.

**Reproducibility is the constraint that shapes this agent.** AC-6 requires identical ranking for a
fixed seed and input set. A free-running agent over 500 alerts will not deliver that. The agent
scores alerts against a fixed rubric with the temperature pinned, and the ordering is applied by
the service, not the model. **The model produces scores; deterministic code produces the ranking.**

**Batch shape.** 500 alerts do not fit one context window and should not try to. The service
chunks them, runs scoring concurrently with a bounded degree of parallelism, and each chunk is
independently routed — which is also what makes the cost scoreboard interesting.

**`submit_for_approval` is the only tool with side effects in the entire system.** It writes a
proposal, never a state change. No alert changes state without a human.

### Order routing agent

**Job.** Propose a venue for a synthetic order with a best-execution justification.

**Tools.** `fetch_order`, `fetch_venue_liquidity`, `evaluate_best_execution_policy`,
`submit_for_approval`.

**`evaluate_best_execution_policy` is deliberately not the agent's judgement.** Policy evaluation
is deterministic code the agent calls; the agent explains the result, it does not decide it. A
breach halts with the policy named. This is the same separation as the router: the model reasons,
code decides what is permitted.

Every surface that shows execution is labelled simulated (T-034). Not as a disclaimer in a corner
— on the record itself, so a screenshot taken out of context is still honest.

## Cross-cutting rules

**Correlation.** The lane service stamps `correlationId` before thread creation and passes it to
every tool call and every router call. AC-8 requires one-query reconstruction; a break anywhere in
that chain makes it a two-query reconstruction and fails.

**Thread lifecycle.** One thread per business request. Threads are not reused across requests —
carried-over context makes cost and reproducibility unexplainable, and both are demo claims.

**Failure modes** each need a defined, demonstrable behaviour:

| Failure | Behaviour |
|---|---|
| Tool error | Surface to the agent; agent may retry once, then reports partial results with the gap named |
| Model timeout | Router returns a routing failure; the lane reports it. **No silent retry on a different tier** — that would corrupt the cost figures |
| No eligible model (policy) | Explicit refusal naming the exclusions. Never a fallback to an unapproved model |
| Agent exceeds step budget | Halt, return partial work, log. An agent that loops on stage is worse than one that stops |

**Determinism for rehearsal.** Fixed seeds, pinned temperature, recorded fixtures. T-040's
no-Azure fallback replays recorded agent transcripts, so the narrative survives losing the network.

## Open questions

1. Foundry hosted agents cap tool count and step depth. The surveillance agent is closest to those
   limits — verify early (T-027a) rather than discovering it during T-025.
2. Whether Feature 002's intent classifier is an agent or a fixed cheap deployment. Current
   position: not an agent, because routing the thing that decides routing is circular.
