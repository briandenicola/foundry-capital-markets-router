# surveillance-service

Bulk triage of synthetic surveillance alerts: ranking, evidence assembly, and escalation memo
drafting.

Built by **T-025**. See `specs/001-router-core/spec.md` AC-6.

## Status

The **decision logic is built and tested**; the service host is not.

| Piece | State |
|---|---|
| Deterministic ranking from model scores | Built — `src/Fcmr.Surveillance.Domain`, 57 tests, 100% line covered |
| Evidence assembly and triage gap reporting | Built — unscored alerts are reported, never dropped |
| Escalation memo drafting and the approval gate | Built — no alert state changes without a recorded approval |
| Measured precision and recall against ground truth | Built — `TriageQuality` |
| Service host and HTTP surface | Built — `POST /v1/triage/rankings`, `POST /v1/escalations/drafts`, `POST /v1/escalations` |
| Live alert scoring (`POST /v1/triage/runs`) | Refuses with 501 — ADR-007 forbids standing anything in for the unbuilt agent |
| Hosted Foundry agent (T-027e) | Not built — scoring is the missing half |

## Reproducibility is a requirement, not a nicety

Ranking must be reproducible for a fixed seed and input set. The demo shows the same ranked queue
on stage that appeared in rehearsal, and the quality signal for this lane is rank agreement
against a seeded ground truth — which only exists because the data is synthetic and seeded.

The way that is achieved is the design of this assembly: **the model scores, deterministic code
ranks.** Asking a model to return an ordered list instead would make AC-6 untestable, because
nothing would pin the relative order of two alerts the model considers equally risky.

Two details do the actual work:

- **Scores are `decimal`, quantised to one decimal place.** Binary floating point would make tie
  detection depend on accumulated representation error, so two runs could order the same pair
  differently while both "agreeing" on the score.
- **Ties break on alert id, ordinal.** T-027e scores in chunks with bounded parallelism, so results
  arrive in whatever order they finish. Without a total order the queue would be a function of
  network timing. `TriageRankerTests` asserts a 500-alert batch ranks identically across five
  shuffles of both inputs; removing the tie-break makes that test fail, which is how we know it is
  testing something.

## Ground truth cannot reach the ranker

`AlertUnderTriage` deliberately omits `GroundTruthConcerning`, even though the fixture record
carries it. The fixture comment says the answer key "must never be fed to a model or to the
ranker" — a comment is not a control. Omitting the field means the ranker cannot read it however
the calling code is later rewritten, and `TriageQuality.Measure` has to join the answer key back in
by alert id as a separate, visible step.

A test asserts the absence of the field, so anyone who adds one is told why not.

## The rule this service exists to enforce

Escalation is **proposed**, never performed. A drafted memo enters the approval queue and no alert
changes state until a human holding a different identity approves it.

`AlertStateChange` is only produced by `EscalationGate.Apply`, which cannot be called without an
`EscalationAuthorization`. Drafting produces no state change of any kind. Refusals are ordered
alert identity, correlation, **expiry, then segregation of duties** — matching `SimulatedOms`,
and for the same reason: a lapsed approval is not a valid approval whose approver is then
scrutinised.

The approver also chooses the resulting state rather than merely assenting to escalation, so
approval is not a blank cheque. Dismissing an alert is as consequential as escalating it and is
gated identically.

### Drafting is refused without evidence

A memo below the risk threshold, without a rationale, or without evidence is refused rather than
drafted. This is a real control, not tidiness: a memo carrying a rank but nothing to read asks an
approver to endorse a number, and an approver who cannot check the work will eventually approve on
the score alone — which turns the human gate into a rubber stamp while every audit record still
looks correct.

Evidence is carried **verbatim**. A reviewer asked to sign an escalation must be able to read what
the model read, not an upstream paraphrase of it.

## What the measured numbers mean, and what they do not

`TriageQuality` reports precision and recall at a review depth, with the denominators in the
headline — "94% precision" over a depth of 16 is a different claim from the same number over 200,
and this audience will ask.

Deliberate choices, matching the research lane:

- Percentages **truncate**: 2 of 3 is 66.6%, never 66.7%.
- Reviewing nothing yields **null**, not 100%. A vacuous perfect score is the most reassuring
  number on the slide and it means nothing happened.
- A concerning alert that went **unscored counts against recall**. Failing to score an alert is a
  miss, and a metric that excused it would reward the failure with a better number.
- Answer-key ids outside the submitted batch are ignored, so a corpus-wide key cannot inflate the
  denominator with alerts triage was never shown.

None of this is evidence the approach generalises. It is a measurement over synthetic data with
planted ground truth: a statement about this corpus and nothing else.
