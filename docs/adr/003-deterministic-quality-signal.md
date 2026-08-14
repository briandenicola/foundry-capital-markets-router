# 003. Use deterministic quality signals rather than LLM-as-judge for the on-screen metric

- **Status**: Accepted
- **Date**: 2026-08-14

## Context

The primary wow moment is a live scoreboard showing that cheaper model tiers deliver comparable
quality at a fraction of the cost. The argument only works if the quality number is credible.

The audience includes a compliance and risk stakeholder with veto power. That stakeholder's
professional instinct is to attack the measurement before the conclusion.

The house pattern in a sibling reference repository uses LLM-as-judge evaluation, and there is a
recorded ADR supporting it there.

## Decision

The primary on-screen quality number is deterministic and recomputable, per lane:

- Research: attribution coverage, the proportion of emitted claims with a resolving citation.
- Surveillance: rank agreement against a seeded synthetic ground truth.
- Order routing: conformance to encoded best-execution rules.

LLM-as-judge may appear only as a clearly labelled secondary metric, never as the headline number.

## Consequences

### What this buys us

- The number survives the obvious challenge. "You used a model to grade a model" has no purchase
  on a coverage percentage the audience can recount by hand.
- Because the synthetic data is seeded, ground truth genuinely exists for the surveillance lane,
  which is rarely true in a real deployment and is a legitimate advantage of a demo.
- The metric is stable across runs, so rehearsal numbers match demo numbers.

### What this costs us

- Deterministic signals measure narrower things than a judge does. Attribution coverage says
  nothing about whether a synthesis is useful, only whether it is grounded.
- We diverge from the house pattern, so evaluation code is not shared with the sibling repository.
- Encoding best-execution rules well enough to be a meaningful conformance signal is real work,
  not a library call.

### What we will have to revisit

If the demo evolves toward measuring answer usefulness rather than groundedness, a judge becomes
necessary. Introduce it as a labelled secondary metric first and let it earn trust before it
carries any argument.

## Alternatives considered

| Alternative | Why not |
|---|---|
| LLM-as-judge as the headline number | Invites the self-graded-homework objection in front of the one stakeholder who can veto adoption |
| Human evaluation | No time before 9/5, and not reproducible live |
| No quality signal, cost only | Cost savings without a quality claim is not persuasive; the obvious rebuttal is that the cheap tier is simply worse |

## Constitution impact

Reinforces Principle III by making attribution coverage a first-class, displayed measurement
rather than an internal log line.
