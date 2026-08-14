# surveillance-service

Bulk triage of synthetic surveillance alerts: ranking, evidence assembly, and escalation memo
drafting.

Built by **T-025**. See `specs/001-router-core/spec.md` AC-6.

## Reproducibility is a requirement, not a nicety

Ranking must be reproducible for a fixed seed and input set. The demo shows the same ranked queue
on stage that appeared in rehearsal, and the quality signal for this lane is rank agreement
against a seeded ground truth — which only exists because the data is synthetic and seeded.

## The rule this service exists to enforce

Escalation is **proposed**, never performed. A drafted memo enters the approval queue and no alert
changes state until a human holding a different identity approves it.
