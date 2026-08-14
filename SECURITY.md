# Security Policy

## Scope and posture

This repository contains a **demonstration** system. It simulates a regulated capital markets
posture; it does not attest to one. Nothing here is certified for production handling of
market data, client data, or material non-public information.

Despite being a demo, the security controls are real and enforced in CI. A weakened control is
a defect, because the entire point of the demonstration is the credibility of those controls in
front of a compliance audience.

## Reporting a vulnerability

Open a private security advisory on this repository. Do not open a public issue.

Include the affected component, reproduction steps, and impact. Expect an acknowledgement
within two business days.

## Enforced controls

These are gated in CI on every pull request. A failure blocks merge.

| Control | Mechanism |
|---|---|
| No committed secrets | gitleaks over full history and diff; zero findings required |
| No public data-plane endpoints | Policy job fails on `public_network_access_enabled = true` in either Terraform stack |
| Code scanning | CodeQL for C# and JavaScript/TypeScript; no new high or critical alerts |
| Dependency hygiene | Dependabot for NuGet, npm, Terraform, GitHub Actions, Docker |
| IaC scanning | Checkov across both stacks; zero failed high-severity checks |
| Least privilege | No service identity may hold a subscription-scoped role assignment |

## Authentication and secrets

All service-to-service and service-to-Azure authentication uses **Entra ID managed identity**.

There are no connection strings, API keys, SAS tokens, or shared secrets in source, in
configuration, in container images, or in Terraform outputs. Key Vault holds only material that
genuinely cannot be managed-identity-authenticated.

If you find yourself needing a secret, that is a design signal. Raise it as an ADR before
introducing one.

## Data handling

Synthetic data only. Committing real market data, real counterparty data, personal data, or any
production extract — anonymised or otherwise — is a policy violation regardless of apparent
sensitivity.

## Prompt injection

Retrieved content is treated as untrusted input, never as instruction. Retrieved content is
never granted tool-call authority. Detected injection attempts are logged to the audit trail.

The human approval gate is the final backstop: even a fully successful injection cannot cause a
consequential action to execute, because no consequential action executes without a human
decision recorded against a distinct identity.
