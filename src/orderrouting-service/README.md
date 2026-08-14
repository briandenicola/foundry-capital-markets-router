# orderrouting-service

Order route proposals against a simulated OMS, with best-execution policy boundaries.

Built by **T-026**. See `specs/001-router-core/spec.md` AC-7.

## Simulated, and labelled as such

The OMS is simulated. Every surface that shows an execution must render the simulated label. Do
not describe it any other way, in the UI, in a log line, or on stage.

## The rule this service exists to enforce

A proposal that breaches a policy boundary halts and **names the breached policy explicitly**.
"Blocked by policy" is not sufficient; the audience will ask which one, and the answer needs to be
already on screen.
