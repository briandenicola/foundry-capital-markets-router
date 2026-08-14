# SESSION-NOTES.md

## Current Phase

GENERATION — complete. Scaffold produced.

## Requirements Tracker

Mission: OK | Audience: OK | Realism: OK | Integrations/data: OK | Quality/security: OK | Stack: OK

Constitution decision rule: PASS. Bootstrap decision rule: PASS.

## Mission

Prove that a bank's capital markets division can run agentic AI on a private, policy-governed
Azure footprint where every model call is routed by cost and task complexity, every consequential
action passes a human approval gate, and every claim is attributable — demonstrated live across
research, trade surveillance, and order routing.

## Decisions Made

- Stakeholder: Solution Engineer, proxying business and technical.
- Audience: AI decision makers and trade leadership, bank capital markets division.
- Product shape: a routing core serving three lanes — research, surveillance, order routing.
- Wow moments: PRIMARY router economics scoreboard plus surveillance triage at scale;
  SECONDARY attributed research that refuses unattributable claims.
- Baseline requirements, not wow moments: human-in-the-loop; private-by-construction networking.
- Routing signals: cost and task complexity, both visible on screen.
- Data: synthetic only.
- Out of scope: real market data, real execution, fine-tuning, HA and DR, multi-region, real
  personal data, regulatory attestation.
- Quality gates, all accepted: lint and typecheck; 70% coverage on router decision logic; CodeQL
  and Dependabot; gitleaks with managed identity only; Checkov IaC scan; no-public-endpoint CI
  policy test.
- Stack: C# services, Vite UI, Terraform, Taskfile.dev, Azure Container Apps.
- Azure: AI Foundry, APIM AI gateway, Entra ID and RBAC, Key Vault, Cosmos DB, AI Search,
  Log Analytics and Application Insights.
- Agents: Foundry Tools and MCP; hosted agents preferred over prompt agents.
- Services: router-service, research-service, surveillance-service, orderrouting-service.
- Terraform: two stacks, infrastructure then apps, reconciled with
  briandenicola/banking-agent-foundry-orchestrator.
- Timeline: build wraps 2026-09-05; demo 2026-09-10.

## Assumptions Carried Into The Scaffold

1. Repo name foundry-capital-markets-router. Confirmed.
2. .NET 10 targeted rather than .NET 9, because .NET 10 SDK is what is installed locally.
3. Region eastus2 by default, overridable. Confirmed by the SE.
4. Model catalog is multi-vendor and includes open-weight models on Foundry managed compute
   (preview). Specific deployment names unconfirmed for eastus2. See ADR 006.
5. Scoreboard reads Application Insights first, with a Cosmos change-feed fallback built behind
   configuration. Validated by T-014.
6. Quality signal is deterministic rather than LLM-as-judge. Diverges from the sibling repo's
   house pattern; recorded as ADR 003.

## Open Questions

- Confirm the Azure region against model availability.
- Confirm the tier to deployment mapping.
- Confirm the terraform azurerm resource names for AI Foundry against the provider version in use.
- Decide whether Foundry model deployments are declared in Terraform or by
  scripts/deploy-hosted-agents.sh.

## Next Step

Run T-003 and T-004: get the CI quality gate green and bootstrap remote state. Then Phase 1,
front-loading T-010, the live public-access-denied demonstration. If that beat cannot be made
convincing, the compliance narrative fails and it must be discovered now.
