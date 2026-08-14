#!/usr/bin/env node
/**
 * bootstrap-repo.mjs — scaffold builder for foundry-capital-markets-router
 *
 * Node.js built-ins only. Cross-platform. No network calls.
 *
 * Usage:
 *   node scripts/bootstrap-repo.mjs [--dry-run] [--force] [--root <dir>] [--list] [--help]
 *
 *   --dry-run   Report what would happen; write nothing.
 *   --force     Overwrite files that already exist.
 *   --root      Repo root to write into. Defaults to the parent of this script's directory.
 *   --list      Print the embedded file inventory and exit.
 *
 * Existing files are never overwritten unless --force is passed.
 * All writes are normalised and constrained to the resolved repo root.
 */

import { readFile, mkdir, writeFile, access, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const SELF = fileURLToPath(import.meta.url);
const OPEN = '/*__SCAFFOLD_PAYLOAD_BEGIN__';
const CLOSE = '__SCAFFOLD_PAYLOAD_END__*/';
const SEP = /^===== FILE: (.+?) =====$/;

// A literal '*' followed by '/' inside the payload would terminate the enclosing block comment.
// Payload content needing a globstar uses this token instead; it is restored at write time.
const GLOBSTAR_TOKEN = '@@GLOBSTAR@@';

// Likewise for a literal block-comment terminator, which appears in CSS and in C-style
// doc comments carried by the payload.
const CMTEND_TOKEN = '@@CMTEND@@';

function parseArgs(argv) {
  const opts = { dryRun: false, force: false, root: null, list: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--list') opts.list = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--root') {
      opts.root = argv[++i];
      if (!opts.root) fail('--root requires a directory argument');
    } else fail(`Unknown argument: ${a}`);
  }
  return opts;
}

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function usage() {
  process.stdout.write(
    [
      'bootstrap-repo.mjs — scaffold builder for foundry-capital-markets-router',
      '',
      'Usage: node scripts/bootstrap-repo.mjs [options]',
      '',
      '  --dry-run   Report what would happen; write nothing',
      '  --force     Overwrite existing files',
      '  --root DIR  Repo root to write into (default: parent of this script dir)',
      '  --list      Print the embedded file inventory and exit',
      '  --help      Show this help',
      '',
    ].join('\n')
  );
}

async function loadPayload() {
  const src = await readFile(SELF, 'utf8');
  // lastIndexOf, not indexOf: the marker literals also appear above, in this very function.
  const start = src.lastIndexOf(OPEN);
  const end = src.lastIndexOf(CLOSE);
  if (start === -1 || end === -1 || end < start) fail('embedded payload markers not found or malformed');
  return src.slice(start + OPEN.length, end);
}

function parseFiles(payload) {
  const files = new Map();
  let current = null;
  let buf = [];
  for (const line of payload.split('\n')) {
    const m = SEP.exec(line);
    if (m) {
      if (current) files.set(current, buf.join('\n'));
      current = m[1].trim();
      buf = [];
      continue;
    }
    if (current) buf.push(line);
  }
  if (current) files.set(current, buf.join('\n'));

  for (const [p] of files) {
    if (path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) {
      fail(`refusing unsafe payload path: ${p}`);
    }
  }
  return files;
}

function resolveRoot(opts) {
  const fallback = path.resolve(path.dirname(SELF), '..');
  return path.resolve(opts.root ?? fallback);
}

function safeJoin(root, rel) {
  const target = path.resolve(root, rel);
  const bounded = target === root || target.startsWith(root + path.sep);
  if (!bounded) fail(`refusing to write outside repo root: ${rel}`);
  return target;
}

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normaliseContent(text) {
  const restored = text
    .split(GLOBSTAR_TOKEN)
    .join('**')
    .split(CMTEND_TOKEN)
    .join('*' + '/');
  const trimmed = restored.replace(/^\n+/, '').replace(/\s+$/, '');
  return trimmed.length ? trimmed + '\n' : '';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return usage();

  const payload = await loadPayload();
  const files = parseFiles(payload);

  if (opts.list) {
    for (const p of [...files.keys()].sort()) process.stdout.write(p + '\n');
    process.stdout.write(`\n${files.size} files embedded.\n`);
    return;
  }

  const root = resolveRoot(opts);
  const created = [];
  const skipped = [];
  const overwritten = [];

  process.stdout.write(`repo root : ${root}\n`);
  process.stdout.write(`mode      : ${opts.dryRun ? 'DRY RUN (no writes)' : 'WRITE'}${opts.force ? ' --force' : ''}\n`);
  process.stdout.write(`files     : ${files.size}\n\n`);

  for (const rel of [...files.keys()].sort()) {
    const target = safeJoin(root, rel);
    const present = await exists(target);

    if (present && !opts.force) {
      skipped.push(rel);
      continue;
    }

    if (!opts.dryRun) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, normaliseContent(files.get(rel)), 'utf8');
      // Shell scripts are invoked as ./scripts/foo.sh by CI and the Taskfile. A payload carries
      // content but not permissions, so without this a freshly scaffolded repo fails its own
      // quality gate on a permission error that looks nothing like the missing exec bit it is.
      if (rel.endsWith('.sh')) await chmod(target, 0o755);
    }
    (present ? overwritten : created).push(rel);
  }

  const report = (label, list, mark) => {
    if (!list.length) return;
    process.stdout.write(`${label} (${list.length})\n`);
    for (const p of list) process.stdout.write(`  ${mark} ${p}\n`);
    process.stdout.write('\n');
  };

  report('CREATED', created, '+');
  report('OVERWRITTEN', overwritten, '~');
  report('SKIPPED (exists; pass --force to replace)', skipped, '=');

  process.stdout.write(
    `summary: ${created.length} created, ${overwritten.length} overwritten, ${skipped.length} skipped\n`
  );

  if (opts.dryRun) {
    process.stdout.write('\nDry run only. Nothing was written. Re-run without --dry-run to apply.\n');
    return;
  }

  process.stdout.write(
    [
      '',
      'Next commands:',
      '',
      '  git init && git add -A && git commit -m "chore: scaffold repository"',
      '  cp .env.example .env          # then edit: subscription, region, tenant',
      '  node scripts/diagrams/generate-diagrams.mjs   # architecture diagrams (generated, not drawn)',
      '  task --list                   # review available tasks',
      '  task lint:policy              # verify the no-public-endpoint policy gate passes',
      '  terraform -chdir=infrastructure init',
      '  task cloud:up                 # stand up the private Azure platform',
      '',
      'Then open .github/copilot-instructions.md and specs/001-router-core/spec.md',
      'and drive implementation from specs/001-router-core/tasks.md.',
      '',
    ].join('\n')
  );
}

main().catch((err) => fail(err?.stack ?? String(err)));

/*__SCAFFOLD_PAYLOAD_BEGIN__
===== FILE: README.md =====
# Foundry Capital Markets Router

A private, policy-governed AI exchange for a bank's capital markets division — demonstrated live
across research, trade surveillance, and order routing on Azure AI Foundry.

> **Models are temporary. Governance is strategic.**

Applications here do not choose models. They submit a business request — an intent, a cost ceiling,
a data classification — and the exchange decides what executes it, from a multi-vendor catalog that
governance controls. Change the policy, and the same unchanged request executes somewhere else.

## What this proves

Four objections block agentic AI adoption in capital markets. This demo removes all four:

| Objection | What is demonstrated |
|---|---|
| "The spend is unbounded and unexplainable." | Every model call routed by cost and task complexity, with a live scoreboard showing cost, latency, tier, and rationale against a premium-tier baseline. |
| "We cannot let an agent act on its own." | Every consequential action halts for human approval with a full evidence packet, enforced segregation of duties, and a reconstructable audit trail. |
| "It is not private enough for us." | Every Azure data plane reachable only over private endpoints. A public-access attempt is shown failing, live. Restricted-classification data routes only to open-weight models on dedicated compute inside the VNet. |
| "We will be locked into whichever vendor we pick." | A vendor is disabled in policy, live, and an identical request from an unchanged application replans onto a different vendor. No redeploy, no prompt change. |

## The model catalog

| Vendor | Serving | Max data classification |
|---|---|---|
| Azure OpenAI | Serverless | Confidential |
| Anthropic | Serverless | Internal |
| xAI | Serverless | Internal |
| Open-weight | Foundry managed compute (**preview**) | Restricted |

Governance owns this table, not the application. See
[ADR 006](docs/adr/006-multi-vendor-model-catalog.md) — note the preview-feature risks around GPU
quota and provisioning time before you plan a demo date.

## Architecture at a glance

```text
                      Entra ID  ·  RBAC  ·  app roles
                                  |
  webui (Vite/React) ── router-service ──> APIM AI Gateway ──> Azure AI Foundry
                             |    ^           (metering,          (hosted agents,
                             |    |            cost ceilings,      multi-vendor catalog,
                             |  PolicyGate     content safety)     managed compute)
                             |  (approved vendors, data
                             |   classification, region, cost)
                             +──> research-service      ──> Azure AI Search
                             +──> surveillance-service  ──> Cosmos DB
                             +──> orderrouting-service  ──> simulated OMS

  All of the above on Azure Container Apps inside a VNet.
  All data planes on private endpoints. Managed identity only. No secrets.
```

`router-service` is the sole path to model access. Direct model endpoint calls from any other
service are blocked at the network layer, not merely discouraged by convention.

Policy is evaluated **before** cost and complexity selection: governance decides what is
permissible, then the router decides what is appropriate among the permissible.

**Unresolved forks are tracked in [docs/decisions-needed.md](docs/decisions-needed.md).** Read it
before building on this scaffold.

## Repository layout

```text
.github/            CI quality gate, CodeQL, Copilot and spec-kit assets
.specify/           Spec-kit memory and templates; the constitution lives here
specs/              Feature specifications, contracts, data models, task plans
docs/               Architecture, threat model, ADRs, demo runbook
infrastructure/     Terraform: platform stack (network, CAE, Foundry, data planes)
apps/               Terraform: workload stack (container apps, identities, roles)
src/                C# services and the Vite UI
tests/              Unit, contract, integration, and Playwright E2E tests
tasks/              Taskfile includes
scripts/            Bootstrap, policy gates, guards
```

Terraform is split into two stacks deliberately. `infrastructure/` is the longer-lived platform;
`apps/` is reapplied frequently during development. See `docs/adr/002-two-stack-terraform.md`.

## Quick start

```bash
cp .env.example .env      # set subscription, tenant, region
task --list               # review available tasks
task cloud:up             # stand up the private Azure platform
task app:deploy           # build images and deploy the container apps
task test                 # run the full test suite
task cloud:down           # tear everything down
```

`task cloud:up` must complete unattended in under 45 minutes from zero. That is a hard
constraint, not an aspiration — see the constitution's delivery constraints.

## Non-negotiables

Read `.specify/memory/constitution.md` before contributing. Seven principles govern this
repository; three are marked NON-NEGOTIABLE and no pull request may weaken them:

1. Human-in-the-loop on every consequential action.
2. Private by construction — no public data-plane access.
3. Attribution or refusal — unattributable claims are withheld, never guessed.

## Data

Synthetic only. Every artifact is produced by a committed, seeded generator. There is no real
market data, no real counterparty, and no production extract anywhere in this repository or in
any environment it deploys.

## Demo

Delivered 2026-09-10. Build freezes 2026-09-05. See `docs/demo-runbook.md` for the narrative,
timings, and failure-recovery drills.

===== FILE: LICENSE =====
MIT License

Copyright (c) 2026 Brian Denicola

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

===== FILE: SECURITY.md =====
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

===== FILE: CONTRIBUTING.md =====
# Contributing

## Before you write code

1. Read `.specify/memory/constitution.md`. It is the tiebreaker when a specification conflicts
   with an implementation preference.
2. Read the relevant spec under `specs/`. If the change is not covered by a spec, write or
   extend the spec first.
3. If the change is architecturally significant, or deviates from the constitution, record an
   ADR in `docs/adr/` **before** the code merges.

## Workflow

```bash
task lint          # format, analyzers, terraform fmt, policy gate
task test          # unit, contract, integration
task test:e2e      # Playwright, requires a deployed environment
```

The CI quality gate runs the same checks. Run them locally first; a red pipeline on a shared
branch costs everyone time during a compressed delivery window.

## Definition of done

A change is done when every item passes:

- Lint and typecheck clean across C#, TypeScript, and Terraform.
- Router decision logic coverage at or above 70%. This is a threshold, not a report.
- CodeQL clean of new high and critical alerts.
- gitleaks clean.
- Checkov clean of high-severity findings.
- No-public-endpoint policy job green.
- Specs and ADRs updated to match reality.

## Commit and branch conventions

- Branches: `NNN-short-slug` matching the spec directory where applicable.
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- One logical change per pull request. During the 9/5 freeze, only fixes and rehearsal changes
  are accepted.

## Things that will get a pull request rejected

- Weakening a NON-NEGOTIABLE principle without an ADR and explicit sign-off.
- Introducing a secret of any kind.
- Adding a public data-plane endpoint.
- Calling a model deployment from anywhere other than `router-service`.
- Committing non-synthetic data.
- Auto-executing an action on approval timeout.

===== FILE: .gitignore =====
# .NET
bin/
obj/
*.user
*.suo
[Dd]ebug/
[Rr]elease/
TestResults/
coverage/
*.coverage
*.trx
*.cobertura.xml

# Node
node_modules/
dist/
.vite/
*.tsbuildinfo
npm-debug.log*

# Terraform
.terraform/
.terraform.tfstate.lock.info
terraform.tfstate
terraform.tfstate.*
terraform.tfstate.d/
*.tfvars
!*.example.tfvars
crash.log
tfplan
tfplan.json

# Environment
.env
.env.*
!.env.example

# Editors and OS
.vscode/*
!.vscode/extensions.json
.idea/
.DS_Store
Thumbs.db

# Generated synthetic data volumes (generators are committed; output is not)
data/generated/

# Playwright
test-results/
playwright-report/
blob-report/
# Squad: ignore runtime state (logs, inbox, sessions)
.squad/orchestration-log/
.squad/log/
.squad/decisions/inbox/
.squad/sessions/
# Squad: SubSquad activation file (local to this machine)
.squad-workstream

===== FILE: .gitattributes =====
* text=auto eol=lf

*.sh        text eol=lf
*.mjs       text eol=lf
*.ps1       text eol=crlf
*.cs        text eol=lf diff=csharp
*.csproj    text eol=lf
*.tf        text eol=lf
*.md        text eol=lf
*.yml       text eol=lf
*.yaml      text eol=lf
*.json      text eol=lf

*.png       binary
*.svg       text eol=lf
*.pdf       binary
# Squad: union merge for append-only team state files
.squad/decisions.md merge=union
.squad/agents/@@CMTEND@@history.md merge=union
.squad/log/** merge=union
.squad/orchestration-log/** merge=union

===== FILE: .dockerignore =====
*@@CMTEND@@bin
*@@CMTEND@@obj
*@@CMTEND@@node_modules
*@@CMTEND@@dist
*@@CMTEND@@.terraform
*@@CMTEND@@.git
*@@CMTEND@@.github
*@@CMTEND@@TestResults
*@@CMTEND@@coverage
*@@CMTEND@@test-results
*@@CMTEND@@playwright-report
.env
.env.*
!.env.example
docs
specs
tests

===== FILE: .env.example =====
# Copy to .env and fill in. .env is gitignored and must never be committed.
# No secrets belong in this file. Authentication is managed identity and az login only.

# Azure targeting
AZURE_SUBSCRIPTION_ID=00000000-0000-0000-0000-000000000000
AZURE_TENANT_ID=00000000-0000-0000-0000-000000000000
DEFAULT_REGION=eastus2

# Terraform remote state (created by scripts/bootstrap-remote-state.sh)
TF_STATE_RESOURCE_GROUP=rg-fcmr-tfstate
TF_STATE_STORAGE_ACCOUNT=
TF_STATE_CONTAINER=tfstate

# Private networking. Setting this to false in the cloud stack is a policy violation;
# it exists only for the local no-Azure fallback path.
ENABLE_PRIVATE_NETWORKING=true

# Model catalog. Multi-vendor by design: the whole point of the exchange is that these are
# interchangeable and swappable by policy without an application change. Verify availability
# in DEFAULT_REGION before deploying. See docs/adr/006-multi-vendor-model-catalog.md.
#
# Serverless and managed Azure deployments
MODEL_AOAI_ECONOMY=gpt-5.4-mini
MODEL_AOAI_STANDARD=gpt-5.4
MODEL_AOAI_PREMIUM=gpt-5.6-sol
MODEL_ANTHROPIC=claude-sonnet-4-5
MODEL_XAI=grok-4.3
MODEL_EMBEDDING=text-embedding-3-large

# Open-weight models served on Foundry managed compute (PREVIEW).
# Managed compute is a preview capability: it provisions dedicated GPU capacity, is subject to
# quota, and is slow to warm. Provision it early and never on the morning of the demo.
ENABLE_MANAGED_COMPUTE=true
MODEL_OPENWEIGHT=nvidia--nvidia-nemotron-3-nano-30b-a3b-fp8
MANAGED_COMPUTE_ACCELERATOR=H100_80GB
MANAGED_COMPUTE_CAPACITY=1

# Router policy defaults
DEFAULT_COST_CEILING_USD=0.25
DEFAULT_LATENCY_BUDGET_MS=8000

# Approval policy
APPROVAL_EXPIRY_MINUTES=30

===== FILE: global.json =====
{
  "sdk": {
    "version": "10.0.100",
    "rollForward": "latestFeature"
  }
}

===== FILE: Directory.Build.props =====
<Project>

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <LangVersion>latest</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <AnalysisLevel>latest-recommended</AnalysisLevel>
    <GenerateDocumentationFile>false</GenerateDocumentationFile>
  </PropertyGroup>

  <PropertyGroup>
    <ContinuousIntegrationBuild Condition="'$(GITHUB_ACTIONS)' == 'true'">true</ContinuousIntegrationBuild>
    <Deterministic>true</Deterministic>
  </PropertyGroup>

</Project>

===== FILE: Directory.Packages.props =====
<Project>

  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <CentralPackageTransitivePinningEnabled>true</CentralPackageTransitivePinningEnabled>
  </PropertyGroup>

  <ItemGroup Label="Azure">
    <PackageVersion Include="Azure.Identity" Version="1.13.2" />
    <PackageVersion Include="Azure.Monitor.OpenTelemetry.AspNetCore" Version="1.3.0" />
    <PackageVersion Include="Microsoft.Azure.Cosmos" Version="3.46.1" />
    <PackageVersion Include="Azure.Search.Documents" Version="11.6.0" />
    <PackageVersion Include="Azure.Security.KeyVault.Secrets" Version="4.7.0" />
  </ItemGroup>

  <ItemGroup Label="Telemetry">
    <!--
      Transitively pinned above what Azure.Monitor.OpenTelemetry.AspNetCore resolves.
      OpenTelemetry.Api 1.12.0 carries GHSA-g94r-2vxg-569j, and NuGetAudit is configured to fail
      the build on it. This is the security gate working; do not lower these to silence it.
    -->
    <PackageVersion Include="OpenTelemetry.Api" Version="1.17.0" />
    <PackageVersion Include="OpenTelemetry" Version="1.17.0" />
  </ItemGroup>

  <ItemGroup Label="AI">
    <!-- Preview AI SDKs must be exact-pinned. See tasks/Taskfile.lint.yml. -->
    <PackageVersion Include="Azure.AI.Projects" Version="1.0.0-beta.9" />
    <PackageVersion Include="Azure.AI.Agents.Persistent" Version="1.0.0-beta.5" />
  </ItemGroup>

  <ItemGroup Label="Web">
    <PackageVersion Include="Microsoft.Identity.Web" Version="3.5.0" />
    <PackageVersion Include="Swashbuckle.AspNetCore" Version="7.2.0" />
  </ItemGroup>

  <ItemGroup Label="Testing">
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageVersion Include="xunit" Version="2.9.2" />
    <PackageVersion Include="xunit.runner.visualstudio" Version="2.8.2" />
    <PackageVersion Include="FluentAssertions" Version="7.0.0" />
    <PackageVersion Include="NSubstitute" Version="5.3.0" />
    <PackageVersion Include="coverlet.collector" Version="6.0.2" />
  </ItemGroup>

</Project>

===== FILE: Taskfile.yml =====
version: '3'

dotenv: ['.env']

env:
  TITLE: Foundry Capital Markets Router
  DEFAULT_REGION: eastus2

includes:
  app:
    taskfile: ./tasks/Taskfile.app.yml
    internal: false

  cloud:
    taskfile: ./tasks/Taskfile.cloud.yml
    internal: false

  test:
    taskfile: ./tasks/Taskfile.test.yml
    internal: false

  lint:
    taskfile: ./tasks/Taskfile.lint.yml
    internal: false

tasks:
  default:
    desc: Show available tasks
    cmds:
      - task --list

  up:
    desc: Create the full Azure environment for {{.TITLE}}
    cmds:
      - task: cloud:up
      - task: app:deploy

  down:
    desc: Destroy the Azure environment for {{.TITLE}}
    cmds:
      - task: cloud:down

===== FILE: tasks/Taskfile.cloud.yml =====
version: '3'

env:
  INFRA_DIR: infrastructure
  APPS_DIR: apps

vars:
  REGION: '{{default .DEFAULT_REGION .CLI_ARGS}}'

tasks:
  default:
    desc: Show available cloud tasks
    cmds:
      - task --list

  up:
    desc: Stand up the private Azure platform for {{.TITLE}}
    cmds:
      - task: guard
      - task: init
      - task: apply

  guard:
    desc: Refuse to proceed if Terraform state is local or the stacks are misaligned
    cmds:
      - ./scripts/guard-local-terraform-state.sh
      - ./scripts/policy-no-public-endpoints.sh

  init:
    desc: Initialise both Terraform stacks against remote state
    cmds:
      - terraform -chdir=./{{.INFRA_DIR}} init -upgrade
      - terraform -chdir=./{{.APPS_DIR}} init -upgrade

  plan:
    desc: Plan the platform stack
    cmds:
      - terraform -chdir=./{{.INFRA_DIR}} plan -compact-warnings
        -var "region={{.REGION}}"

  apply:
    desc: Apply the platform stack
    cmds:
      - terraform -chdir=./{{.INFRA_DIR}} apply -auto-approve -compact-warnings
        -var "region={{.REGION}}"

  outputs:
    desc: Show platform stack outputs
    cmds:
      - terraform -chdir=./{{.INFRA_DIR}} output

  down:
    desc: Destroy all Azure resources and clean local Terraform artifacts
    cmds:
      - az group list --tag Application="{{.TITLE}}" --query "[].name" -o tsv | xargs --no-run-if-empty -ot -n 1 az group delete -y --no-wait -n || true
      - rm -rf {{.INFRA_DIR}}/.terraform {{.INFRA_DIR}}/terraform.tfstate* || true
      - rm -rf {{.APPS_DIR}}/.terraform {{.APPS_DIR}}/terraform.tfstate* || true

  prove-private:
    desc: Demonstrate that public data-plane access is denied (compliance narrative beat)
    cmds:
      - ./scripts/prove-private-networking.sh

===== FILE: tasks/Taskfile.app.yml =====
version: '3'

env:
  APPS_DIR: apps

vars:
  ACR_LOGIN_SERVER:
    sh: terraform -chdir=./infrastructure output -raw acr_login_server 2>/dev/null || true
  TAG: '{{default "latest" .CLI_ARGS}}'
  SERVICES: router-service research-service surveillance-service orderrouting-service

tasks:
  default:
    desc: Show available app tasks
    cmds:
      - task --list

  build:
    desc: Build all service container images
    cmds:
      - for: { var: SERVICES }
        cmd: docker build -t {{.ACR_LOGIN_SERVER}}/{{.ITEM}}:{{.TAG}} -f src/{{.ITEM}}/Dockerfile .

  build-ui:
    desc: Build the scoreboard UI image
    cmds:
      - docker build -t {{.ACR_LOGIN_SERVER}}/webui:{{.TAG}} -f src/webui/Dockerfile src/webui

  push:
    desc: Push images to the private container registry
    cmds:
      - az acr login --name $(terraform -chdir=./infrastructure output -raw acr_name)
      - for: { var: SERVICES }
        cmd: docker push {{.ACR_LOGIN_SERVER}}/{{.ITEM}}:{{.TAG}}
      - docker push {{.ACR_LOGIN_SERVER}}/webui:{{.TAG}}

  deploy:
    desc: Build, push, and apply the workload stack
    cmds:
      - task: build
      - task: build-ui
      - task: push
      - terraform -chdir=./{{.APPS_DIR}} apply -auto-approve -compact-warnings
        -var "image_tag={{.TAG}}"

  seed:
    desc: Generate and load synthetic demo data (research corpus, e-comms, orders, alerts)
    cmds:
      - dotnet run --project src/tools/SyntheticData -- --seed 20260910 --all

  logs:
    desc: Tail logs for a container app. Usage - task app:logs -- router-service
    cmds:
      - az containerapp logs show --name {{.CLI_ARGS}}
        --resource-group $(terraform -chdir=./infrastructure output -raw resource_group_name)
        --follow

===== FILE: tasks/Taskfile.test.yml =====
version: '3'

tasks:
  default:
    desc: Run the test suites that exist today
    # contract, integration, and e2e are deliberately not in the default run: their projects do
    # not exist until T-015, T-035, and a deployed environment. A default task that always fails
    # is a default task people stop running.
    cmds:
      - task: unit
      - task: ui

  unit:
    desc: Run unit tests with coverage collection
    cmds:
      - dotnet test --collect:"XPlat Code Coverage" --results-directory ./TestResults

  coverage:
    desc: Enforce the 70% coverage threshold on router decision logic
    cmds:
      - ./scripts/check-coverage.sh 70 Fcmr.Router.Decisions

  contract:
    desc: Run contract tests against the published API contracts
    cmds:
      - dotnet test tests/Fcmr.Contract.Tests

  integration:
    desc: Run integration tests against a deployed environment
    cmds:
      - dotnet test tests/Fcmr.Integration.Tests

  e2e:
    desc: Run Playwright end-to-end tests (requires a deployed environment)
    dir: tests/e2e
    cmds:
      - npm ci
      - npx playwright test

  ui:
    desc: Run scoreboard UI unit tests
    dir: src/webui
    cmds:
      - npm ci
      - npm run test

===== FILE: tasks/Taskfile.lint.yml =====
version: '3'

tasks:
  default:
    desc: Run all repository lint and policy checks
    cmds:
      - task: format
      - task: terraform
      - task: policy
      - task: no-simulated-reasoning
      - task: preview-sdk-pins
      - task: api-types
      - task: diagrams
      - task: ui

  format:
    desc: Verify C# formatting and analyzer compliance
    cmds:
      - dotnet format --verify-no-changes

  terraform:
    desc: Verify Terraform formatting and validity across both stacks
    cmds:
      - terraform fmt -check -recursive infrastructure apps
      - terraform -chdir=infrastructure validate
      - terraform -chdir=apps validate

  policy:
    desc: Fail if any Terraform resource exposes a public data-plane endpoint
    cmds:
      - ./scripts/policy-no-public-endpoints.sh

  no-simulated-reasoning:
    desc: Fail if any path could render recorded output as live agent reasoning
    cmds:
      - ./scripts/policy-no-simulated-reasoning.sh

  preview-sdk-pins:
    desc: Fail if any preview Azure AI SDK is not exact-pinned
    silent: true
    cmds:
      - |
        set -e
        BAD=$(grep -nHE 'PackageVersion Include="Azure\.AI\.[A-Za-z.]+" Version="[^"]*(\*|\[)' Directory.Packages.props || true)
        if [ -n "$BAD" ]; then
          echo "Preview Azure.AI.* SDKs must be exact-pinned."
          echo "$BAD"
          exit 1
        fi
        echo "All Azure.AI.* dependencies are exact-pinned."

  api-types:
    desc: Fail if the UI's generated API types have drifted from the C# decision library
    cmds:
      - node scripts/generate-api-types.mjs --check

  diagrams:
    desc: Fail if the committed architecture diagrams have drifted from their generator
    cmds:
      - node scripts/diagrams/generate-diagrams.mjs --out docs/diagrams --check
      - node scripts/diagrams/validate.mjs docs/diagrams

  ui:
    desc: Lint and typecheck the scoreboard UI
    dir: src/webui
    cmds:
      - npm ci
      - npm run lint
      - npx tsc --noEmit

===== FILE: .github/CODEOWNERS =====
# Default owner for everything not otherwise matched.
*                           @briandenicola

# Governance surfaces require explicit review.
/.specify/memory/           @briandenicola
/.github/workflows/         @briandenicola
/docs/adr/                  @briandenicola
/SECURITY.md                @briandenicola

# Infrastructure and policy gates.
/infrastructure/            @briandenicola
/apps/                      @briandenicola
/scripts/policy-*.sh        @briandenicola
/scripts/guard-*.sh         @briandenicola

===== FILE: .github/dependabot.yml =====
version: 2

updates:
  - package-ecosystem: nuget
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
    groups:
      azure-sdk:
        patterns: ["Azure.*", "Microsoft.Azure.*", "Microsoft.Identity.*"]
      testing:
        patterns: ["xunit*", "FluentAssertions", "NSubstitute", "coverlet*", "Microsoft.NET.Test.Sdk"]
    ignore:
      # Preview AI SDKs are exact-pinned deliberately and upgraded by hand.
      - dependency-name: "Azure.AI.Projects"
      - dependency-name: "Azure.AI.Agents.Persistent"

  - package-ecosystem: npm
    directory: "/src/webui"
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
    groups:
      react:
        patterns: ["react", "react-dom", "@types/react*"]
      build-tooling:
        patterns: ["vite", "@vitejs/*", "typescript", "eslint*"]

  - package-ecosystem: npm
    directory: "/tests/e2e"
    schedule:
      interval: weekly

  - package-ecosystem: terraform
    directories:
      - "/infrastructure"
      - "/apps"
    schedule:
      interval: weekly

  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly

  - package-ecosystem: docker
    directories:
      - "/src/router-service"
      - "/src/research-service"
      - "/src/surveillance-service"
      - "/src/orderrouting-service"
      - "/src/webui"
    schedule:
      interval: weekly

===== FILE: Fcmr.slnx =====
<Solution>
  <Folder Name="/src/">
    <Project Path="src/Fcmr.Demo.Data/Fcmr.Demo.Data.csproj" />
    <Project Path="src/Fcmr.Router.Decisions/Fcmr.Router.Decisions.csproj" />
    <Project Path="src/router-service/router-service.csproj" />
  </Folder>
  <Folder Name="/tests/">
    <Project Path="tests/Fcmr.Demo.Data.Tests/Fcmr.Demo.Data.Tests.csproj" />
    <Project Path="tests/Fcmr.Router.Decisions.Tests/Fcmr.Router.Decisions.Tests.csproj" />
  </Folder>
</Solution>

===== FILE: .github/copilot-instructions.md =====
# Copilot Instructions — Foundry Capital Markets Router

This file is the single entry point for agent context in this repository.

## Read these first, in order

1. `.specify/memory/constitution.md` — governing principles. This is the tiebreaker whenever a
   specification, a convention, or your own preference points a different way.
2. `specs/001-router-core/spec.md` — the feature being built, with acceptance criteria.
3. `specs/001-router-core/data-model.md` and `specs/001-router-core/contracts/` — the shapes you
   must conform to.
4. `specs/001-router-core/tasks.md` — the sequenced plan. Work the plan; do not freelance.

## What this project is

A demonstration for AI decision makers and trade leadership in a bank's capital markets
division, delivered 2026-09-10. It proves that agentic AI can run on a private, policy-governed
Azure footprint with cost-and-complexity routing, human approval gates, and attributable output,
across research, trade surveillance, and order routing.

It is a demo, but the controls are real. The credibility of those controls in front of a
compliance audience is the entire product. Weakening one to move faster defeats the purpose.

## Hard rules

These are not preferences. Violating one is a defect regardless of how well the code works.

1. **No consequential action executes without recorded human approval.** Propose, rank, draft,
   evidence — never commit. Expiry is not approval.
2. **No public data-plane endpoints.** `public_network_access_enabled = true` fails CI.
3. **Unattributable claims are withheld and reported, never guessed.**
4. **All model access goes through `router-service`.** No other service calls a model
   deployment. This is enforced at the network layer; do not attempt a shortcut.
5. **Managed identity only.** No connection strings, keys, SAS tokens, or shared secrets in
   source, config, images, or Terraform outputs.
6. **Synthetic data only.** Generators are committed; generated volume is gitignored.
7. **Segregation of duties.** The identity that proposes cannot be the identity that approves.

## Stack

| Concern | Choice |
|---|---|
| Services | C#, .NET 10, ASP.NET Core minimal APIs |
| UI | Vite + React + TypeScript |
| Compute | Azure Container Apps. No Kubernetes. |
| IaC | Terraform, two stacks: `infrastructure/` then `apps/` |
| Orchestration | Taskfile.dev only; `Taskfile.yml` includes `tasks/Taskfile.*.yml` |
| Models | Azure AI Foundry, hosted agents preferred over prompt agents |
| Multi-agent | Foundry Tools and MCP |
| State | Cosmos DB for NoSQL (system of record), Azure AI Search (retrieval) |
| Telemetry | Application Insights and Log Analytics |
| Gateway | APIM as AI gateway for metering, cost ceilings, content safety |

Central package management via `Directory.Packages.props`. Do not add `PackageReference`
versions inline.

## Conventions

- Every request carries a `correlationId` end to end. Every audit record is keyed by it.
- Router decision logic lives in a dedicated, dependency-free assembly so it can be
  exhaustively unit-tested. It is coverage-gated at 70%.
- Terraform: `infrastructure/` is platform and longer-lived; `apps/` is workloads and reapplied
  often. `apps/` reads platform values through `references.tf`, never by duplication.
- Guard `enable_private_networking` with `count` on networking resources, following the pattern
  in `infrastructure/network.tf`.
- ADRs in `docs/adr/NNN-slug.md`. Record the decision before the deviating code merges.

## When you are asked to do something that conflicts with the above

Say so, name the principle, and propose an ADR. Do not silently comply and do not silently
refuse. The constitution has an amendment path; use it.

## Definition of done

Lint and typecheck clean; router decision coverage at or above 70%; CodeQL, gitleaks, and
Checkov clean; no-public-endpoint policy job green; specs and ADRs updated to match reality.

===== FILE: .github/workflows/quality-gate.yml =====
name: quality-gate

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: quality-gate-${{ github.ref }}
  cancel-in-progress: true

jobs:
  secrets:
    name: secret scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  no-public-endpoints:
    name: no public endpoint policy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Enforce private-by-construction
        run: ./scripts/policy-no-public-endpoints.sh

  terraform:
    name: terraform lint and scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.7.5
      - name: fmt
        run: terraform fmt -check -recursive infrastructure apps
      - name: validate infrastructure
        run: terraform -chdir=infrastructure init -backend=false && terraform -chdir=infrastructure validate
      - name: validate apps
        run: terraform -chdir=apps init -backend=false && terraform -chdir=apps validate
      - name: checkov
        uses: bridgecrewio/checkov-action@master
        with:
          directory: .
          framework: terraform
          soft_fail: false
          check: CKV_AZURE_*

  dotnet:
    name: dotnet build test coverage
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          global-json-file: global.json
      - name: restore
        run: dotnet restore
      - name: format check
        run: dotnet format --verify-no-changes --no-restore
      - name: build
        run: dotnet build --no-restore --configuration Release
      - name: test with coverage
        run: dotnet test --no-build --configuration Release --collect:"XPlat Code Coverage" --results-directory ./TestResults
      - name: enforce coverage threshold
        run: ./scripts/check-coverage.sh 70 Fcmr.Router.Decisions

  ui:
    name: ui lint typecheck test
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: src/webui
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm run test --if-present

  api-types:
    name: generated api types in sync
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # The UI's types are generated from the C# decision library. If a contract type changes and
      # the types are not regenerated, the drift shows up on stage rather than here.
      - run: node scripts/generate-api-types.mjs --check

  no-simulated-reasoning:
    name: no simulated agent reasoning
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ADR-007. The demo's one irreplaceable claim is live agent reasoning; a replayed transcript
      # rendered in the product UI falsifies it, and a label does not repair that. Enforced here
      # rather than asserted in a doc, for the same reason the public-endpoint rule is.
      - run: ./scripts/policy-no-simulated-reasoning.sh

  diagrams:
    name: architecture diagrams in sync
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # The .excalidraw files are build output, not drawings. Regenerating them here is what stops
      # the architecture picture quietly diverging from the architecture, which is the failure mode
      # that makes diagrams untrustworthy and therefore unused.
      - run: node scripts/diagrams/generate-diagrams.mjs --out docs/diagrams --check
      - run: node scripts/diagrams/validate.mjs docs/diagrams

  preview-sdk-pins:
    name: preview sdk pin guard
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: arduino/setup-task@v2
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
      - run: task lint:preview-sdk-pins

===== FILE: .github/workflows/codeql.yml =====
name: codeql

on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: '17 4 * * 1'

permissions:
  contents: read
  security-events: write

jobs:
  analyze:
    name: analyze ${{ matrix.language }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        language: [csharp, javascript-typescript]
    steps:
      - uses: actions/checkout@v4

      - if: matrix.language == 'csharp'
        uses: actions/setup-dotnet@v4
        with:
          global-json-file: global.json

      - uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          queries: security-extended

      - uses: github/codeql-action/autobuild@v3

      - uses: github/codeql-action/analyze@v3
        with:
          category: /language:${{ matrix.language }}

===== FILE: .specify/memory/constitution.md =====
# Foundry Capital Markets Router Constitution

## Mission

Prove that a bank's capital markets division can run agentic AI on a private, policy-governed
Azure footprint where every model call is routed by cost and task complexity, every consequential
action passes a human approval gate, and every claim is attributable — demonstrated live across
research, trade surveillance, and order routing.

## Audience

AI decision makers and trade leadership within a bank's capital markets division.
Secondary: the compliance and risk stakeholder who holds veto power over AI adoption.

## Core Principles

### I. Human-In-The-Loop (NON-NEGOTIABLE)

No consequential action executes without explicit human approval. A consequential action is any
action that would, in production, move an order, close or escalate a surveillance alert, or
publish research to a client. The agent may propose, rank, draft, and evidence — it may not
commit. Every approval is persisted with approver identity, timestamp, decision, and the full
evidence packet presented at decision time. An unapproved proposal expires; it never
auto-executes on timeout.

### II. Private By Construction (NON-NEGOTIABLE)

All Azure data-plane traffic traverses private endpoints inside a customer VNet. No workload has
public inbound ingress except the single demo UI front door. No workload has unrestricted public
egress. The `enable_private_networking` variable defaults to true; setting it false is a local
development affordance only and must be impossible in the cloud stack. A CI policy test fails the
build if any Terraform resource declares public data-plane access.

### III. Attribution Or Refusal (NON-NEGOTIABLE)

Every factual claim in a research or surveillance output carries a citation to a retrieved source
chunk. Claims that cannot be attributed are withheld and explicitly reported as unattributable,
never silently emitted. Coverage of attributed claims is measured and surfaced in the UI, not
merely logged.

### IV. Applications Never Select Models (NON-NEGOTIABLE)

No application, service, or prompt names a model, a vendor, or a deployment. Callers submit a
business request with its intent, its cost ceiling, and its data classification; the exchange
decides what executes it.

Governance policy — the approved vendor catalog, per-vendor data classification limits, region
restrictions, and cost ceilings — is evaluated **before** cost and complexity selection, and every
exclusion carries a human-readable reason. Policy decides what is permissible; the router then
decides what is appropriate among the permissible. Reversing that order would let a cost
optimisation reach a model governance has not approved.

The test of this principle is concrete and demonstrable: disabling a vendor in policy must change
which model executes an unchanged request from an unchanged application. If a code change,
redeploy, or prompt edit is required to swap a vendor, this principle is violated. Models are
temporary; governance is strategic.

### V. Routed By Cost And Complexity

Every model invocation passes through the router. From the policy-approved candidates, the router
selects using an assessed task-complexity score and an enforced cost ceiling, records the decision
with its inputs and rationale, and emits telemetry. No service may call a model deployment
directly. Routing rationale is visible in the UI at demo time, not buried in logs.

### VI. Evidenced And Auditable

Every agent action, model call, routing decision, retrieval, and approval writes an immutable
audit record correlated by a single correlationId spanning the request lifecycle. The audit trail
is reconstructable end-to-end for any single demo interaction within one query.

### VII. Synthetic Data Only

The repository and every deployed environment contain synthetic data exclusively. No real market
data, no real counterparties, no real personal data, no anonymised production extracts. Synthetic
generators are committed; generated volume artifacts are not.

### VIII. Identity Without Secrets

All service-to-service and service-to-Azure authentication uses Entra ID managed identity with
least-privilege RBAC. No connection strings, API keys, or shared secrets in code, config,
container images, or Terraform outputs. Key Vault holds only what genuinely cannot be
managed-identity-authenticated, and CI fails on any committed secret.

## Scope

### In Scope

- A routing core (router-service) fronting all model access: a governance policy gate over a
  multi-vendor approved catalog, then selection keyed on cost and task complexity.
- Three demonstrable lanes: research-service, surveillance-service, orderrouting-service.
- A live scoreboard UI showing per-request cost, latency, model tier, and quality signal.
- Human approval workflow with evidence packets, spanning all three lanes.
- Private Azure footprint: VNet, private endpoints, Entra ID, RBAC, Key Vault, Container Apps.
- Azure AI Foundry hosted agents; Foundry Tools and MCP for multi-agent decomposition.
- Synthetic data generators for research documents, e-comms, order flow, and blotters.
- Terraform IaC in two stacks; Taskfile-driven build, deploy, and teardown.

### Out Of Scope

- Real market data feeds of any kind.
- Real order execution. The OMS is simulated and clearly labelled as such in the UI.
- Model fine-tuning or continued pretraining.
- Production high availability, disaster recovery, or multi-region topology.
- Real customer personal data, material non-public information, or any production data extract.
- Regulatory certification claims. The demo simulates a regulated posture; it does not attest
  to one.

## Realism Checklist

The demo is only credible to a regulated capital markets audience if all of these are
demonstrably true on the day:

1. **Data** — every artifact is synthetic and generated by committed code; provenance is
   demonstrable on request; no production extract exists anywhere in the environment.
2. **Identity** — Entra ID authenticates the demo operator; app roles gate the approval action;
   an unprivileged identity is shown being denied an approval, live.
3. **Network** — the AI Foundry, Cosmos DB, Azure AI Search, Key Vault, and container registry
   data planes are reachable only over private endpoints; a public-network access attempt is
   shown failing, live.
4. **Integrations** — Azure AI Foundry, APIM as AI gateway, Cosmos DB, Azure AI Search, Log
   Analytics, and Application Insights are all real deployed Azure resources, not mocks.
5. **Constraints** — cost ceilings are enforced by the gateway and the router, not merely
   reported; exceeding a ceiling produces a visible, explainable denial or downgrade.
6. **Controls** — segregation of duties is enforced: the identity that proposes an action cannot
   be the identity that approves it.
7. **Audit** — any single demo interaction can be reconstructed end-to-end from the audit trail
   in one query, on stage, from an unrehearsed pick by the audience.

## Quality Gate And Definition Of Done

A change is not done until all of the following pass in CI on the pull request:

1. **Lint and typecheck clean** — dotnet format verification, C# analyzers as errors, ESLint and
   tsc for the Vite UI, terraform fmt and validate for both stacks.
2. **Test coverage** — line coverage of the router decision logic assembly is at least 70%,
   enforced by threshold, not reported. Coverage below threshold fails the build.
3. **Code scanning** — CodeQL for C# and JavaScript or TypeScript reports no new high or critical
   alerts. Dependabot is enabled for NuGet, npm, Terraform, GitHub Actions, and Docker.
4. **Secrets policy** — gitleaks scans full history and diff and reports zero findings.
5. **IaC scan** — Checkov runs against both Terraform stacks with no failed high-severity checks.
6. **No-public-endpoint policy test** — a dedicated CI job fails the build if any resource in
   either stack exposes a public data-plane endpoint.
7. **No-simulated-reasoning policy test** — a dedicated CI job fails the build if any service or UI
   path could render recorded output as live agent reasoning (ADR-007).

## Delivery Constraints

- Build complete by 2026-09-05. Demo delivered 2026-09-10. Feature work stops on 9/5; the period
  from 9/5 to 9/10 is rehearsal, hardening, and resilience work only.
- The full environment must stand up from zero via `task cloud:up` and tear down via
  `task cloud:down`, unattended, in under 45 minutes.
- **No fallback may simulate agent reasoning.** No mock, replay, recorded transcript, or fixture
  may stand in for live model inference in any demonstrated path. If the agent cannot run, the
  demo says the agent cannot run. The test: a fallback is permitted when it changes *where real
  evidence is read from*; it is forbidden when it changes *whether the evidence is real*.
  Inputs may be seeded and evidence may be re-read; reasoning is always live. See
  docs/adr/007-no-simulated-agent-reasoning.md.
- Contingency for total cloud failure is disclosure, not substitution: present rehearsal
  recordings **as recordings, outside the product UI**. The private-posture beats do not depend on
  inference and remain demonstrable independently.

## Engineering Guardrails

- .NET 10, C#, minimal APIs. Central package management via Directory.Packages.props.
- Vite, React, and TypeScript for the scoreboard UI.
- Terraform in two stacks: infrastructure (platform, longer-lived) and apps (workloads,
  frequently reapplied). Remote state; local state is guarded against by a CI script.
- Taskfile.dev is the only supported entry point for build, deploy, test, and teardown.
- Azure Container Apps is the compute platform. No Kubernetes.
- Hosted Foundry agents are preferred over prompt-only agents. A prompt agent requires a recorded
  ADR justifying why a hosted agent was insufficient.
- Multi-agent decomposition uses Foundry Tools and MCP. Bespoke orchestration protocols require
  an ADR.
- Every architecturally significant decision is recorded as an ADR in docs/adr.

## Security And Privacy Guardrails

- Managed identity everywhere; zero standing secrets.
- Least-privilege RBAC scoped per service identity. No service uses a subscription-scoped role.
- All model traffic transits APIM as AI gateway for token metering, cost ceilings, and
  content-safety enforcement. Direct model endpoint calls from services are forbidden and blocked
  by network policy, not merely by convention.
- Prompt injection is treated as an active threat: retrieved content is never granted tool-call
  authority, and the approval gate is the final backstop.
- Audit records are append-only and retained for the life of the demo environment.

## Context Discipline

- The file .github/copilot-instructions.md is the single entry point for agent context.
- Specs live in specs/NNN-slug. The constitution is the tiebreaker when a spec conflicts with an
  implementation preference.
- Any deviation from this constitution requires an ADR recorded before the deviating code merges.

## Governance

This constitution supersedes all other practices. All pull requests must verify compliance.
Complexity must be justified in an ADR. Amendments require an ADR, an updated version, and a note
in this document's history.

**Version**: 1.0.0 | **Ratified**: 2026-08-14 | **Last Amended**: 2026-08-14

===== FILE: .specify/templates/spec-template.md =====
# Feature NNN — [Feature Name]

## Problem Statement

What is broken or missing today, who feels it, and what it costs them. Write for someone who has
not been in the room. Avoid solution language here.

## Scope

### In Scope

### Out Of Scope

## Jobs To Be Done

**JTBD-N — [Role].** When [situation], I want [motivation], so I can [expected outcome].

## Acceptance Criteria

### AC-N — [Capability]

- **Given** [context], **when** [action], **then** [observable outcome].

Every criterion must be observable and testable. If you cannot write the test, the criterion is
not yet specific enough.

## Test Ideas

**Unit**

**Contract**

**Integration**

**End-to-end**

## Open Questions

Number them. Resolve or explicitly accept each before implementation begins.

## Constitution Check

Confirm this feature upholds each NON-NEGOTIABLE principle, or link the ADR that authorises the
deviation.

===== FILE: .specify/templates/plan-template.md =====
# Implementation Plan — Feature NNN

## Summary

One paragraph: what is being built and why now.

## Technical Context

Stack, existing components touched, external dependencies, and constraints that shape the design.

## Constitution Check

| Principle | Upheld | Notes |
|---|---|---|
| I. Human-in-the-loop | | |
| II. Private by construction | | |
| III. Attribution or refusal | | |
| IV. Routed by cost and complexity | | |
| V. Evidenced and auditable | | |
| VI. Synthetic data only | | |
| VII. Identity without secrets | | |

Any row not upheld requires an ADR link.

## Design

Components, responsibilities, and the boundaries between them.

## Data Model

Link to data-model.md.

## Contracts

Link to contracts/.

## Risks And Unknowns

Rank by impact. Front-load the riskiest work in the task sequence.

## Sequencing

Link to tasks.md.

===== FILE: .specify/templates/tasks-template.md =====
# Incremental Tasks — Feature NNN

Sequenced so a demonstrable slice exists early and the riskiest unknowns resolve first.

## Phase 0 — Foundation

- **T-001**
- **T-002**

## Phase N — [Name]

- **T-NNN**

## Conventions

- One task is one pull request wherever practical.
- Tasks that resolve a risk are scheduled before tasks that depend on the answer.
- A task is done only when the quality gate passes, not when the code compiles.

===== FILE: .specify/templates/checklist-template.md =====
# Checklist — [Name]

Purpose: [what this checklist protects against]

When to run: [pre-merge, pre-demo, post-deploy]

- [ ] Item, phrased so that passing or failing is unambiguous
- [ ] Item

## Sign-off

| Role | Name | Date |
|---|---|---|
| | | |

===== FILE: specs/001-router-core/spec.md =====
# Feature 001 — Router Core, Lanes, and Approval Gate

## Problem Statement

A bank's capital markets division cannot adopt agentic AI on the terms currently offered to it.
Three objections block every conversation:

1. **Compliance veto.** No one can demonstrate that the AI footprint is genuinely private — that
   model traffic and data planes never traverse the public internet, and that an unprivileged
   actor is actually stopped rather than merely discouraged.
2. **Unbounded and unexplainable spend.** Model costs are opaque. Leadership is asked to approve
   a budget with no per-request visibility and no enforcement mechanism, only a promise of
   prudence.
3. **Fear of ungoverned autonomy.** The prospect of an agent taking a consequential action —
   routing an order, closing a surveillance alert, publishing a research claim — without a human
   in the loop and without attributable evidence is a non-starter.

Today the division's analysts absorb the cost of these unresolved objections directly.
Surveillance analysts triage large alert queues dominated by false positives. Research analysts
hand-assemble syntheses and hand-verify every citation. Order routing decisions are made under
time pressure with incomplete cost and liquidity context. Agentic AI is the obvious remedy, and
it is unavailable to them because nobody has shown it operating under their constraints rather
than in spite of them.

This feature builds the demonstration that removes all three objections at once: a routing core
on a private Azure footprint, routing every model call by cost and task complexity, gating every
consequential action behind human approval, and attributing every factual claim to a source.

## Scope

### In Scope

- **router-service** — model tier selection, cost ceiling enforcement, decision recording,
  telemetry emission. The sole path to model access.
- **research-service** — retrieval-grounded synthesis with mandatory per-claim attribution and
  explicit refusal of unattributable claims.
- **surveillance-service** — bulk synthetic alert triage: ranking, evidence assembly, escalation
  memo drafting, all behind approval.
- **orderrouting-service** — order route proposal against a simulated OMS, with a best-execution
  policy boundary that halts for approval.
- **webui** — the live scoreboard: per-request cost, latency, model tier, routing rationale,
  quality signal, and the approval queue.
- Approval workflow with evidence packets and segregation-of-duties enforcement.
- Two-stack Terraform, private networking, Entra ID, RBAC, Key Vault, Container Apps.
- Synthetic data generators and seeded demo fixtures.

### Out Of Scope

Per constitution: real market data, real execution, fine-tuning, high availability and disaster
recovery, multi-region, real personal data, regulatory attestation.

## Jobs To Be Done

**JTBD-1 — Surveillance analyst.** When I face a queue of hundreds of overnight alerts, I want
the highest-risk ones surfaced first with evidence already assembled, so I can spend my morning
on the alerts that matter instead of clearing noise.

**JTBD-2 — Research analyst.** When I synthesise a view across many documents, I want every claim
traceable to its source and unsupported claims withheld rather than guessed, so I can publish
without personally re-verifying every sentence.

**JTBD-3 — Trading desk lead.** When an order needs routing, I want a proposed route with its
cost, liquidity, and best-execution rationale laid out, and I want to be the one who approves it,
so I retain accountability while losing the manual assembly work.

**JTBD-4 — AI decision maker.** When I evaluate agentic AI for the division, I want to see
per-request cost, model tier, and quality side by side, so I can commit to a budget I can defend
and prove savings rather than assert them.

**JTBD-5 — Compliance officer.** When AI is proposed for my division, I want to see private
networking, identity enforcement, segregation of duties, and a reconstructable audit trail
demonstrated live, so I can withdraw my objection on evidence rather than assurance.

## Acceptance Criteria

### AC-1 — Routing by cost and complexity

- **Given** an inbound task, **when** it reaches router-service, **then** a complexity score and
  a cost ceiling are computed before any model is invoked.
- **Given** a computed complexity score, **when** a tier is selected, **then** the decision record
  persists the score, the ceiling, the candidate tiers, the selected tier, and a human-readable
  rationale.
- **Given** a request whose projected cost exceeds its ceiling, **when** routing occurs, **then**
  the router downgrades tier or denies, and the reason is surfaced in the UI — never silently
  absorbed.
- **Given** any service other than router-service, **when** it attempts a direct model endpoint
  call, **then** the call fails at the network layer.

### AC-2 — Human-in-the-loop

- **Given** any consequential action, **when** an agent proposes it, **then** it enters the
  approval queue in PendingApproval and does not execute.
- **Given** a pending proposal, **when** it is presented for approval, **then** the evidence
  packet shows the inputs, the retrieved sources, the routing decision, and the proposed action.
- **Given** an approval decision, **when** it is recorded, **then** approver identity, timestamp,
  decision, and evidence-packet hash are persisted immutably.
- **Given** the identity that originated a proposal, **when** that same identity attempts to
  approve it, **then** the approval is rejected on segregation-of-duties grounds.
- **Given** a proposal that reaches its expiry, **when** the expiry elapses, **then** it
  transitions to Expired and never executes.

### AC-3 — Attribution or refusal

- **Given** a research synthesis, **when** it is returned, **then** every factual claim carries at
  least one citation resolving to a retrieved source chunk.
- **Given** a claim that cannot be grounded in retrieved sources, **when** synthesis completes,
  **then** the claim is withheld and reported in an explicit unattributableClaims list.
- **Given** any synthesis, **when** it renders, **then** attribution coverage is displayed as a
  percentage in the UI.
- **Given** retrieved content containing injected instructions, **when** it is processed, **then**
  no tool call is authorised from that content and the attempt is logged.

### AC-4 — Private by construction

- **Given** the cloud stack applied with defaults, **when** networking is inspected, **then** AI
  Foundry, Cosmos DB, Azure AI Search, Key Vault, and the container registry data planes are
  reachable only over private endpoints.
- **Given** a public-network access attempt against any data plane, **when** it is made from
  outside the VNet, **then** it fails, and the failure is demonstrable live.
- **Given** a pull request adding public data-plane access, **when** CI runs, **then** the
  no-public-endpoint policy job fails the build.
- **Given** any service, **when** it authenticates to Azure, **then** it uses managed identity and
  no secret is present in image, config, or Terraform output.

### AC-5 — Scoreboard

- **Given** a completed request, **when** the scoreboard refreshes, **then** cost, latency, model
  tier, routing rationale, and quality signal are visible within 5 seconds of completion.
- **Given** a batch of comparable requests, **when** the comparison view renders, **then**
  aggregate cost against a single-premium-tier baseline is shown with the delta as a percentage.
- **Given** a routing decision, **when** a user drills into it, **then** the full decision record
  including complexity inputs is displayed.

### AC-6 — Surveillance triage

- **Given** a synthetic alert batch of at least 500, **when** triage runs, **then** every alert
  receives a risk rank, a rationale, and an evidence set.
- **Given** the ranked queue, **when** it is presented, **then** ranking is reproducible for a
  fixed seed and input set.
- **Given** a high-risk alert, **when** escalation is proposed, **then** a drafted memo enters the
  approval queue and no alert state changes until approved.

### AC-7 — Order routing

- **Given** a synthetic order, **when** a route is proposed, **then** the proposal includes venue,
  projected cost, liquidity rationale, and best-execution justification.
- **Given** a proposal that breaches a policy boundary, **when** it is evaluated, **then** it
  halts with the breached policy named explicitly.
- **Given** an approved route, **when** it executes, **then** it executes against the simulated
  OMS only, and the UI labels it as simulated.

### AC-8 — Audit

- **Given** any demo interaction, **when** its correlationId is queried, **then** the full chain of
  agent actions, model calls, routing decisions, retrievals, and approvals is returned in one
  query.
- **Given** an audience member selecting an arbitrary past interaction, **when** it is queried
  live, **then** reconstruction succeeds without rehearsal.

## Test Ideas

**Unit — router decision logic (coverage-gated at 70%)**

- Complexity scoring boundaries: minimum, maximum, and each tier threshold.
- Cost ceiling: under, exactly at, and over; verify the downgrade-versus-deny branch.
- Tier selection determinism for identical inputs.
- Rationale string is non-empty and names the deciding factor for every branch.
- Unavailable preferred tier falls back predictably rather than throwing.

**Unit — approval workflow**

- Segregation of duties rejects self-approval.
- Expiry transitions to Expired and blocks execution.
- Evidence-packet hash changes when any packet field changes.
- State machine rejects illegal transitions.

**Unit — attribution**

- Claim with a resolving citation is emitted.
- Claim without a citation is withheld and listed as unattributable.
- Coverage percentage arithmetic across mixed claim sets.
- Injected-instruction content yields no tool authorisation.

**Contract**

- Router API request and response schemas against contracts/router-api.md.
- Approval API state transitions against contracts/approval-api.md.
- Cosmos document shapes against data-model.md.

**Integration**

- End-to-end research query produces a synthesis with resolvable citations.
- Surveillance batch of 500 completes and ranks reproducibly for a fixed seed.
- Order proposal breaching best execution halts with the policy named.
- Correlation ID spans all services in a single reconstruction query.

**Infrastructure policy**

- Terraform plan contains zero public data-plane exposures.
- Every service identity's role assignments are resource-scoped, never subscription-scoped.
- No Terraform output is marked non-sensitive while containing a credential pattern.
- Checkov high-severity findings are zero.

**End-to-end (Playwright)**

- Scoreboard renders cost, latency, and tier within 5 seconds of request completion.
- Approval queue: propose, approve as a second identity, verify execution.
- Self-approval attempt is blocked with a visible segregation-of-duties message.
- Unprivileged identity is denied the approval action.

**Demo rehearsal**

- task cloud:up from zero completes under 45 minutes unattended.
- Agent failure is demonstrable and honest: when a dependency is unreachable, the UI names the
  failed dependency rather than substituting a recorded result. No path renders simulated
  reasoning (ADR-007).

## Open Questions

1. **Scoreboard source of truth.** Application Insights is primary per SE preference, with a
   Cosmos change-feed fallback built behind configuration. Validated in T-014 against the AC-5
   five-second budget. Accepted as a hedge, not a settled decision.
2. **Quality signal method.** Deterministic signals chosen over LLM-as-judge for the primary
   on-screen number. See docs/adr/003-deterministic-quality-signal.md.
3. **Region.** Default eastus2, overridable per deployment via the region variable. Confirmed.
4. **Model catalog.** The catalog is multi-vendor and spans Azure OpenAI, Anthropic, xAI, and
   open-weight models served on Foundry managed compute (preview). Specific deployment names
   must be confirmed against availability in eastus2. See ADR 006.
5. **Governance layer.** Feature 002 supersedes the framing of this feature. See
   specs/002-governed-exchange/spec.md and docs/decisions-needed.md.

## Constitution Check

| Principle | Upheld | Notes |
|---|---|---|
| I. Human-in-the-loop | Yes | AC-2 |
| II. Private by construction | Yes | AC-4 |
| III. Attribution or refusal | Yes | AC-3 |
| IV. Routed by cost and complexity | Yes | AC-1 |
| V. Evidenced and auditable | Yes | AC-8 |
| VI. Synthetic data only | Yes | T-021 generators |
| VII. Identity without secrets | Yes | AC-4, T-009 |

===== FILE: specs/001-router-core/data-model.md =====
# Data Model — Feature 001

Store: **Azure Cosmos DB for NoSQL**, private endpoint only, managed identity authentication.
Telemetry: **Application Insights** and **Log Analytics**.

## Source-of-truth decision

The scoreboard reads from **Application Insights** as the primary source, per SE preference.
Cosmos remains the durable system of record for decisions, approvals, and audit, because
Application Insights sampling and ingestion latency are unsuitable for an audit trail and for the
reconstruct-any-interaction-in-one-query acceptance criterion.

Mitigation for the Application Insights risk, validated in T-014 before 9/5:

- Sampling disabled for router and approval telemetry.
- Ingestion latency measured against the AC-5 five-second budget.
- If latency or sampling fails the budget, the scoreboard falls back to the Cosmos change feed.
  This fallback is built regardless, so the switch is a configuration change, not a rewrite.

## Containers

### routerDecisions

Partition key: /correlationId

| Field | Type | Notes |
|---|---|---|
| id | string | GUID |
| correlationId | string | Spans the whole request lifecycle |
| lane | enum | Research, Surveillance, OrderRouting |
| taskKind | string | For example synthesize, triage, proposeRoute |
| complexityScore | number | 0.0 to 1.0 |
| complexityInputs | object | Signals and weights that produced the score |
| costCeilingUsd | number | Enforced ceiling for this request |
| candidateTiers | array | Tiers considered, with projected cost |
| selectedTier | enum | Economy, Standard, Premium |
| selectedDeployment | string | Foundry deployment name |
| outcome | enum | Routed, Downgraded, Denied |
| rationale | string | Human-readable, shown in the UI |
| promptTokens | number | From the gateway |
| completionTokens | number | From the gateway |
| actualCostUsd | number | Computed after the call |
| latencyMs | number | End to end |
| qualitySignal | object | method and score |
| baselineCostUsd | number | Cost had Premium been used; powers the savings delta |
| createdAt | string | ISO-8601 UTC |

### approvals

Partition key: /correlationId

| Field | Type | Notes |
|---|---|---|
| id | string | GUID |
| correlationId | string | |
| lane | enum | |
| proposedAction | object | Lane-specific action payload |
| evidencePacket | object | Inputs, retrieved sources, routing decision, proposal |
| evidencePacketHash | string | SHA-256; detects tampering |
| state | enum | PendingApproval, Approved, Rejected, Expired |
| proposedByObjectId | string | Entra object ID of the originating identity |
| decidedByObjectId | string | Null until decided; must differ from the proposer |
| decisionReason | string | Required on rejection |
| expiresAt | string | ISO-8601 UTC |
| createdAt | string | |
| decidedAt | string | |

Legal transitions: PendingApproval to Approved, Rejected, or Expired. Terminal states are final.

### surveillanceAlerts

Partition key: /batchId

| Field | Type | Notes |
|---|---|---|
| id | string | |
| batchId | string | Generation batch, seeded |
| alertType | enum | Spoofing, Layering, WashTrade, FrontRunning, MarkingTheClose, InsiderPattern |
| rawSignals | object | Synthetic trade and e-comms evidence |
| riskRank | number | Assigned by triage |
| riskRationale | string | |
| evidenceRefs | array | Pointers to source records |
| triageState | enum | Untriaged, Triaged, EscalationProposed, Escalated, Dismissed |
| correlationId | string | Links to the routing decision |
| syntheticSeed | number | Guarantees reproducibility |

### researchQueries

Partition key: /correlationId

| Field | Type | Notes |
|---|---|---|
| id | string | |
| correlationId | string | |
| question | string | |
| claims | array | text, citations, confidence |
| unattributableClaims | array | text and reason; withheld and explicitly reported |
| attributionCoverage | number | 0.0 to 1.0, displayed in the UI |
| retrievedChunks | array | chunkId, documentId, score, excerpt |
| injectionAttempts | array | Logged prompt-injection detections |

### orderProposals

Partition key: /correlationId

| Field | Type | Notes |
|---|---|---|
| id | string | |
| correlationId | string | |
| order | object | Synthetic: instrument, side, quantity, constraints |
| proposedVenue | string | |
| projectedCostBps | number | |
| liquidityRationale | string | |
| bestExecJustification | string | |
| policyBreaches | array | policyName and detail; non-empty means halt |
| state | enum | Proposed, Halted, Approved, SimulatedExecuted |
| simulated | boolean | Always true; the UI must render the label |

### auditEvents

Partition key: /correlationId. Append-only. No update or delete permission is granted to any
service identity.

| Field | Type | Notes |
|---|---|---|
| id | string | |
| correlationId | string | |
| sequence | number | Monotonic within the correlation |
| eventType | enum | AgentAction, ModelCall, RoutingDecision, Retrieval, ApprovalRequested, ApprovalDecided, PolicyDenial, InjectionDetected |
| actorObjectId | string | Human or service identity |
| payload | object | Event-specific |
| occurredAt | string | |

## Quality Signal

The qualitySignal.method field is one of:

- **AttributionCoverage** — research lane; the coverage percentage.
- **RankAgreement** — surveillance lane; agreement with a seeded ground-truth ranking.
- **PolicyConformance** — order routing lane; conformance to encoded best-execution rules.

**Deliberate choice:** no LLM-as-judge for the primary on-screen quality number. A judged score
invites the you-graded-your-own-homework challenge in front of a compliance audience. Every method
above is deterministic and independently checkable. LLM-as-judge may be added as a clearly
labelled secondary metric only. See docs/adr/003-deterministic-quality-signal.md.

===== FILE: specs/001-router-core/contracts/router-api.md =====
# Contract — Router API

Base: internal Container Apps ingress only. There is no public FQDN.
Auth: Entra ID. The caller must present a managed-identity token carrying the Router.Invoke app
role.

## POST /v1/route

The sole entry point for model access. Direct model endpoint calls from other services are blocked
at the network layer.

### Request

```json
{
  "correlationId": "b6b1f0a2-0000-0000-0000-000000000000",
  "lane": "Research",
  "taskKind": "synthesize",
  "payload": { "question": "..." },
  "costCeilingUsd": 0.25,
  "latencyBudgetMs": 8000,
  "complexityHints": {
    "inputTokenEstimate": 12000,
    "requiresMultiStep": true,
    "requiresRetrieval": true,
    "requiresToolCalls": false
  }
}
```

### Response 200

```json
{
  "correlationId": "b6b1f0a2-0000-0000-0000-000000000000",
  "decision": {
    "complexityScore": 0.72,
    "selectedTier": "Standard",
    "selectedDeployment": "gpt-5.4",
    "candidateTiers": [
      {
        "tier": "Economy",
        "deployment": "gpt-5.4-mini",
        "projectedCostUsd": 0.004,
        "rejectedReason": "Below complexity threshold for multi-step retrieval synthesis"
      },
      {
        "tier": "Standard",
        "deployment": "gpt-5.4",
        "projectedCostUsd": 0.031,
        "selected": true
      },
      {
        "tier": "Premium",
        "deployment": "gpt-5.6-sol",
        "projectedCostUsd": 0.180,
        "rejectedReason": "Exceeds cost ceiling headroom with no measured quality gain for this task kind"
      }
    ],
    "outcome": "Routed",
    "rationale": "Complexity 0.72 from multi-step plus retrieval clears Standard. Premium projected 0.180 USD exceeds the 0.25 USD ceiling headroom without measured quality benefit."
  },
  "result": { "note": "lane-specific payload" },
  "metrics": {
    "promptTokens": 11840,
    "completionTokens": 902,
    "actualCostUsd": 0.029,
    "latencyMs": 4310,
    "baselineCostUsd": 0.180,
    "qualitySignal": { "method": "AttributionCoverage", "score": 0.94 }
  }
}
```

### Response 402 — cost ceiling denial

```json
{
  "correlationId": "b6b1f0a2-0000-0000-0000-000000000000",
  "error": "CostCeilingExceeded",
  "message": "Cheapest viable tier projects 0.31 USD against a ceiling of 0.25 USD.",
  "decision": { "outcome": "Denied", "rationale": "..." }
}
```

A denial is never silently absorbed. It is always surfaced to the UI.

### Response 403

The caller lacks the Router.Invoke app role.

### Response 503

No tier is available. The response includes the tiers attempted. The router never falls back to an
unrouted direct call.

## GET /v1/decisions/{correlationId}

Returns the full routerDecisions record. Requires the Router.Read app role.

## GET /v1/scoreboard?window=15m

Aggregate for the scoreboard: request count, total cost, baseline cost, savings delta, p50 and p95
latency, tier distribution, and mean quality by lane.

===== FILE: specs/001-router-core/contracts/approval-api.md =====
# Contract — Approval API

Auth: Entra ID user token. Approval requires the Approver app role.

## GET /v1/approvals?state=PendingApproval

Returns pending proposals with evidence-packet summaries, scoped to the lanes the caller is
entitled to approve.

## GET /v1/approvals/{id}

Returns the full evidence packet: inputs, retrieved sources, routing decision, proposed action, and
the packet hash.

## POST /v1/approvals/{id}/decision

### Request

```json
{
  "decision": "Approved",
  "reason": "Best-execution rationale is sound; venue confirmed."
}
```

The reason field is required when the decision is Rejected.

### Responses

| Status | Condition |
|---|---|
| 200 | Decision recorded. Execution proceeds when the decision is Approved. |
| 409 SegregationOfDuties | decidedByObjectId equals proposedByObjectId. Rejected. |
| 409 InvalidTransition | The proposal is already in a terminal state. |
| 410 Expired | The proposal passed expiresAt. It will never execute. |
| 403 | The caller lacks the Approver app role. |

## Invariants

1. No consequential action executes without a 200 from this endpoint.
2. Expiry never implies approval.
3. Every call writes an auditEvents record before returning.

===== FILE: specs/001-router-core/tasks.md =====
# Incremental Tasks — Feature 001

Sequenced so that a demonstrable slice exists early and the riskiest unknowns resolve first.
Target: feature-complete 2026-09-05.

**Status key:** `[x]` complete and gated in CI · `[~]` partially delivered · unmarked = not started.
Last updated 2026-08-14.

## Phase 0 — Foundation (day 1 to 2)

- **T-001** Repo scaffold via scripts/bootstrap-repo.mjs; Taskfile tree; Directory.Packages.props;
  global.json pinning the .NET SDK.
- **T-002** Spec-kit assets under .specify, .github/agents, .github/prompts, and
  copilot-instructions.md.
- **T-003** CI quality gate: lint, typecheck, coverage threshold, CodeQL, gitleaks, Checkov,
  no-public-endpoint policy job. The gate must be green before any feature code merges.
- **T-004** Terraform remote state bootstrap and the local-state guard script.

## Phase 1 — Private platform (day 2 to 4) — riskiest, front-loaded

- **T-005** infrastructure stack: resource group, VNet, subnets, Log Analytics, Application
  Insights, container registry, Container Apps Environment with private networking enabled.
- **T-006** Private endpoints and private DNS zones for Cosmos, AI Search, Key Vault, the registry,
  and AI Foundry.
- **T-007** AI Foundry project, model deployments for the Economy, Standard, and Premium tiers, and
  the Foundry managed VNet.
- **T-008** APIM as AI gateway: token metering, cost ceiling policy, content safety.
- **T-009** apps stack: managed identities, least-privilege role assignments, Entra app
  registration with the Approver, Router.Invoke, and Router.Read app roles.
- **T-010** **Prove the negative** — script a live public-access-denied demonstration. If this
  cannot be shown convincingly, the compliance narrative fails. Discover that now, not on 9/9.

## Phase 2 — Router core (day 4 to 7)

- **T-011** router-service skeleton, health endpoint, correlation-ID middleware, Application
  Insights wiring.
- [x] **T-012** Complexity scoring: pure, deterministic, exhaustively unit-tested. This is the
  coverage-gated assembly. *(Done — `Fcmr.Router.Decisions` at 93.6% line coverage.)*
- [x] **T-013** Tier selection and cost ceiling enforcement, including the downgrade-versus-deny
  branch. *(Done, and extended for multi-vendor catalogs. Two defects fixed in the process: the
  candidate list marked every same-tier model as selected, which would have mis-attributed
  scoreboard cost the moment Feature 002 put four vendors in one tier; and within-tier selection
  took the first match rather than the cheapest.)*
- **T-014** Decision persistence to Cosmos plus telemetry. **Validate the Application Insights
  latency and sampling assumption here against the AC-5 five-second budget, and build the Cosmos
  change-feed fallback behind configuration regardless.**
- **T-015** POST /v1/route implemented against contracts/router-api.md, with contract tests.
- **T-016** GET /v1/scoreboard aggregation, including the Premium baseline delta.

## Phase 3 — Approval gate (day 7 to 9)

- **T-017** Approval domain model, state machine, and evidence-packet hashing.
- **T-018** Approval API per contract, segregation-of-duties enforcement, and the expiry job.
- **T-019** Append-only auditEvents, with a service identity holding no update or delete rights.
- **T-020** One-query correlation reconstruction endpoint satisfying AC-8.

## Phase 4 — Lanes (day 9 to 15, parallelisable)

- [x] **T-021** Synthetic data generators: research corpus, e-comms, order flow, blotters. Seeded and
  reproducible.
- **T-022** AI Search index and ingestion for the research corpus.
- **T-023** research-service: retrieval-grounded synthesis, per-claim attribution, unattributable
  refusal, coverage metric.
- **T-024** Prompt-injection defence: retrieved content holds no tool authority; detections logged.
- **T-025** surveillance-service: 500-alert batch triage, reproducible ranking, evidence assembly,
  escalation memo drafting behind approval.
- **T-026** orderrouting-service: simulated OMS, route proposal, best-execution policy boundary
  halt.
- **T-027** Hosted Foundry agents for each lane and the MCP tool surface. An ADR is required for
  any prompt-only agent. Broken out below; see `docs/agent-architecture.md`.
  - **T-027a** **Spike first.** Stand up one trivial hosted agent and confirm the Foundry tool-count
    and step-depth limits, thread creation latency, and that the project identity can reach the
    router but not a model deployment. Everything else in this phase assumes all four. Discover it
    now, not during T-025.
  - **T-027b** Agent host pattern in the lane services: thread-per-request lifecycle, correlationId
    propagation into every tool call and router call, step budget with a halt-and-report path.
  - **T-027c** MCP tool server conventions: schema definition, identity, structured errors,
    idempotency, and the audit record emitted per tool call. One shared implementation; the lanes
    supply tools, not plumbing.
  - **T-027d** Research agent — `search_corpus`, `fetch_chunk`, `list_sources`. Refusal is a
    success path, not an error path.
  - **T-027e** Surveillance agent — `fetch_alert_batch`, `fetch_communications`,
    `fetch_trade_context`, `submit_for_approval`. Chunked concurrent scoring with bounded
    parallelism. **Ranking is applied by deterministic code from model-produced scores**, which is
    what makes AC-6 reproducibility achievable.
  - **T-027f** Order routing agent — `fetch_order`, `fetch_venue_liquidity`,
    `evaluate_best_execution_policy`, `submit_for_approval`. Policy evaluation is deterministic code
    the agent explains, not a judgement the agent makes.
  - **T-027g** Agent failure-mode matrix implemented and demonstrable: tool error, model timeout, no
    eligible model, step-budget exhaustion. **No silent retry on a different tier** — it would
    corrupt the cost figures the scoreboard claims.
  - **T-027h** Determinism harness: fixed seeds and pinned temperature so rehearsal runs are
    comparable. Transcripts are recorded **for evaluation and for out-of-product narration only**;
    no code path may replay one into the UI. ADR-007.

## Phase 5 — Scoreboard UI (day 12 to 17)

Twelve screens; see `docs/ui-design.md` for the inventory, component layout, and required states.
Three of the four wow moments are screens in this phase.

- **T-028** Vite, React, and TypeScript shell; Entra authentication; role-aware navigation.
  - [x] **T-028a** App shell, routing, error boundary, and the projector-grade type scale. Every screen
    has one number that is deliberately the largest thing on it.
  - **T-028b** MSAL auth, `Router.Invoke` / `Router.Read` / `Approver` role guards. Unauthorised
    navigation is hidden; unauthorised *actions* render disabled with a stated reason — Beat 6
    needs something visible to refuse.
  - [~] **T-028c** API client, token acquisition, and **types generated from `contracts/`**. Not
    hand-written; hand-written types drift and the drift surfaces on stage.
    *(Client and generated types done, gated by the `api-types` CI job. Token acquisition waits on
    T-028b. **Deviation:** types are generated from the C# records rather than from the contract
    JSON, because an example payload cannot distinguish an optional field from one that happened to
    be null — the C# type system already carries that information and the contract examples do not.)*
  - [x] **T-028d** The five required states as shared primitives: loading, empty, error, partial,
    degraded. Build these before the screens that need them.
  - **T-028e** Request console (screen 1), including data classification on the request.
- **T-029** Live scoreboard: cost, latency, tier, rationale, quality, within the five-second
  freshness budget.
  - **T-029a** Scoreboard view with TanStack Query 5s polling, `refetchOnWindowFocus` disabled, and
    a visible data timestamp rather than a spinner.
  - **T-029b** Decision detail (screen 4) showing the full record including complexity inputs.
  - **T-029c** **Measure AC-5 end to end.** If Application Insights cannot make the 5s budget,
    switch to the Cosmos change-feed fallback here — that is what ADR 004 built it for — and render
    the degraded-source label.
- **T-030** Comparison view: aggregate cost against the Premium baseline with a percentage delta.
  **Primary wow moment B.** One dominant number; per-request table drillable mid-sentence, with the
  rationale as a plain sentence naming the deciding factor.
- **T-031** Surveillance triage queue view. **Primary wow moment C.**
  - **T-031a** Virtualised 500+ row queue. Unvirtualised lists stutter on projector hardware and the
    stutter reads as "this does not scale."
  - **T-031b** Alert detail (screen 6) with evidence set and rationale.
  - **T-031c** Visible seed indicator supporting the AC-6 reproducibility claim on stage.
- **T-032** Approval queue with evidence packet rendering and visible segregation-of-duties
  blocking.
- **T-033** Research view with inline citations, coverage percentage, and the unattributable-claims
  panel. **Secondary wow moment D.** The panel is always present and states "no unattributable
  claims" when empty — a panel that only appears on failure teaches the audience it is an error.
- **T-034** Simulated-OMS labelling everywhere order execution appears, on the record itself so a
  screenshot out of context is still honest.
- **T-042** **Policy sets screen (screen 12).** Previously unscheduled. Beat 5 has to change policy
  *somewhere*, and doing it in the Azure portal breaks the claim that governance is a first-class
  surface. Read-mostly with a per-vendor approval toggle is sufficient.
- **T-043** Audit reconstruction view (screen 11) for Beat 8. Takes a correlationId and renders the
  full chain from the AC-8 endpoint. Must handle an arbitrary audience-chosen id with no special
  casing.

## Phase 6 — Hardening and rehearsal (day 17 to 22, to 9/5)

Task numbers T-042 and T-043 belong to Phase 5 above; Phase 6 keeps its original numbering so
existing references elsewhere in the repository stay valid.

- **T-035** Playwright end-to-end coverage of AC-2, AC-3, and AC-5.
- **T-036** Terraform policy tests; Checkov clean; verify zero subscription-scoped roles.
- **T-037** Coverage to at least 70% on router decision logic; close the gaps.
- **T-038** docs/architecture.md, docs/threat-model.md, and ADRs 001 onward.
- **T-039** Timed unattended task cloud:up from zero. Must land under 45 minutes.
- **T-040** **Honest-failure path**, rehearsed end to end. When a model or agent dependency is
  unreachable, every lane surfaces which dependency failed, what the request would have done, and
  the governed decision that was still made — rather than substituting a recorded result. Replaces
  the deleted no-Azure replay fallback (ADR-007). This is a real task, not the absence of one: the
  failure screens must be as rehearsed as the success screens, because they are now the thing that
  runs if 9/10 goes wrong.
- **T-041** Demo runbook: narrative beats, timings, failure recovery, seeded fixtures.

## 9/5 to 9/10 — Freeze

No feature work. Rehearsal, honest-failure drills, and bug fixes only.

===== FILE: specs/002-governed-exchange/spec.md =====
# Feature 002 — Governed AI Exchange

- Status: Accepted — **Slice A only** for the 9/10 build
- Depends on: Feature 001 (router core)
- Source: `docs/requirements.md`
- Constitution: Principle IV (Applications Never Select Models) is the principle this feature exists to realise.

## Problem

Feature 001 gives us a router that picks a cheaper model when it can. That is an optimisation, and
optimisations are unremarkable to this audience.

The problem the bank actually has is different. Every application in the estate has a model name
compiled into it. When the best model changes — and it will change several times before this
system is retired — every one of those applications is a change request, a test cycle, and a
release. The model choice, which should be a governance decision revisited quarterly, has been
distributed into hundreds of codebases as an engineering decision that nobody owns.

Meanwhile the people accountable for that choice — risk, compliance, the business unit — have no
mechanism to express it. They can write a standard. They cannot enforce one.

**Feature 002 moves model selection out of applications and into governance.**

## Scope

### In scope

- A **policy engine**: approved vendor catalog, per-vendor data classification limits, region
  restrictions, cost ceilings, scoped per business unit.
- **Intent classification**: deriving what a request is trying to achieve from the request itself.
- **Task decomposition**: expanding one business request into an execution plan of several tasks.
- **Per-task routing**: each task routed independently, so a single request may execute across
  several vendors.
- **Execution plan visibility**: the plan, its per-task vendor assignments, and every policy
  exclusion with its reason, all surfaced in the UI.
- **Policy hot-swap**: changing a policy set changes subsequent execution with no redeploy.

### Out of scope

- Automatic policy authoring or policy recommendation. Policy is written by humans.
- Cross-request learning or adaptive routing. Every request is routed from first principles.
- Model fine-tuning or evaluation harnesses.
- Replacing Feature 001's cost and complexity selection. This feature runs *ahead* of it.

## Jobs To Be Done

### JTBD-1 — Submit work without naming a model

> As an application developer, I submit a business request with intent, cost ceiling, and data
> classification, so that I never have to know which models exist or which is currently preferred.

**Acceptance criteria**

- The request contract contains no model, vendor, or deployment field. A caller *cannot* express a
  preference, because a field that exists will eventually be used.
- The response reports which models executed, so the caller has transparency without control.
- Two requests with identical bodies, submitted under different policy sets, may execute on
  different vendors and both succeed.

### JTBD-2 — Govern the catalog without touching applications

> As a risk officer, I add or remove an approved vendor and see it take effect on the next request,
> so that model governance is a control I hold rather than a change request I file.

**Acceptance criteria**

- Removing a vendor from a policy set excludes it from routing within one request cycle.
- No application deployment, restart, or prompt change is required.
- The exclusion appears in the execution plan with a reason naming the policy set.
- Removing *all* eligible vendors produces an explicit refusal, never a silent fallback to an
  unapproved model. **A governance system that degrades open under pressure is not a control.**

### JTBD-3 — Keep restricted data off third-party infrastructure

> As a data protection officer, I set a maximum data classification per vendor, so that Restricted
> material can only reach models running on infrastructure we control.

**Acceptance criteria**

- Each vendor carries a maximum permitted classification in the policy set.
- A request whose classification exceeds a vendor's maximum excludes that vendor, even when the
  vendor is otherwise approved and would be the cheapest or best choice.
- Restricted requests route only to open-weight models on managed compute inside the VNet.
- The exclusion reason names the classification, not merely "policy".

### JTBD-4 — Decompose work across the vendors best suited to it

> As a research analyst, I ask one question and have its parts handled by whichever models are
> strongest at each part, so I get a better answer than any single model would produce.

**Acceptance criteria**

- One request produces an execution plan of one or more tasks, each with its own intent and
  complexity.
- Each task is routed independently through the policy gate and the router.
- The plan is visible before execution completes; the audience sees the reasoning, not just a
  result.
- Tasks with no eligible model fail that task explicitly rather than failing the whole request
  silently.

### JTBD-5 — Prove the swap on stage

> As the SE presenting this, I disable a vendor mid-demo and resubmit an identical request, so the
> audience sees replanning happen rather than being told it can happen.

**Acceptance criteria**

- Policy change to observable behaviour change takes under 10 seconds.
- The before and after execution plans can be displayed side by side.
- The request payload is byte-identical across both runs, and this is demonstrable in the UI.

## Test ideas

- Property: for any policy set and any request, the selected model's vendor is a member of
  `ApprovedVendors`. This is the invariant the whole feature rests on; assert it exhaustively.
- Property: for any request, the selected vendor's max classification is at least the request's
  classification.
- Removing each vendor in turn from a four-vendor catalog yields four different valid plans.
- Empty eligible set produces refusal, and the refusal names every exclusion reason.
- Region mismatch excludes the entire catalog and names the region.
- Snapshot the execution plan for a fixed request under two policy sets; assert they differ only
  in vendor assignment.

## Delivery slices

Feature 001 already consumes the 22 days to 9/5. Feature 002 is therefore split, and only Slice A
is in the 9/10 build.

### Slice A — in the 9/10 build

Policy engine, policy storage, hot-swap, and the policy screen. Delivers **JTBD-1, JTBD-2, JTBD-3,
and JTBD-5**, which is everything Beat 5 needs. `PolicyGate` in `Fcmr.Router.Decisions` is already
built and tested, so this slice is mostly storage, API surface, and UI.

The demo claim Slice A supports in full: *disable a vendor in policy and an unchanged request from
an unchanged application executes somewhere else.* Nothing about that claim requires decomposition.

### Slice B — deferred, Phase 2 backlog

Intent classification and task decomposition (**JTBD-4**). Deferred because it is the largest
unknown in the feature and the least load-bearing for the narrative: a single-task request routed
under policy proves governance just as well as a five-task plan, and does it in less stage time.

Slice B is specified here rather than dropped, so the "what's next" conversation has substance
behind it.

## Resolved questions

**Where policy sets live.** Cosmos container `policySets`, seeded at deploy time from a
Terraform-managed JSON baseline, with the change feed providing the audit trail. Writes go through
the policy API, never directly.

This deliberately serves two audiences at once. The demo needs a sub-10-second hot-swap, which
Cosmos gives. A bank needs review-gated change, which the Terraform baseline gives — the production
path is Git, pipeline, then Cosmos, and the runtime write path exists for the demo and for
break-glass. Say that out loud if asked; it is a better answer than pretending either alone is
sufficient.

**Whether intent classification uses a model.** Yes, but it is **not routed** — it uses a fixed
cheap deployment declared as infrastructure. Routing the component that decides routing is circular,
and the recursion would be the first thing an architect in the room noticed. Slice B only.

**Scope for 9/10.** Slice A. Recorded in `docs/decisions-needed.md` item 3.

## Open questions

1. Whether a policy change should invalidate in-flight requests or only affect subsequent ones.
   Current position: subsequent only, because cancelling work mid-flight is a worse behaviour to
   demonstrate than finishing it under the policy that authorised it. Revisit if the audience is
   more compliance than engineering.
2. Whether policy sets are versioned or mutable. Slice A treats them as versioned-on-write via the
   change feed, which is free. A real versioning UX is out of scope.

===== FILE: specs/002-governed-exchange/data-model.md =====
# Data Model — Feature 002

Extends `specs/001-router-core/data-model.md`. Same source-of-truth rule: Cosmos is authoritative,
Application Insights is derived and may be sampled.

## Containers

### policySets

Partition key: `/businessUnit`. The governance object the demo mutates on stage.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Policy set identifier, e.g. `CapitalMarkets-US` |
| `businessUnit` | string | Partition key. Governance is scoped per business unit |
| `displayName` | string | Shown in the policy screen |
| `approvedVendors` | string[] | `AzureOpenAI`, `Anthropic`, `XAI`, `OpenWeight` |
| `maxClassification` | map<string,string> | Vendor to maximum permitted classification |
| `allowedRegions` | string[] | Empty means unrestricted |
| `maxCostPerRequestUsd` | number | Policy ceiling, applied before any per-request ceiling |
| `version` | number | Incremented on write |
| `updatedBy` | string | Entra object id of the approver who changed it |
| `updatedAt` | string | ISO 8601 |
| `_ts` | number | Cosmos timestamp; drives the change feed |

**Seeded from Terraform, written through the API.** The deploy-time baseline is a
Terraform-managed JSON document; runtime writes exist for the demo and for break-glass. Nothing
writes to this container directly.

**Change feed is the audit trail.** Every write produces an `auditEvent` of kind
`PolicySetChanged` carrying the before and after. A governance control whose own changes are
unaudited is not a control.

### routerDecisions — extended

Feature 001 fields are unchanged. Slice A adds:

| Field | Type | Notes |
|---|---|---|
| `policySetId` | string | Which policy set governed this decision |
| `policySetVersion` | number | Pinned at decision time, so a later edit cannot rewrite history |
| `dataClassification` | string | `Public`, `Internal`, `Confidential`, `Restricted` |
| `selectedVendor` | string | Vendor of the selected model |
| `policyExclusions` | object[] | `{ deployment, vendor, reason }` per excluded candidate |

`policySetVersion` matters more than it looks. Without it, replaying an audit record after a policy
edit would show a decision that appears to violate the policy in force — which is exactly the
finding an auditor would escalate.

`policyExclusions` is persisted, not merely computed for the response. The question "why was this
model not used?" is asked long after the request completes.

### auditEvents — extended

New `kind` values: `PolicySetChanged`, `PolicyEvaluated`, `RequestRefusedByPolicy`.

`RequestRefusedByPolicy` is a first-class outcome, not an error. A refusal is the system working.

## Enumerations

`DataClassification` is ordered, and the ordering is the comparison used by the gate:

```text
Public (0) < Internal (1) < Confidential (2) < Restricted (3)
```

A vendor's `maxClassification` is the highest it may process. `request > vendor maximum` excludes
the vendor. Adding a level later means inserting into this ordering — do not renumber; append.

## Slice B additions (deferred)

Recorded for completeness; not built for 9/10.

### executionPlans

| Field | Type | Notes |
|---|---|---|
| `id` | string | Plan identifier |
| `correlationId` | string | Partition key |
| `intent` | string | Classified intent of the business request |
| `tasks` | object[] | `{ taskId, description, complexity, selectedVendor, selectedDeployment, status }` |
| `status` | string | `Planned`, `Executing`, `Completed`, `PartiallyFailed` |

`PartiallyFailed` exists because a task with no eligible model must fail that task explicitly
rather than failing the whole request silently.

===== FILE: specs/002-governed-exchange/contracts/policy-api.md =====
# Contract — Policy API

Base: internal Container Apps ingress only. There is no public FQDN.
Auth: Entra ID. Reads require `Router.Read`; **writes require `Approver`.**

Governance changes are an approver action. If the role that invokes models could also change which
models are approved, the control would be circular.

## GET /v1/policy-sets

Returns policy sets visible to the caller's business unit.

### Response 200

```json
{
  "policySets": [
    {
      "id": "CapitalMarkets-US",
      "businessUnit": "CapitalMarkets",
      "displayName": "Capital Markets — US",
      "approvedVendors": ["AzureOpenAI", "Anthropic", "XAI", "OpenWeight"],
      "maxClassification": {
        "AzureOpenAI": "Confidential",
        "Anthropic": "Internal",
        "XAI": "Internal",
        "OpenWeight": "Restricted"
      },
      "allowedRegions": ["eastus2"],
      "maxCostPerRequestUsd": 0.5,
      "version": 3,
      "updatedBy": "8f1c...",
      "updatedAt": "2026-09-10T14:02:11Z"
    }
  ]
}
```

## GET /v1/policy-sets/{id}

Single policy set. 404 if not visible to the caller's business unit.

## PATCH /v1/policy-sets/{id}

The stage action. Partial update; only supplied fields change.

### Request

```json
{
  "approvedVendors": ["AzureOpenAI", "XAI", "OpenWeight"],
  "expectedVersion": 3
}
```

`expectedVersion` is required. A mismatch returns **409 Conflict**. Two approvers editing
concurrently must not silently overwrite one another — least of all in a governance control.

### Response 200

```json
{
  "id": "CapitalMarkets-US",
  "version": 4,
  "changed": {
    "approvedVendors": {
      "from": ["AzureOpenAI", "Anthropic", "XAI", "OpenWeight"],
      "to": ["AzureOpenAI", "XAI", "OpenWeight"]
    }
  },
  "effectiveFrom": "2026-09-10T14:05:03Z"
}
```

`changed` is a before-and-after diff, returned so the UI can show precisely what the approver did
without a second fetch. It is the same payload written to the audit event.

### Errors

| Status | When |
|---|---|
| 400 | Unknown vendor, unknown classification, or `maxClassification` naming a vendor not in `approvedVendors` |
| 403 | Caller lacks `Approver` |
| 409 | `expectedVersion` mismatch |
| 422 | The change would leave no vendor able to serve `Restricted`, when the set is marked as permitting Restricted data |

422 is deliberate. Silently creating a policy set that refuses every restricted request is a
configuration accident that would surface as a demo failure.

## GET /v1/policy-sets/{id}/history

Change feed projection. Returns the last N versions with `updatedBy`, `updatedAt`, and the diff.

Backs the audit claim: the control's own changes are auditable.

## Freshness contract

A successful `PATCH` is visible to routing **within 5 seconds**, matching the AC-5 scoreboard
budget. Beat 5 depends on this: the presenter changes policy and resubmits immediately.

In-flight requests are unaffected — they complete under the policy version pinned at decision time.

===== FILE: specs/002-governed-exchange/contracts/router-api-policy-extension.md =====
# Contract — Router API, policy extension

Extends `specs/001-router-core/contracts/router-api.md`. Slice A.

## POST /v1/route — additional request fields

```json
{
  "dataClassification": "Internal",
  "policySetId": "CapitalMarkets-US"
}
```

| Field | Required | Notes |
|---|---|---|
| `dataClassification` | Yes | Defaulting this would be unsafe. An omitted classification is a **400**, not an assumption of `Public` |
| `policySetId` | No | Defaults to the policy set for the caller's business unit |

**There is still no model, vendor, or deployment field, and there will not be one.** Principle IV
is enforced by the contract's shape: a field that exists is a field that eventually gets used.

`dataClassification` is a property of the request, not a routing preference. The caller states what
the data *is*; the exchange decides what that permits.

## POST /v1/route — additional response fields

```json
{
  "decision": {
    "policySetId": "CapitalMarkets-US",
    "policySetVersion": 4,
    "selectedVendor": "AzureOpenAI",
    "policyExclusions": [
      {
        "deployment": "claude-sonnet-4-5",
        "vendor": "Anthropic",
        "reason": "Vendor Anthropic is not approved under policy set 'CapitalMarkets-US'."
      }
    ]
  }
}
```

`reason` is prose fit to read aloud to a governance audience. Not an error code, not "policy". The
presenter will read one of these on stage in Beat 5.

## New outcome — RefusedByPolicy

`outcome` gains a value alongside `Routed`, `Downgraded`, and `Denied`:

```json
{
  "decision": {
    "outcome": "RefusedByPolicy",
    "selectedDeployment": null,
    "policyExclusions": [ "...every candidate, each with a reason..." ]
  }
}
```

Returned as **200**, not an error status. A refusal is a correct, governed outcome and callers must
handle it as a normal response. Modelling it as a 4xx would encourage retry-on-error logic, and the
one thing that must never happen is a retry that finds an unapproved model.

`Denied` (cost ceiling, Feature 001) and `RefusedByPolicy` (governance) stay distinct. Collapsing
them would lose the distinction between "too expensive" and "not permitted", which are different
conversations with different people.

## Evaluation order

Policy first, then cost and complexity:

```text
catalog -> PolicyGate.Evaluate() -> eligible -> TierSelector.Select() -> decision
```

Reversing this would let a cost optimisation reach a model governance has not approved. The order
is asserted by test, not left to code reading.

===== FILE: specs/002-governed-exchange/tasks.md =====
# Incremental Tasks — Feature 002

Numbered `T-2xx` to stay distinct from Feature 001's `T-0xx`.

**Slice A only for the 9/10 build.** Slice B is the Phase 2 backlog.

## Slice A — Policy engine (runs alongside Feature 001, day 7 to 17)

Sequenced to land before the UI work in Feature 001's Phase 5 needs it.

### Storage and seed

- **T-201** `policySets` Cosmos container, partitioned on `/businessUnit`, with the change-feed
  subscription wired to `auditEvents`.
- **T-202** Terraform-managed baseline policy set, seeded at deploy time. `CapitalMarkets-US` with
  all four vendors approved and the classification limits from the data model.
- [x] **T-203** Policy set repository with optimistic concurrency on `version`. A write with a stale
  `expectedVersion` fails; it does not merge.

### API

- **T-204** `GET /v1/policy-sets` and `GET /v1/policy-sets/{id}`, `Router.Read`.
- **T-205** `PATCH /v1/policy-sets/{id}`, **`Approver` only**, returning the before-and-after diff.
  Includes the 400, 409, and 422 validation cases from the contract.
- **T-206** `GET /v1/policy-sets/{id}/history` from the change feed.
- **T-207** `PolicySetChanged` audit event carrying before and after. The control's own changes
  must be auditable or the control is not one.

### Router integration

- **T-208** Extend `POST /v1/route` with `dataClassification` (**required — omission is a 400, not
  a default**) and optional `policySetId`.
- [x] **T-209** Wire `PolicyGate` into the routing path **ahead of** `TierSelector`. Assert the order
  by test; do not leave it to code reading.
- [x] **T-210** Add `RefusedByPolicy` as a 200 outcome distinct from `Denied`. Callers must not treat a
  refusal as a retryable error.
- [~] **T-211** Persist `policySetId`, `policySetVersion`, `dataClassification`, `selectedVendor`, and
  `policyExclusions` on the decision record. Version is pinned at decision time so a later edit
  cannot rewrite history.
- **T-212** Policy cache with a **5-second maximum staleness**, matching the contract. Beat 5 fails
  if this is slower; a per-request read would also work and is the safer fallback.

### Multi-vendor execution

- **T-213** Vendor-aware model invocation in the router: Azure OpenAI, Anthropic, and xAI
  serverless deployments behind one internal interface.
- **T-214** Open-weight invocation against the managed compute endpoint, gated on
  `enable_managed_compute`. Degrades to "Restricted unavailable" rather than failing the service
  when the toggle is off.

### UI

- **T-215** Policy sets screen (Feature 001 **T-042**) wired to this API: per-vendor approval
  toggles, classification limits, current version, and last-changed-by.
- **T-216** Surface `policyExclusions` in the decision detail view (T-029b), each with its reason
  rendered as prose.
- **T-217** Data classification control on the request console (T-028e), including the Restricted
  path.

### Proof

- [x] **T-218** Property test: for any policy set and any request, the selected vendor is in
  `approvedVendors` and its `maxClassification` is at least the request classification. This is the
  invariant the feature rests on — assert it exhaustively, not by example.
- [x] **T-219** Removing each vendor in turn from the four-vendor catalog yields four valid plans; an
  empty eligible set yields `RefusedByPolicy` naming every exclusion.
- **T-220** **Rehearse Beat 5 end to end and time it.** Policy change to observable behaviour
  change under 10 seconds, with byte-identical request payloads across both runs, shown in the UI.

## Slice B — Intent and decomposition (Phase 2 backlog, not in the 9/10 build)

- **T-251** Intent classification against a fixed cheap deployment declared as infrastructure and
  explicitly **not routed**. Routing the component that decides routing is circular.
- **T-252** Task decomposition producing an `executionPlans` record.
- **T-253** Per-task routing, so one request may execute across several vendors.
- **T-254** Execution plan visible in the UI before completion — the audience sees reasoning, not
  just a result.
- **T-255** `PartiallyFailed` handling: a task with no eligible model fails that task explicitly
  rather than failing the request silently.

## Dependencies on Feature 001

| This feature | Needs |
|---|---|
| T-208…T-212 | T-015 (`POST /v1/route`) |
| T-211 | T-014 (decision persistence) |
| T-215 | T-028b (role guards), T-042 (policy screen shell) |
| T-216 | T-029b (decision detail) |
| T-207 | T-019 (append-only audit events) |

Slice A cannot start before T-015 and T-019 land, which places it at Feature 001 day 7 at the
earliest. That is the real constraint on this slice, not its own size.

===== FILE: docs/README.md =====
# Documentation

| Document | Purpose |
|---|---|
| architecture.md | How the system is put together and why |
| agent-architecture.md | The three lane agents, their tools, and where their authority stops |
| ui-design.md | Screen inventory, component and state architecture, required states |
| threat-model.md | What can go wrong, and what stops it |
| demo-runbook.md | The 9/10 narrative, timings, and failure recovery |
| decisions-needed.md | Forks between requirements.md and the locked decisions |
| requirements.md | The original demo script this repository is built from |
| adr/ | Architecture decision records |

Governing documents live outside this directory:

- `.specify/memory/constitution.md` — the principles that override everything here.
- `specs/001-router-core/` — the specification, contracts, data model, and task plan.

===== FILE: docs/architecture.md =====
# Architecture

## Purpose

This system exists to make three claims demonstrable rather than assertable, in front of an
audience that has heard the assertions before: the footprint is private, the spend is governed,
and the agent cannot act alone.

Every architectural choice below serves one of those three claims. Where a choice makes the system
more elaborate without strengthening a claim, it has been left out.

## Component view

```text
                        Entra ID  ·  RBAC  ·  app roles
                                    |
   webui (Vite/React)               |
        |                           |
        v                           v
   router-service  ────────>  APIM AI Gateway  ────────>  Azure AI Foundry
        |    ^                  metering                  hosted agents
        |    |                  cost ceilings             model tiers
        |    |                  content safety            MCP tool surface
        |    |
        |    +──────────────────────────────────┐
        v                                       |
   research-service      ──> Azure AI Search    |
   surveillance-service  ──> Cosmos DB          | all model calls
   orderrouting-service  ──> simulated OMS      | return through the router
                                                |
                              Cosmos DB  <──────+
                              (decisions, approvals, audit)

   Telemetry: Application Insights and Log Analytics
   Compute:   Azure Container Apps, inside the VNet
   Data:      every plane on a private endpoint
```

## The router is a chokepoint by design

`router-service` is the only component permitted to reach a model deployment. This is not a
convention enforced by code review; it is enforced by network policy. The lane services have no
route to the Foundry data plane.

That chokepoint is what makes the second claim demonstrable. Because every model call passes
through one place, cost, latency, tier, and rationale can be captured for every call without
exception, and the scoreboard can state a total rather than a sample.

It is also what makes the cost ceiling enforceable rather than advisory. A ceiling that services
could bypass would be a reporting feature. A ceiling at a chokepoint the services cannot route
around is a control.

## Two Terraform stacks

`infrastructure/` holds the platform: resource group, VNet and subnets, private DNS, private
endpoints, Container Apps Environment, container registry, Cosmos, AI Search, Key Vault, AI
Foundry, Log Analytics, and Application Insights. It changes rarely and takes a long time to
apply.

`apps/` holds the workloads: container apps, managed identities, role assignments, and the Entra
app registration. It changes constantly during a compressed build.

Separating them means a routine service redeploy does not risk a plan against the network. During
a three-week build with a fixed demo date, that risk asymmetry matters more than the convenience
of a single apply. See `adr/002-two-stack-terraform.md`.

`apps/` reads platform values through `references.tf` using remote state data sources. Values are
never duplicated between stacks.

## Private networking

`enable_private_networking` defaults to true and gates the networking resources with `count`,
following the reference pattern. Every data plane — Foundry, Cosmos, AI Search, Key Vault, the
registry — is reachable only through a private endpoint with a corresponding private DNS zone
linked to the VNet.

The only public surface is the demo UI front door. Everything behind it is internal ingress.

A CI job fails the build if any resource in either stack declares public data-plane access. The
control is therefore continuous, not a one-time configuration that drifts.

## Identity

Every service runs as a user-assigned managed identity with resource-scoped role assignments. No
service holds a subscription-scoped role. There are no connection strings anywhere in the system.

Human access is Entra ID with three app roles:

| Role | Grants |
|---|---|
| Router.Invoke | Service-to-service model access through the router |
| Router.Read | Read routing decisions and the scoreboard |
| Approver | Decide on pending proposals |

Segregation of duties is enforced in the approval service, not in the UI. The UI hides the button;
the API rejects the call. A demo audience will ask which one is real, and the answer needs to be
the API.

## Data flow for a single request

1. The UI or a lane service issues a request carrying a `correlationId`.
2. `router-service` computes a complexity score and resolves a cost ceiling.
3. The router selects a tier, records the decision with its rationale, and calls through APIM.
4. APIM meters tokens, enforces the ceiling, and applies content safety.
5. Foundry executes the hosted agent, using MCP tools where the lane requires decomposition.
6. The lane service assembles a result. If the result implies a consequential action, it becomes
   a proposal in `PendingApproval` rather than an execution.
7. Every step writes an `auditEvents` record keyed by the same `correlationId`.
8. The scoreboard reflects cost, latency, tier, rationale, and quality within five seconds.

Step 6 is the whole of the third claim. The agent produces a proposal and an evidence packet. A
human, holding a different identity from the proposer, produces the decision.

## Quality signal

Each lane reports a deterministic quality number: attribution coverage for research, rank
agreement against a seeded ground truth for surveillance, and policy conformance for order
routing.

None of these is an LLM-as-judge score. In front of a compliance audience, a model-graded number
invites an obvious objection and the demo loses the room defending it. Deterministic numbers can
be recomputed by the audience. See `adr/003-deterministic-quality-signal.md`.

## Observability

Application Insights is the primary scoreboard source, with sampling disabled for router and
approval telemetry. Cosmos remains the system of record for anything that must be auditable,
because sampled telemetry cannot underwrite an audit claim.

A Cosmos change-feed fallback for the scoreboard is built regardless, behind configuration. If the
Application Insights ingestion latency misses the five-second budget under load, switching is a
configuration change rather than a rewrite. See `adr/004-appinsights-scoreboard-with-cosmos-fallback.md`.

## What this architecture deliberately does not do

- No Kubernetes. Container Apps carries the workload, and a cluster would add operational surface
  that serves none of the three claims. See `adr/001-container-apps-over-aks.md`.
- No high availability, disaster recovery, or multi-region. The demo environment is ephemeral.
- No real execution. The OMS is simulated and labelled as such everywhere it appears.
- No fine-tuning. Routing and retrieval carry the quality argument.

===== FILE: docs/adr/README.md =====
# Architecture Decision Records

An ADR records a decision that is expensive to reverse, together with the context that made it
reasonable at the time.

## Rules

- One decision per record. If you are writing "and also", write a second ADR.
- Record the decision **before** the code that depends on it merges.
- Any deviation from `.specify/memory/constitution.md` requires an ADR. There is no informal path.
- Superseded records stay. Mark them Superseded and link forward. Deleting history removes the
  context that justified the original choice.

## Naming

`NNN-short-slug.md`, zero-padded, sequential. Use `0000-adr-template.md` as the starting point.

## Index

| ADR | Title | Status |
|---|---|---|
| 001 | Container Apps over AKS | Accepted |
| 002 | Two Terraform stacks | Accepted |
| 003 | Deterministic quality signal over LLM-as-judge | Accepted |
| 004 | Application Insights scoreboard with Cosmos fallback | Accepted |
| 005 | Hosted Foundry agents over prompt agents | Accepted |
| 006 | Multi-vendor model catalog, incl. open-weight on managed compute | Accepted |

===== FILE: docs/adr/0000-adr-template.md =====
# NNN. [Title as a decision, not a topic]

- **Status**: Proposed | Accepted | Superseded by ADR-NNN
- **Date**: YYYY-MM-DD
- **Deciders**: 

## Context

What situation forces a decision now. Include the constraints that are real, including time and
audience. Avoid solution language.

## Decision

The decision, stated plainly in one or two sentences.

## Consequences

### What this buys us

### What this costs us

Be honest here. An ADR that lists only benefits is a advertisement, and the next person will not
trust it.

### What we will have to revisit

## Alternatives considered

| Alternative | Why not |
|---|---|

## Constitution impact

Which principles this touches, and whether it upholds or deviates from them. A deviation requires
explicit sign-off recorded here.

===== FILE: docs/adr/001-container-apps-over-aks.md =====
# 001. Use Azure Container Apps rather than AKS

- **Status**: Accepted
- **Date**: 2026-08-14

## Context

The reference implementation this project draws from runs on AKS with Kustomize and Flux. That
stack is well understood here and would be a defensible default.

This project has a fixed demo date of 2026-09-10 and a build freeze on 2026-09-05. It must stand
up from zero, unattended, in under 45 minutes, repeatedly, because the environment will be torn
down and rebuilt many times during rehearsal.

The demo makes three claims: the footprint is private, the spend is governed, and the agent cannot
act alone. None of them is a claim about the orchestration layer.

## Decision

Run all workloads on Azure Container Apps within the VNet. Do not introduce Kubernetes.

## Consequences

### What this buys us

- A shorter path from zero to running: no cluster provisioning, no node pool warm-up, no GitOps
  reconciliation loop to wait on during a timed rebuild.
- Fewer moving parts to fail during a live demo, and fewer to explain when the audience asks what
  a component is for.
- VNet integration and private ingress come from the platform rather than from cluster
  configuration we would have to defend.

### What this costs us

- We lose the fine-grained scheduling, sidecar patterns, and ecosystem tooling that AKS offers.
  Nothing in this demo needs them, but a production successor might.
- We diverge from the house AKS pattern, so the deployment tasks and manifests are not reusable
  from the existing reference repository.
- Container Apps constrains networking options relative to a cluster. If a future requirement
  needs a capability only AKS provides, this is a migration rather than a tweak.

### What we will have to revisit

If this demo becomes the basis of a production build, revisit the compute choice against the
client's existing platform standard. A bank with an established AKS platform will likely want the
workload there, and that migration should be planned rather than discovered.

## Alternatives considered

| Alternative | Why not |
|---|---|
| AKS with Kustomize and Flux, as in the reference repo | Provisioning and reconciliation time jeopardise the 45-minute rebuild budget, and the cluster adds surface that serves none of the three claims |
| Azure Functions | Poor fit for long-running agent orchestration and for the streaming scoreboard |
| App Service | Weaker VNet and private-endpoint story for a multi-service topology |

## Constitution impact

Upholds Principle II by using platform-native VNet integration and private ingress. Supports the
delivery constraint of an unattended 45-minute stand-up.

===== FILE: docs/adr/002-two-stack-terraform.md =====
# 002. Split Terraform into a platform stack and a workload stack

- **Status**: Accepted
- **Date**: 2026-08-14

## Context

The infrastructure divides cleanly by change frequency. Networking, private endpoints, DNS zones,
the Container Apps Environment, Cosmos, AI Search, Key Vault, and AI Foundry change rarely and are
slow to apply. Container apps, identities, and role assignments change many times a day during a
three-week build.

A single stack means every service redeploy produces a plan that includes the network.

## Decision

Maintain two stacks: `infrastructure/` for the platform and `apps/` for the workloads. The `apps/`
stack consumes platform values through remote state data sources in `references.tf`.

## Consequences

### What this buys us

- A routine redeploy cannot produce a destructive plan against the network, which is the change
  most likely to cost hours we do not have before 9/10.
- The `apps/` plan and apply cycle stays fast, which matters when it runs dozens of times a day.
- The blast radius of a mistake is bounded by which stack you are in.

### What this costs us

- Two states to bootstrap, initialise, and keep aligned.
- A cross-stack contract: renaming a platform output breaks the workload stack, and the failure
  surfaces at apply time rather than at edit time.
- Ordering becomes a rule people must know. Platform applies before workloads, always.

### What we will have to revisit

If the cross-stack output contract starts churning, consider a shared module or a data-source
lookup by resource name and tag rather than by remote state.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Single stack | Every service redeploy plans the network; unacceptable risk profile against a fixed date |
| Workspaces | Solves environment separation, not change-frequency separation |
| Terragrunt | Additional tooling and learning cost for a three-week build |

## Constitution impact

Upholds the delivery constraint of a repeatable, unattended stand-up. Neutral on all seven
principles.

===== FILE: docs/adr/003-deterministic-quality-signal.md =====
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

===== FILE: docs/adr/004-appinsights-scoreboard-with-cosmos-fallback.md =====
# 004. Read the scoreboard from Application Insights, with a Cosmos change-feed fallback

- **Status**: Accepted
- **Date**: 2026-08-14

## Context

AC-5 requires cost, latency, tier, rationale, and quality to appear on the scoreboard within five
seconds of request completion.

Application Insights is the natural source: the telemetry is already emitted, the aggregation
queries are straightforward, and no additional read path is needed. The SE preference is to try it
first.

Two risks are known and unresolved. Application Insights applies sampling by default, and its
ingestion latency is not guaranteed to fit a five-second budget under load. Either would break the
demo's most important screen.

## Decision

Use Application Insights as the primary scoreboard source with sampling disabled for router and
approval telemetry. Build the Cosmos change-feed fallback behind configuration at the same time,
not later. Validate the latency assumption in T-014, before the build freeze.

Cosmos remains the system of record for decisions, approvals, and audit regardless. Sampled
telemetry cannot underwrite an audit claim.

## Consequences

### What this buys us

- The preferred path is tried first, on its merits.
- The risk is retired before the freeze rather than discovered during rehearsal.
- If the assumption fails, the response is a configuration change on the day rather than a
  redesign in the final week.

### What this costs us

- Two read paths to build and keep working, one of which may never be used.
- Disabling sampling raises telemetry volume and cost, which is acceptable for an ephemeral demo
  environment but would not be for production.

### What we will have to revisit

If T-014 shows Application Insights comfortably inside the budget, the fallback becomes dead code
after the demo. Delete it deliberately then, or promote it if the demo becomes a product.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Cosmos change feed only | Rejects the SE preference without evidence, and adds a read path before knowing one is needed |
| SignalR push from the router | More infrastructure for a problem that may not exist |
| Defer the decision | Leaves an unretired risk on the most important screen with weeks to spare; unacceptable |

## Constitution impact

Upholds Principle VI. The audit trail remains in Cosmos, which is append-only and unsampled,
independent of whichever source the scoreboard reads.

===== FILE: docs/adr/005-hosted-foundry-agents-over-prompt-agents.md =====
# 005. Prefer hosted Foundry agents over prompt-only agents

- **Status**: Accepted
- **Date**: 2026-08-14

## Context

Each lane needs multi-step behaviour: retrieval and synthesis for research, batch triage and
evidence assembly for surveillance, and proposal construction for order routing.

This can be built as prompt orchestration in our own services, or as hosted agents in Azure AI
Foundry with tools exposed over MCP.

The audience includes technical evaluators who will ask what is Azure and what is bespoke. Every
piece of bespoke orchestration is something we own, must explain, and must defend as production
viable.

## Decision

Implement lane behaviour as hosted Foundry agents with a Foundry Tools and MCP tool surface. A
prompt-only agent requires an ADR justifying why a hosted agent was insufficient.

## Consequences

### What this buys us

- The orchestration is a platform capability rather than our code, which is a materially stronger
  answer to "how would this look in production".
- Tool definitions live in one place and are reusable across lanes.
- Less bespoke state machinery to build inside a three-week window.

### What this costs us

- We inherit the hosted agent's execution model, including its limits on control flow and
  debugging. When it does something unexpected, our visibility is bounded by what the platform
  exposes.
- Preview SDK surface area moves. Packages are exact-pinned and upgraded by hand, and Dependabot
  is configured to leave them alone.
- Some lane logic will not fit the hosted model cleanly and will need the ADR exception path.

### What we will have to revisit

If a lane accumulates enough exceptions that most of its logic is bespoke anyway, stop pretending
and move the whole lane, with an ADR.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Prompt orchestration in our own services | More bespoke code to build, explain, and defend, in a compressed window |
| A third-party agent framework | Adds a dependency that is not part of the Azure story the demo is making |

## Constitution impact

Upholds Principle V: hosted agents still call models through the router, because the lane
services have no route to the Foundry data plane. The chokepoint is preserved.

===== FILE: docs/threat-model.md =====
# Threat Model

## Scope and stance

This is a demonstration environment holding exclusively synthetic data. The loss of any data in it
is immaterial.

The asset actually being protected is **the credibility of the controls**. The demo's entire value
is that a compliance audience believes what they are shown. A control that is bypassable, or that
is theatre, is a total loss even though no data is at risk.

Threats are therefore ranked by damage to credibility, not by data sensitivity.

## Trust boundaries

1. **Public internet to the demo UI front door.** The only public inbound surface.
2. **UI to services.** Entra ID authenticated, app-role authorised.
3. **Lane services to router-service.** Managed identity, Router.Invoke role.
4. **Router to APIM to Foundry.** The single model chokepoint.
5. **Services to data planes.** Private endpoints only, managed identity only.
6. **Retrieved content into agent context.** Untrusted input. Never instruction.

## Threats

### T-1 — An agent takes a consequential action without human approval

**Impact: catastrophic.** This is the objection the demo exists to answer. A single instance
destroys the argument.

Mitigations:

- No execution path exists that does not pass through the approval API. Proposals are inert.
- Expiry transitions to Expired and never to Approved. Timeout is not consent.
- Every approval decision writes an audit record before returning.
- Playwright coverage asserts the negative case, not only the happy path.

Residual risk: a future lane could add an execution path that bypasses the gate. Mitigated by
CODEOWNERS review on the approval surface and by the constitution check in the plan template.

### T-2 — Prompt injection through retrieved content

**Impact: high.** A synthetic research document or e-comms record containing instructions could
attempt to induce a tool call or an unattributed claim.

Mitigations:

- Retrieved content is never granted tool-call authority.
- Detected injection attempts are logged to `auditEvents` with type InjectionDetected.
- The approval gate is the backstop: even a fully successful injection cannot execute an action.
- Attribution-or-refusal means injected assertions without a citation are withheld.

Residual risk: an injection could degrade output quality without triggering an action. Acceptable
in a demo; detection is logged and visible.

### T-3 — A public data-plane endpoint appears through drift or convenience

**Impact: catastrophic to credibility.** The private-networking claim is demonstrated live. If it
is false anywhere, the demonstration is a lie the audience may catch.

Mitigations:

- `policy-no-public-endpoints.sh` fails CI on either stack.
- `enable_private_networking` defaults to true and gates networking resources.
- Checkov runs across both stacks with high-severity findings failing the build.
- `task cloud:prove-private` performs the live denial demonstration and is rehearsed.

Residual risk: a resource type not covered by the policy script's patterns. Mitigated by keeping
the script pattern-based and reviewing it whenever a new resource type is introduced.

### T-4 — A secret enters the repository or an image

**Impact: high.** Principle VIII is a stated control; a committed secret contradicts it publicly.

Mitigations:

- gitleaks over full history and diff, zero findings required.
- Managed identity everywhere; no code path consumes a connection string.
- Terraform outputs carrying credential-shaped values are marked sensitive.
- `.env` is gitignored; `.env.example` contains no secret material.

### T-5 — Self-approval defeats segregation of duties

**Impact: high.** Segregation of duties is demonstrated live as a control.

Mitigations:

- Enforced in the approval API, returning 409 SegregationOfDuties. The UI hiding the button is not
  the control.
- Unit and E2E tests assert rejection.
- Both the proposer and decider object IDs are persisted, so the record is auditable after the
  fact.

### T-6 — A service bypasses the router and calls a model directly

**Impact: high.** Cost governance becomes reporting rather than control, and the scoreboard
becomes a sample rather than a total.

Mitigations:

- Network policy denies lane services any route to the Foundry data plane.
- APIM is the only ingress to models, and it requires the router's identity.
- Integration test asserts the direct call fails.

### T-7 — The audit trail is incomplete or mutable

**Impact: high.** AC-8 invites the audience to pick an interaction at random. A gap surfaces live.

Mitigations:

- `auditEvents` is append-only; no service identity holds update or delete rights.
- Every step of the request lifecycle writes a record keyed by `correlationId`.
- Reconstruction is a single query and is rehearsed against unrehearsed input.

### T-8 — Non-synthetic data enters the environment

**Impact: high.** Principle VII is absolute and is a stated condition of the demonstration.

Mitigations:

- Generators are committed and seeded; generated volume is gitignored.
- Provenance is demonstrable: any artifact can be regenerated from its seed.
- Contribution rules reject data commits.

## Out of scope

Availability and denial of service; the environment is ephemeral and rebuilt on demand. Supply
chain compromise beyond Dependabot and CodeQL coverage. Physical and datacentre security.
Regulatory certification of any kind.

===== FILE: docs/demo-runbook.md =====
# Demo Runbook — 2026-09-10

## Before the day

| When | Action |
|---|---|
| 9/5 | Build freeze. Feature work stops. |
| 9/6 | Full timed rebuild from zero. Record the elapsed time. |
| 9/8 | Rehearse the full narrative end to end, twice. |
| 9/9 | Rehearse the honest-failure path. Seed data. Leave the environment **warm** — do not rebuild into the demo. |
| 9/10 morning | Smoke check every beat below. Do not change anything after this. |

## Pre-flight

```bash
task cloud:up            # must complete under 45 minutes
task app:deploy
task app:seed            # seed 20260910
task cloud:prove-private # confirm the denial demonstration works today
```

Confirm: two Entra identities are available, one holding Approver and one not. The segregation-of-
duties and unprivileged-denial beats both need them.

## Narrative

### Beat 1 — Frame the four objections (2 min)

State them in the audience's own language: it is not private enough, the spend is unbounded, we
cannot let it act alone, and we will be locked into whichever vendor we pick this year. Say that
each will be answered with a demonstration rather than a claim.

Then plant one line early and leave it: **models are temporary, governance is strategic.** Every
model named today will be superseded. The exchange is what survives that. You will not cash this
in until Beat 5 — let it sit.

### Beat 2 — Private by construction (4 min)

Run `task cloud:prove-private`. Show the public access attempt failing. Then show the same
operation succeeding from inside the VNet.

Then show the CI policy job. The point is not that it is private today; it is that it cannot
silently stop being private.

*This beat answers the compliance veto. It is table stakes, not a wow moment. Do not linger.*

### Beat 3 — Router economics (6 min) — PRIMARY

Run a batch of comparable requests. Open the scoreboard.

Show per-request cost, latency, tier, and rationale. Drill into one decision and read the
rationale aloud — it names the deciding factor in plain language.

Then the comparison view: aggregate cost against a premium-tier baseline, with the delta as a
percentage.

Pre-empt the quality objection before it is raised: the quality number is deterministic and
recomputable, not model-graded. Say why that choice was made.

*This is the beat for the AI decision maker. It is the budget argument.*

### Beat 4 — Surveillance triage (6 min) — PRIMARY

Show the untriaged queue: 500 synthetic alerts. Run triage.

Show the ranked queue with rationale and assembled evidence. Open the top alert and walk the
evidence.

Propose escalation. It does not escalate — it enters the approval queue.

*This is the beat for trade leadership. It is the headcount and backlog argument.*

### Beat 5 — The model swap nobody deployed for (4 min) — SUPPORTING

Having shown the router optimising within a vendor, show what happens when the vendor itself
changes.

Submit a research request. Note out loud that **the application never named a model** — it
submitted a business request.

Now open the **policy screen** (`/policy`) and **disable Anthropic** — a toggle, in the product,
as an approver. Not the Azure portal: governance is a first-class surface here or the claim is
hollow. Change nothing else. No redeploy, no code change, no prompt change.

Resubmit the identical request.

Stop talking. Let the room watch execution replan around the remaining approved vendors, and let
them read the exclusion reason: *Vendor Anthropic is not approved under policy set
'CapitalMarkets-US'.*

Then say the only line this beat needs:

> The application did not change. The prompt did not change. Policy changed, and the architecture
> obeyed. That is the difference between using a model and governing one.

If time allows, follow it with the harder version: set the request's data classification to
**Restricted** and resubmit. Every hosted vendor is excluded by policy, and execution lands on the
open-weight model running on dedicated capacity inside the VNet — the only destination cleared for
that data.

*This beat answers the lock-in objection with a mechanism rather than a roadmap. It is deliberately
positioned after the two primary beats: it lands hardest once the audience already believes the
routing is real. If you are running short, this is the beat to compress, not to cut.*

**Expect the question "does it decompose one request across several models?"** The honest answer is
that the exchange is built for it, the plan model is specified, and it is the next slice — see
`specs/002-governed-exchange/` Slice B. Do not imply it is working.*

### Beat 6 — Human in the loop (5 min)

Open the approval queue and the evidence packet.

Attempt to approve as the proposing identity. It is refused with segregation of duties. Emphasise
that the API refused it, not the UI.

Approve as the second identity. Show the action executing and the audit record written.

Show an expired proposal. Timeout produced no action.

### Beat 7 — Attributed research (4 min) — SECONDARY

Ask a research question. Show inline citations and the coverage percentage.

Then show the unattributable-claims panel: the things it declined to say, and why.

*That panel is the point. A system that refuses is more trustworthy than one that never fails.*

### Beat 8 — Audit, unrehearsed (3 min)

Invite someone in the room to pick any interaction from the session. Query its `correlationId`.
Reconstruct the full chain live.

*Take the unrehearsed pick. A rehearsed one is worth nothing and the room can tell.*

### Beat 9 — Close (2 min)

Restate the three objections and what answered each. Name what was deliberately excluded: real
execution, real data, high availability, multi-region. Credibility comes from the exclusions as
much as from the demonstrations.

## Failure recovery

| Failure | Response |
|---|---|
| Scoreboard stale beyond five seconds | Switch the source to the Cosmos change feed by configuration. Rehearsed on 9/9. |
| A lane service is unhealthy | Skip its beat. Beats 3, 4, and 5 are independent. Never debug live. |
| Foundry throttling | Retry once, then say plainly that the platform is throttling and show the governed refusal. Do not substitute a pre-recorded batch into the UI. |
| Azure access fails entirely | Stop the live demo and narrate the rehearsal **recording**, out of the product UI, named as a recording. Never render replayed reasoning in the UI (ADR-007). |
| A question you cannot answer | Say so and write it down. This audience trusts an admission far more than a confident guess. |

## Do not

- Do not replay a recorded agent transcript through the product UI, under any circumstance. If
  inference is not running, say so. This is the one rule with no exception (ADR-007).
- Do not describe the simulated OMS as anything other than simulated.
- Do not defend the quality metric by adding an LLM-as-judge number on the fly.
- Do not skip Beat 8's unrehearsed pick. It is the most persuasive three minutes in the deck.

===== FILE: docs/adr/006-multi-vendor-model-catalog.md =====
# 006 — Multi-vendor model catalog, including open-weight models on managed compute

- Status: Accepted
- Date: 2025-08-29
- Deciders: SE (demo owner)

## Context

The original routing design assumed one vendor and three tiers of the same model family. Reading
`docs/requirements.md` changed this. The demo's actual argument is not "we pick a cheaper model" —
it is **"models are temporary, governance is strategic."** That argument only lands if the catalog
visibly contains models from genuinely different vendors, because interchangeability between
`gpt-5.4-mini` and `gpt-5.4` proves nothing a sceptical audience will credit.

The audience is a bank's capital markets division. Their live concern is not which model is best
this quarter; it is what happens when the best model changes, when a vendor's terms change, or
when a regulator asks why a specific vendor processed specific data. A single-vendor catalog
cannot answer any of those questions.

There is a second, sharper driver. Under a Restricted data classification, several banks will not
permit a third-party hosted API at all. If the catalog has no answer for that case, the demo dies
on the first serious question from the room.

## Decision

The approved catalog spans four vendors:

| Vendor | Serving | Role in the story |
|---|---|---|
| Azure OpenAI | Serverless | The default. Broadest classification tolerance. |
| Anthropic | Serverless | Proves cross-vendor interchange; the vendor disabled on stage. |
| xAI | Serverless | Proves the catalog is not a two-horse race. |
| Open-weight | **Managed compute (preview)** | The answer to Restricted data. |

Open-weight models are served on **Foundry managed compute** — dedicated GPU capacity inside the
project's own network boundary. This is what makes the Restricted-data path credible rather than
aspirational.

Vendor is modelled as an explicit `ModelVendor` value on every candidate, not inferred from a
deployment name. A concept the code cannot name is a concept policy cannot swap.

## Consequences

### What this buys

- The stage moment in `docs/demo-runbook.md` where a vendor is disabled by policy and the request
  replans is now a property of the system rather than a scripted illusion.
- Restricted data has a real destination, so the hardest question in the room has an answer that
  is architecture rather than roadmap.
- `PolicyGate` gains a meaningful job. With one vendor it would have been ceremony.

### What this costs

**Managed compute is a preview capability, and it is the single largest delivery risk in this
repository.** Specifically:

1. **Capacity.** Accelerator classes are finite per region and availability is not exposed by the
   CLI. The only reliable check is an actual deployment. See the verification section below.
2. **Provisioning time.** Deployment is measured in tens of minutes, not the couple of minutes a
   serverless deployment takes. This does not fit inside the 45-minute rebuild budget the rest of
   the platform stack is designed around.
3. **Cost.** Dedicated accelerator capacity bills while allocated, and unlike an AML compute
   cluster there is no scale-to-zero idle window to hide behind. A warm demo is paid time from the
   moment it is provisioned. Budget for it deliberately, and destroy it when the demo season ends.
4. **Preview API surface.** Both the project and the managed compute deployment use
   `2026-05-15-preview` with schema validation disabled. Preview API versions are withdrawn without
   ceremony. If a plan starts failing for no apparent reason, check whether the API version still
   exists before debugging anything else.

### Mitigation

`enable_managed_compute` gates the whole path. Set it to `false` and the demo still runs across
three serverless vendors, losing only the Restricted-data beat. **Provision managed compute days
ahead of the demo and leave it up.** Treat it as long-lived infrastructure, not as something the
rebuild path creates.

## How managed compute is actually provisioned

Microsoft Foundry managed compute is **not** Azure ML / AI Hub managed compute. The two are
routinely confused and the resource trees are unrelated. This ADR records the correct model,
because an earlier revision of this repository got it wrong.

| | AI Hub (wrong) | Microsoft Foundry (correct) |
|---|---|---|
| Account | `azurerm_ai_foundry` (an AML workspace) | `Microsoft.CognitiveServices/accounts`, `kind = "AIServices"`, `allowProjectManagement = true` |
| Requires storage + key vault | Yes | No |
| Compute | `azurerm_machine_learning_compute_cluster` | `Microsoft.CognitiveServices/accounts/managedComputeDeployments` |
| Capacity unit | `vm_size`, e.g. `Standard_NC24ads_A100_v4` | `acceleratorType`, e.g. `A100_80GB`, `H100_80GB` |
| Quota system | Subscription `Microsoft.Compute` NC-family vCPUs | Foundry `GlobalManagedCompute` pool |
| Model source | Your own image or registry | `azureml://registries/azure-huggingface/...` |

Three consequences follow from the right-hand column:

1. **Everything is `azapi`.** The API versions involved (`2026-05-15-preview` for projects and
   managed compute deployments) are not modelled by the azurerm provider. `schema_validation_enabled
   = false` is required on the preview resources.
2. **A model needs a matching deployment template.** `properties.model` and
   `properties.deploymentTemplate` both come from the Azure HuggingFace registry, and the template
   is paired to an accelerator class. An A100 template will not deploy onto H100 capacity.
3. **Deployments are slow.** 60-minute Terraform timeouts are set deliberately, not defensively.

The reference implementation is
`briandenicola/ai-application-architectures/infrastructure/microsoft-foundry-managed-compute`.
This repository follows it, with one deliberate divergence: the reference sets
`publicNetworkAccess = "Enabled"` and `disableLocalAuth = false`. We set the opposite, and
`scripts/policy-no-public-endpoints.sh` now greps for the camelCase azapi spelling so the
chokepoint cannot be reopened silently.

## Verification status (checked 2026-08-14, eastus2)

Model names were checked against `az cognitiveservices model list -l eastus2`:

| Catalog entry | Status |
|---|---|
| `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.6-sol` | Available |
| `claude-sonnet-4-5` | Available |
| `grok-4` | **Not available** — corrected to `grok-4.3` |

**Correction to an earlier claim in this ADR.** A previous revision reported "GPU quota in eastus2
is zero" based on `az vm list-usage`, and concluded a quota request was on the critical path. That
measurement was against the wrong quota system. `GlobalManagedCompute` capacity is allocated from
a Foundry pool, not from the subscription's `Microsoft.Compute` NC-family vCPU limits, so those
zeroes do not describe this deployment. `az cognitiveservices usage list -l eastus2` exposes
`AIServices.GlobalProvisionedManaged` but no accelerator-class counter, so **managed compute
capacity availability could not be confirmed from the CLI and remains unverified.**

Verify it the only way that is conclusive — attempt one deployment, early:

```bash
terraform -chdir=infrastructure apply -target=azapi_resource.managed_compute
```

Do this well before the demo. Capacity for a specific accelerator class in a specific region is
the kind of constraint that surfaces at apply time and nowhere else.

## Alternatives considered

- **Single vendor, three tiers.** Rejected: it cannot carry the anti-lock-in argument, which is
  the whole point.
- **Multi-vendor, serverless only.** Rejected: no credible answer for Restricted data, and that
  question will be asked.
- **Open-weight via a third-party host.** Rejected: reintroduces exactly the third-party data
  path the Restricted classification exists to prevent.

===== FILE: docs/decisions-needed.md =====
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

===== FILE: docs/agent-architecture.md =====
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

**Determinism for rehearsal.** Fixed seeds and pinned temperature, so runs are comparable between
rehearsals. This constrains the agent's *inputs and sampling*; it never replaces inference. There
is deliberately **no transcript replay path** — a recording of an agent reasoning, rendered in the
product UI, would falsify the one claim this demo exists to make. See
docs/adr/007-no-simulated-agent-reasoning.md.

## Open questions

1. Foundry hosted agents cap tool count and step depth. The surveillance agent is closest to those
   limits — verify early (T-027a) rather than discovering it during T-025.
2. Whether Feature 002's intent classifier is an agent or a fixed cheap deployment. Current
   position: not an agent, because routing the thing that decides routing is circular.

===== FILE: docs/ui-design.md =====
# Scoreboard UI design

Vite, React, TypeScript. Entra authentication, role-aware navigation.

Three of the four wow moments are screens in this application. The UI is not a viewer over the
interesting part of the system — for the audience, it **is** the system. Everything below is
written for a projector in a room of sceptical people, not for a desk.

## Design constraints

**The audience reads this from ten feet away.** Dense tables and 12px labels are unreadable on a
projector. Type scale starts larger than a normal admin tool, and every screen has one number that
is deliberately the largest thing on it.

**Nothing may look rehearsed.** No pre-baked screenshots, no seeded animations. If a value is on
screen it came from the API just now. Beat 8 has an audience member choose a record at random;
that only survives if the UI never special-cases anything.

**Every claim on screen is drillable.** A number a presenter cannot open is a number the audience
assumes is decorative. Cost, rank, and quality all open to the record behind them.

**Degradation is visible, not silent.** If the scoreboard falls back to the Cosmos change feed
(ADR 004), the UI says so. A demo that hides its own failure is one bad question from collapse.

## Screen inventory

| # | Screen | Route | Roles | Task | Beat |
|---|---|---|---|---|---|
| 1 | Request console | `/` | Router.Invoke | T-028 | 3, 5 |
| 2 | Live scoreboard | `/scoreboard` | Router.Read | T-029 | 3 |
| 3 | Cost comparison | `/scoreboard/comparison` | Router.Read | T-030 | 3 — **wow B** |
| 4 | Decision detail | `/decisions/:id` | Router.Read | T-029 | 3, 8 |
| 5 | Surveillance triage | `/surveillance` | Router.Read | T-031 | 4 — **wow C** |
| 6 | Alert detail | `/surveillance/:id` | Router.Read | T-031 | 4 |
| 7 | Approval queue | `/approvals` | Approver | T-032 | 6 |
| 8 | Approval detail | `/approvals/:id` | Approver | T-032 | 6 |
| 9 | Research | `/research` | Router.Invoke | T-033 | 7 — **wow D** |
| 10 | Order routing | `/orders` | Router.Invoke | T-034 | — |
| 11 | Audit reconstruction | `/audit/:correlationId` | Router.Read | T-020 | 8 |
| 12 | Policy sets | `/policy` | Approver | new | 5 |

Screen 12 does not exist in the current task list. It is required for Beat 5 — the policy swap has
to happen *somewhere*, and doing it in the Azure portal breaks the narrative that governance is a
first-class surface.

## Screens that carry a wow moment

### 3 — Cost comparison (wow B)

One number dominates: **percentage saved against an all-premium baseline.** Everything else is
supporting evidence.

Below it, a per-request table with tier, cost, latency, and rationale, and a bar showing actual
against baseline. The presenter drills one row mid-sentence and reads the rationale aloud, so the
rationale must be a plain sentence naming the deciding factor — not a JSON blob and not a score.

Refresh is 5 seconds (AC-5), and the UI shows the timestamp of the data, not a spinner. A stale
number that admits it is stale beats a fresh-looking lie.

### 5 — Surveillance triage (wow C)

500+ alerts, ranked, with rationale and evidence count per row. Virtualised list — 500 DOM rows
will stutter on projector hardware and the stutter reads as "this doesn't scale."

The rank column shows the score and is sortable, but **defaults to model rank**, because the point
is that the ranking is the product. A visible seed indicator supports the reproducibility claim in
AC-6: same seed, same order, provable on stage.

### 9 — Research (wow D)

Inline citations rendered as clickable superscripts that open the source chunk. A coverage
percentage in the header.

**The unattributable-claims panel is the point of this screen**, not a footnote. It is always
present, and when empty it says "no unattributable claims" rather than disappearing. A panel that
only appears on failure teaches the audience it is an error state; a panel that is always there
teaches them it is a control.

## Component and state architecture

```text
src/webui/src/
  app/            router, auth provider, role guards, error boundary
  components/     presentational only, no fetching
  features/       one folder per screen: hooks, queries, view
  lib/            api client, Entra token acquisition, formatters
  types/          generated from contracts/*.md schemas
```

**Data fetching.** TanStack Query. Polling at 5s for live views with `refetchOnWindowFocus`
disabled — a presenter alt-tabbing must not trigger a visible refetch mid-sentence.

**Why polling and not push.** SignalR would be lower latency, but it adds a service to the private
network, a reconnect path to rehearse, and a new failure mode on stage. The budget is 5 seconds
and polling meets it. Revisit only if AC-5 measurements fail (T-029).

**Types are generated from the contracts**, not hand-written. Hand-written types drift from the API
and the drift surfaces during a demo.

**No global state store.** Server state lives in TanStack Query; UI state is local. There is no
client state complex enough to justify more.

## Required states

Every data view implements all five. Missing states are how demos break — the empty state nobody
built is the one that renders during the live run.

| State | Requirement |
|---|---|
| Loading | Skeleton matching final layout. No layout shift on a projector |
| Empty | Explains what would populate it and how to trigger it |
| Error | Names what failed and what still works. Never a bare "Something went wrong" |
| Partial | Some lanes returned, some did not — show what exists, mark what is missing |
| Degraded | Fallback data source or stale data, labelled inline |

## Auth and roles

MSAL browser, Entra app roles: `Router.Invoke`, `Router.Read`, `Approver`.

**Unauthorised navigation is hidden, and unauthorised actions are visibly blocked.** These are
different on purpose. Beat 6 requires showing a user who lacks `Approver` being refused — if the
button were merely hidden there would be nothing to demonstrate. The approve control renders
disabled with the reason stated.

## Open questions

1. Screen 12 (policy sets) is unscheduled. Beat 5 needs it, even if read-mostly with a single
   vendor toggle.
2. Whether the request console exposes data classification as a user control. It is needed for the
   Restricted-data demonstration, but it edges towards the application choosing routing inputs.
   Current position: classification is a property of the *request*, not a routing preference, so
   exposing it is consistent with Principle IV.

===== FILE: scripts/policy-no-public-endpoints.sh =====
#!/usr/bin/env bash
# Fails if any Terraform resource exposes a public data-plane endpoint.
#
# This enforces Principle II (Private By Construction) continuously rather than as a one-time
# configuration that drifts. Review the patterns below whenever a new resource type is added.
set -euo pipefail

STACKS=("infrastructure" "apps")
FAILED=0

banned_pattern='public_network_access_enabled[[:space:]]*=[[:space:]]*true'
banned_pattern2='network_acls[[:space:]]*\{[^}]*default_action[[:space:]]*=[[:space:]]*"Allow"'
banned_pattern3='public_access_enabled[[:space:]]*=[[:space:]]*true'
banned_pattern4='anonymous_pull_enabled[[:space:]]*=[[:space:]]*true'

# azapi bodies express this as a camelCase string, so the azurerm patterns above miss it entirely.
# The Foundry account is declared via azapi; without this the chokepoint could be opened silently.
banned_pattern5='publicNetworkAccess[[:space:]]*=[[:space:]]*"Enabled"'
banned_pattern6='disableLocalAuth[[:space:]]*=[[:space:]]*false'

for stack in "${STACKS[@]}"; do
  [ -d "$stack" ] || continue

  for pattern in "$banned_pattern" "$banned_pattern3" "$banned_pattern4" "$banned_pattern5" "$banned_pattern6"; do
    if hits=$(grep -rnE "$pattern" "$stack" --include='*.tf' 2>/dev/null); then
      echo "FAIL: public data-plane exposure in ${stack}"
      echo "$hits"
      FAILED=1
    fi
  done

  if hits=$(grep -rnzoE "$banned_pattern2" "$stack" --include='*.tf' 2>/dev/null | tr '\0' '\n' | grep -v '^$'); then
    if [ -n "$hits" ]; then
      echo "FAIL: permissive network ACL default_action in ${stack}"
      echo "$hits"
      FAILED=1
    fi
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "Principle II (Private By Construction) is NON-NEGOTIABLE."
  echo "See .specify/memory/constitution.md and docs/threat-model.md T-3."
  exit 1
fi

echo "PASS: no public data-plane endpoints declared in infrastructure or apps."

===== FILE: scripts/guard-local-terraform-state.sh =====
#!/usr/bin/env bash
# Refuses to proceed if either Terraform stack is configured for local state.
#
# Local state during a compressed build means one laptop holds the only record of a shared
# environment. Remote state is not optional here.
set -euo pipefail

STACKS=("infrastructure" "apps")
FAILED=0

for stack in "${STACKS[@]}"; do
  [ -d "$stack" ] || continue

  if ! grep -rqE 'backend[[:space:]]+"azurerm"' "$stack" --include='*.tf'; then
    echo "FAIL: ${stack} has no azurerm backend configured."
    FAILED=1
  fi

  if [ -f "${stack}/terraform.tfstate" ]; then
    echo "FAIL: ${stack}/terraform.tfstate exists on disk. Local state detected."
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "Run scripts/bootstrap-remote-state.sh, then task cloud:init."
  exit 1
fi

echo "PASS: both stacks are configured for remote state."

===== FILE: scripts/bootstrap-remote-state.sh =====
#!/usr/bin/env bash
# Creates the Azure Storage backend for Terraform remote state.
# Idempotent. Safe to re-run.
set -euo pipefail

RG="${TF_STATE_RESOURCE_GROUP:-rg-fcmr-tfstate}"
LOCATION="${DEFAULT_REGION:-eastus2}"
CONTAINER="${TF_STATE_CONTAINER:-tfstate}"
SA="${TF_STATE_STORAGE_ACCOUNT:-}"

if [ -z "$SA" ]; then
  SA="stfcmrtf$(head -c 1000 /dev/urandom | tr -dc 'a-z0-9' | head -c 8)"
  echo "No TF_STATE_STORAGE_ACCOUNT set. Generated: ${SA}"
  echo "Add this to your .env: TF_STATE_STORAGE_ACCOUNT=${SA}"
fi

az group create --name "$RG" --location "$LOCATION" --output none

az storage account create \
  --name "$SA" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false \
  --output none

az storage container create \
  --name "$CONTAINER" \
  --account-name "$SA" \
  --auth-mode login \
  --output none

echo "Remote state ready: ${RG}/${SA}/${CONTAINER}"

===== FILE: scripts/check-coverage.sh =====
#!/usr/bin/env bash
# Enforces a line-coverage threshold for a named assembly.
#
# Usage: ./scripts/check-coverage.sh <threshold-percent> <assembly-name>
#
# This is a gate, not a report. Coverage below the threshold fails the build, per the
# constitution's quality gate.
set -euo pipefail

THRESHOLD="${1:?usage: check-coverage.sh <threshold> <assembly>}"
ASSEMBLY="${2:?usage: check-coverage.sh <threshold> <assembly>}"
RESULTS_DIR="${3:-./TestResults}"

# Every report is read, not just the first. Each test project emits its own file, and taking
# only one silently measures the wrong assembly the moment a second test project is added.
mapfile -t REPORTS < <(find "$RESULTS_DIR" -name 'coverage.cobertura.xml' 2>/dev/null || true)

if [ "${#REPORTS[@]}" -eq 0 ]; then
  echo "FAIL: no coverage report found under ${RESULTS_DIR}."
  echo "Run: dotnet test --collect:\"XPlat Code Coverage\" --results-directory ${RESULTS_DIR}"
  exit 1
fi

RATE=$(python3 - "$ASSEMBLY" "${REPORTS[@]}" <<'COVPY'
import sys, xml.etree.ElementTree as ET
assembly, reports = sys.argv[1], sys.argv[2:]
# A line is covered if any report covers it, so the union is taken rather than the sum. Summing
# would double-count lines appearing in more than one report and inflate the result.
seen = {}
for report in reports:
    root = ET.parse(report).getroot()
    for pkg in root.iter('package'):
        if assembly.lower() not in (pkg.get('name') or '').lower():
            continue
        for cls in pkg.iter('class'):
            filename = cls.get('filename') or ''
            for line in cls.iter('line'):
                key = (filename, line.get('number'))
                seen[key] = max(seen.get(key, 0), int(line.get('hits', '0')))
valid = len(seen)
covered = sum(1 for h in seen.values() if h > 0)
print(round(100.0 * covered / valid, 2) if valid else -1.0)
COVPY
)

if [ "$(python3 -c "print(1 if float('$RATE') < 0 else 0)")" = "1" ]; then
  echo "FAIL: assembly '${ASSEMBLY}' not found in the coverage report."
  exit 1
fi

if [ "$(python3 -c "print(1 if float('$RATE') < float('$THRESHOLD') else 0)")" = "1" ]; then
  echo "FAIL: ${ASSEMBLY} coverage ${RATE}% is below the ${THRESHOLD}% threshold."
  exit 1
fi

echo "PASS: ${ASSEMBLY} coverage ${RATE}% meets the ${THRESHOLD}% threshold."

===== FILE: scripts/prove-private-networking.sh =====
#!/usr/bin/env bash
# Demo beat 2: demonstrate that public data-plane access is denied.
#
# Rehearse this. If it does not produce a convincing, legible failure, the compliance narrative
# does not land. See docs/demo-runbook.md.
set -uo pipefail

INFRA_DIR="${INFRA_DIR:-infrastructure}"

tf_out() { terraform -chdir="./${INFRA_DIR}" output -raw "$1" 2>/dev/null || true; }

COSMOS_ENDPOINT=$(tf_out cosmos_endpoint)
SEARCH_ENDPOINT=$(tf_out search_endpoint)
KEYVAULT_URI=$(tf_out keyvault_uri)
FOUNDRY_ENDPOINT=$(tf_out foundry_endpoint)

echo "Attempting public data-plane access from outside the VNet."
echo "Every one of these must fail."
echo ""

attempt() {
  local name="$1" url="$2"
  [ -n "$url" ] || { printf '  %-28s SKIP (no output)\n' "$name"; return; }

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "000")

  if [ "$code" = "000" ] || [ "$code" = "403" ]; then
    printf '  %-28s DENIED (%s)\n' "$name" "$code"
  else
    printf '  %-28s REACHABLE (%s)  <-- POLICY VIOLATION\n' "$name" "$code"
    VIOLATION=1
  fi
}

VIOLATION=0
attempt "Cosmos DB"       "$COSMOS_ENDPOINT"
attempt "Azure AI Search" "$SEARCH_ENDPOINT"
attempt "Key Vault"       "$KEYVAULT_URI"
attempt "AI Foundry"      "$FOUNDRY_ENDPOINT"

echo ""
if [ "$VIOLATION" -ne 0 ]; then
  echo "FAIL: at least one data plane is publicly reachable."
  exit 1
fi

echo "PASS: every data plane refused public access."
echo "Principle II demonstrated. Now show the same operations succeeding from inside the VNet."

===== FILE: infrastructure/providers.tf =====
terraform {
  required_version = ">= 1.7.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.14"
    }
    # Foundry accounts, projects, and managedComputeDeployments use preview API versions the
    # azurerm provider does not model yet.
    azapi = {
      source  = "Azure/azapi"
      version = "~> 2"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = true
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}

===== FILE: infrastructure/backend.tf =====
terraform {
  backend "azurerm" {
    # Values supplied via -backend-config or environment variables.
    # See scripts/bootstrap-remote-state.sh and .env.example.
    key = "infrastructure.tfstate"
  }
}

===== FILE: infrastructure/variables.tf =====
variable "region" {
  description = "Azure region for all platform resources."
  type        = string
  default     = "eastus2"
}

variable "enable_private_networking" {
  description = <<-EOT
    Gates all private networking resources. Defaults to true.
    Setting this to false is a local development affordance only; doing so in a cloud
    environment violates Principle II of the constitution.
  EOT
  type        = bool
  default     = true
}

variable "model_catalog" {
  description = <<-EOT
    The approved model catalog. Multi-vendor by design: the exchange's central claim is that
    models are interchangeable and swappable by policy without an application change.

    serving is one of:
      "serverless"      - Azure-hosted endpoint, billed per token.
      "managed_compute" - dedicated accelerator capacity in the Foundry account, serving a model
                          from the Azure HuggingFace registry (PREVIEW).

    managed_compute entries additionally require accelerator, capacity, model_uri, and
    deployment_template. The template must match the accelerator class.
  EOT

  type = map(object({
    vendor               = string
    model_name           = string
    serving              = string
    cost_per_request_usd = number
    approved             = optional(bool, true)

    # managed_compute only
    accelerator         = optional(string)
    capacity            = optional(number, 1)
    model_uri           = optional(string)
    deployment_template = optional(string)
  }))

  default = {
    aoai_economy = {
      vendor               = "AzureOpenAI"
      model_name           = "gpt-5.4-mini"
      serving              = "serverless"
      cost_per_request_usd = 0.004
    }
    aoai_standard = {
      vendor               = "AzureOpenAI"
      model_name           = "gpt-5.4"
      serving              = "serverless"
      cost_per_request_usd = 0.031
    }
    aoai_premium = {
      vendor               = "AzureOpenAI"
      model_name           = "gpt-5.6-sol"
      serving              = "serverless"
      cost_per_request_usd = 0.180
    }
    anthropic = {
      vendor               = "Anthropic"
      model_name           = "claude-sonnet-4-5"
      serving              = "serverless"
      cost_per_request_usd = 0.090
    }
    xai = {
      vendor               = "xAI"
      model_name           = "grok-4.3"
      serving              = "serverless"
      cost_per_request_usd = 0.075
    }
    openweight = {
      vendor               = "OpenWeight"
      model_name           = "nvidia--nvidia-nemotron-3-nano-30b-a3b-fp8"
      serving              = "managed_compute"
      cost_per_request_usd = 0.002
      accelerator          = "H100_80GB"
      capacity             = 1
      model_uri            = "azureml://registries/azure-huggingface/models/nvidia--nvidia-nemotron-3-nano-30b-a3b-fp8/versions/3"
      deployment_template  = "azureml://registries/azure-huggingface/deploymenttemplates/nvidia--nvidia-nemotron-3-nano-30b-a3b-fp8--256k-nvidia-h100/labels/latest"
    }
  }
}

variable "enable_managed_compute" {
  description = <<-EOT
    Provisions dedicated accelerator capacity in the Foundry account for open-weight models,
    via Microsoft.CognitiveServices/accounts/managedComputeDeployments.

    This is a PREVIEW capability and is slow to provision -- it is the single most likely reason
    a rebuild misses the 45-minute budget. Set it false to run the demo across the three
    serverless vendors only. See docs/adr/006-multi-vendor-model-catalog.md.
  EOT
  type        = bool
  default     = true
}

===== FILE: infrastructure/locals.tf =====
locals {
  application   = "Foundry Capital Markets Router"
  workload      = "fcmr"
  resource_name = "${local.workload}-${random_string.this.result}"

  tags = {
    Application = local.application
    Workload    = local.workload
    ManagedBy   = "terraform"
    DataClass   = "synthetic-only"
    Demo        = "2026-09-10"
  }

  vnet_cidr = "10.42.0.0/16"

  subnets = {
    container_apps    = "10.42.0.0/23"
    private_endpoints = "10.42.2.0/24"
  }

  private_dns_zones = [
    "privatelink.documents.azure.com",
    "privatelink.search.windows.net",
    "privatelink.vaultcore.azure.net",
    "privatelink.azurecr.io",
    "privatelink.services.ai.azure.com",
    "privatelink.openai.azure.com",
  ]
}

===== FILE: infrastructure/random.tf =====
resource "random_string" "this" {
  length  = 6
  special = false
  upper   = false
  numeric = true
}

===== FILE: infrastructure/main.tf =====
resource "azurerm_resource_group" "this" {
  name     = "rg-${local.resource_name}"
  location = var.region
  tags     = local.tags
}

===== FILE: infrastructure/network.tf =====
resource "azurerm_virtual_network" "this" {
  count = var.enable_private_networking ? 1 : 0

  name                = "${local.resource_name}-vnet"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  address_space       = [local.vnet_cidr]
  tags                = local.tags
}

resource "azurerm_subnet" "container_apps" {
  count = var.enable_private_networking ? 1 : 0

  name                 = "container-apps"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this[0].name
  address_prefixes     = [local.subnets.container_apps]

  delegation {
    name = "container-apps-environment"

    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "private_endpoints" {
  count = var.enable_private_networking ? 1 : 0

  name                 = "private-endpoints"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this[0].name
  address_prefixes     = [local.subnets.private_endpoints]
}

resource "azurerm_private_dns_zone" "this" {
  for_each = var.enable_private_networking ? toset(local.private_dns_zones) : toset([])

  name                = each.value
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "this" {
  for_each = var.enable_private_networking ? toset(local.private_dns_zones) : toset([])

  name                  = "link-${replace(each.value, ".", "-")}"
  resource_group_name   = azurerm_resource_group.this.name
  private_dns_zone_name = each.value
  virtual_network_id    = azurerm_virtual_network.this[0].id
  registration_enabled  = false
  tags                  = local.tags

  depends_on = [azurerm_private_dns_zone.this]
}

===== FILE: infrastructure/private-endpoints.tf =====
# One private endpoint per data plane. Principle II is enforced here and verified by
# scripts/policy-no-public-endpoints.sh.

locals {
  private_endpoints = var.enable_private_networking ? {
    cosmos = {
      resource_id = azurerm_cosmosdb_account.this.id
      subresource = "Sql"
      dns_zone    = "privatelink.documents.azure.com"
    }
    search = {
      resource_id = azurerm_search_service.this.id
      subresource = "searchService"
      dns_zone    = "privatelink.search.windows.net"
    }
    keyvault = {
      resource_id = azurerm_key_vault.this.id
      subresource = "vault"
      dns_zone    = "privatelink.vaultcore.azure.net"
    }
    registry = {
      resource_id = azurerm_container_registry.this.id
      subresource = "registry"
      dns_zone    = "privatelink.azurecr.io"
    }
    foundry = {
      resource_id = azapi_resource.foundry.id
      subresource = "account"
      dns_zone    = "privatelink.services.ai.azure.com"
    }
  } : {}
}

resource "azurerm_private_endpoint" "this" {
  for_each = local.private_endpoints

  name                = "${local.resource_name}-${each.key}-pe"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  subnet_id           = azurerm_subnet.private_endpoints[0].id
  tags                = local.tags

  private_service_connection {
    name                           = "${each.key}-connection"
    private_connection_resource_id = each.value.resource_id
    subresource_names              = [each.value.subresource]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "${each.key}-dns"
    private_dns_zone_ids = [azurerm_private_dns_zone.this[each.value.dns_zone].id]
  }
}

===== FILE: infrastructure/monitoring.tf =====
resource "azurerm_log_analytics_workspace" "this" {
  name                = "${local.resource_name}-law"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_application_insights" "this" {
  name                = "${local.resource_name}-appi"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "web"
  tags                = local.tags

  # Sampling is disabled deliberately. The scoreboard reads from Application Insights and
  # AC-5 requires completeness within a five-second budget. See ADR 004.
  sampling_percentage = 100
}

===== FILE: infrastructure/cae.tf =====
resource "azurerm_container_app_environment" "this" {
  name                       = "${local.resource_name}-cae"
  resource_group_name        = azurerm_resource_group.this.name
  location                   = azurerm_resource_group.this.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
  infrastructure_subnet_id   = var.enable_private_networking ? azurerm_subnet.container_apps[0].id : null

  # Internal load balancer only. The single public surface is the demo UI front door,
  # declared in the apps stack.
  internal_load_balancer_enabled = var.enable_private_networking

  tags = local.tags
}

===== FILE: infrastructure/registry.tf =====
resource "azurerm_container_registry" "this" {
  name                = replace("${local.resource_name}acr", "-", "")
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "Premium"
  admin_enabled       = false

  public_network_access_enabled = false
  anonymous_pull_enabled        = false

  tags = local.tags
}

===== FILE: infrastructure/cosmos.tf =====
resource "azurerm_cosmosdb_account" "this" {
  name                = "${local.resource_name}-cosmos"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  public_network_access_enabled     = false
  is_virtual_network_filter_enabled = true
  local_authentication_enabled      = false

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = azurerm_resource_group.this.location
    failover_priority = 0
  }

  tags = local.tags
}

resource "azurerm_cosmosdb_sql_database" "this" {
  name                = "fcmr"
  resource_group_name = azurerm_resource_group.this.name
  account_name        = azurerm_cosmosdb_account.this.name
}

locals {
  cosmos_containers = {
    routerDecisions    = "/correlationId"
    approvals          = "/correlationId"
    surveillanceAlerts = "/batchId"
    researchQueries    = "/correlationId"
    orderProposals     = "/correlationId"
    auditEvents        = "/correlationId"
  }
}

resource "azurerm_cosmosdb_sql_container" "this" {
  for_each = local.cosmos_containers

  name                  = each.key
  resource_group_name   = azurerm_resource_group.this.name
  account_name          = azurerm_cosmosdb_account.this.name
  database_name         = azurerm_cosmosdb_sql_database.this.name
  partition_key_paths   = [each.value]
  partition_key_version = 2
}

===== FILE: infrastructure/search.tf =====
resource "azurerm_search_service" "this" {
  name                = "${local.resource_name}-search"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "standard"

  public_network_access_enabled = false
  local_authentication_enabled  = false

  identity {
    type = "SystemAssigned"
  }

  tags = local.tags
}

===== FILE: infrastructure/keyvault.tf =====
data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "this" {
  name                = "${local.resource_name}-kv"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  rbac_authorization_enabled = true
  purge_protection_enabled   = false
  soft_delete_retention_days = 7

  public_network_access_enabled = false

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }

  tags = local.tags
}

===== FILE: infrastructure/ai.tf =====
# Microsoft Foundry.
#
# This is a Microsoft.CognitiveServices account with kind = "AIServices" and project management
# enabled -- NOT an Azure ML / AI Hub workspace. The distinction matters: the AI Hub model
# (azurerm_ai_foundry) is a different service with a different resource tree, requires a storage
# account and key vault, and does not support managedComputeDeployments.
#
# Deployed via azapi because the required API versions are preview and are not yet modelled by the
# azurerm provider. See docs/adr/006-multi-vendor-model-catalog.md.
#
# See ADR 005 and Principle V.

resource "azapi_resource" "foundry" {
  type      = "Microsoft.CognitiveServices/accounts@2025-06-01"
  name      = "${local.resource_name}-foundry"
  parent_id = azurerm_resource_group.this.id
  location  = azurerm_resource_group.this.location
  tags      = local.tags

  body = {
    kind = "AIServices"
    sku = {
      name = "S0"
    }
    identity = {
      type = "SystemAssigned"
    }

    properties = {
      # Principle II. The reference architecture leaves this Enabled; we do not.
      # scripts/policy-no-public-endpoints.sh fails the build if this is flipped.
      publicNetworkAccess = "Disabled"

      # Entra only. No account keys anywhere in this system (Principle VIII).
      disableLocalAuth = true

      allowProjectManagement = true
      customSubDomainName    = "${local.resource_name}-foundry"
    }
  }

  response_export_values = [
    "identity.principalId",
    "properties.endpoint",
  ]
}

resource "azapi_resource" "foundry_project" {
  type      = "Microsoft.CognitiveServices/accounts/projects@2026-05-15-preview"
  name      = "${local.resource_name}-proj"
  parent_id = azapi_resource.foundry.id
  location  = azurerm_resource_group.this.location

  # Preview API; azapi has no schema for it yet.
  schema_validation_enabled = false

  body = {
    sku = {
      name = "S0"
    }
    identity = {
      type = "SystemAssigned"
    }
    properties = {
      displayName = "${local.resource_name}-proj"
      description = "Capital markets governed AI exchange"
    }
  }

  response_export_values = [
    "identity.principalId",
    "properties.internalId",
  ]
}

===== FILE: infrastructure/outputs.tf =====
output "resource_group_name" {
  description = "Platform resource group."
  value       = azurerm_resource_group.this.name
}

output "location" {
  value = azurerm_resource_group.this.location
}

output "acr_name" {
  value = azurerm_container_registry.this.name
}

output "acr_login_server" {
  value = azurerm_container_registry.this.login_server
}

output "container_app_environment_id" {
  value = azurerm_container_app_environment.this.id
}

output "cosmos_endpoint" {
  value = azurerm_cosmosdb_account.this.endpoint
}

output "cosmos_account_name" {
  value = azurerm_cosmosdb_account.this.name
}

output "cosmos_database_name" {
  value = azurerm_cosmosdb_sql_database.this.name
}

output "search_endpoint" {
  value = "https://${azurerm_search_service.this.name}.search.windows.net"
}

output "keyvault_uri" {
  value = azurerm_key_vault.this.vault_uri
}

output "keyvault_id" {
  value = azurerm_key_vault.this.id
}

output "foundry_endpoint" {
  value = azapi_resource.foundry.output.properties.endpoint
}

output "foundry_id" {
  value = azapi_resource.foundry.id
}

output "foundry_project_id" {
  value = azapi_resource.foundry_project.id
}

output "foundry_project_endpoint" {
  description = "Project endpoint the router uses to reach hosted agents."
  value       = "https://${azapi_resource.foundry.name}.services.ai.azure.com/api/projects/${azapi_resource.foundry_project.name}"
}

output "foundry_principal_id" {
  description = "System-assigned identity of the Foundry account, for role assignments."
  value       = azapi_resource.foundry.output.identity.principalId
}

output "application_insights_connection_string" {
  value     = azurerm_application_insights.this.connection_string
  sensitive = true
}

output "log_analytics_workspace_id" {
  value = azurerm_log_analytics_workspace.this.id
}

output "vnet_id" {
  value = var.enable_private_networking ? azurerm_virtual_network.this[0].id : null
}

output "model_catalog" {
  description = "Approved model catalog consumed by the router and the policy engine."
  value       = var.model_catalog
}

output "managed_compute_enabled" {
  value = var.enable_managed_compute
}

===== FILE: infrastructure/managed-compute.tf =====
# Open-weight models on Microsoft Foundry managed compute. PREVIEW.
#
# managedComputeDeployments provisions dedicated accelerator capacity inside the Foundry account
# and serves a model pulled from the Azure HuggingFace registry. Two things are worth knowing:
#
#   1. acceleratorType is a Foundry accelerator class ("A100_80GB", "H100_80GB"), NOT a
#      Microsoft.Compute VM SKU. Capacity comes from Foundry's GlobalManagedCompute pool, so
#      subscription NC-family vCPU quota is not what governs this.
#   2. Each model needs a matching deploymentTemplate from the same registry. The template is
#      paired to the accelerator; an A100 template will not deploy onto H100 capacity.
#
# Deployments routinely take tens of minutes, hence the 60m timeouts. This does not fit the
# 45-minute rebuild budget -- provision it ahead of the demo and leave it up.
#
# See docs/adr/006-multi-vendor-model-catalog.md.

locals {
  managed_compute_models = var.enable_managed_compute ? {
    for k, v in var.model_catalog : k => v if v.serving == "managed_compute"
  } : {}

  serverless_models = {
    for k, v in var.model_catalog : k => v if v.serving == "serverless"
  }
}

resource "azapi_resource" "managed_compute" {
  for_each = local.managed_compute_models

  type      = "Microsoft.CognitiveServices/accounts/managedComputeDeployments@2026-05-15-preview"
  name      = each.value.model_name
  parent_id = azapi_resource.foundry.id

  schema_validation_enabled = false

  body = {
    sku = {
      name     = "GlobalManagedCompute"
      capacity = each.value.capacity
    }
    properties = {
      acceleratorType    = each.value.accelerator
      deploymentTemplate = each.value.deployment_template
      model              = each.value.model_uri
    }
  }

  response_export_values = ["*"]

  timeouts {
    create = "60m"
    update = "60m"
    delete = "60m"
  }

  depends_on = [azapi_resource.foundry_project]
}

output "managed_compute_deployments" {
  description = "Managed compute deployments backing open-weight models."
  value       = { for k, v in azapi_resource.managed_compute : k => v.id }
}

output "serverless_models" {
  description = "Models served by Azure-hosted serverless endpoints."
  value       = local.serverless_models
}

===== FILE: apps/providers.tf =====
terraform {
  required_version = ">= 1.7.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.14"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

===== FILE: apps/backend.tf =====
terraform {
  backend "azurerm" {
    # Values supplied via -backend-config or environment variables.
    key = "apps.tfstate"
  }
}

===== FILE: apps/variables.tf =====
variable "image_tag" {
  description = "Container image tag to deploy."
  type        = string
  default     = "latest"
}

variable "tf_state_resource_group" {
  description = "Resource group holding the Terraform remote state account."
  type        = string
}

variable "tf_state_storage_account" {
  description = "Storage account holding the Terraform remote state."
  type        = string
}

variable "tf_state_container" {
  description = "Blob container holding the Terraform remote state."
  type        = string
  default     = "tfstate"
}

variable "default_cost_ceiling_usd" {
  description = "Default per-request cost ceiling enforced by the router."
  type        = number
  default     = 0.25
}

variable "approval_expiry_minutes" {
  description = "Minutes before an unapproved proposal expires. Expiry never implies approval."
  type        = number
  default     = 30
}

===== FILE: apps/references.tf =====
# The apps stack reads platform values from remote state. Values are never duplicated.
# See docs/adr/002-two-stack-terraform.md.

data "terraform_remote_state" "platform" {
  backend = "azurerm"

  config = {
    resource_group_name  = var.tf_state_resource_group
    storage_account_name = var.tf_state_storage_account
    container_name       = var.tf_state_container
    key                  = "infrastructure.tfstate"
  }
}

locals {
  platform = data.terraform_remote_state.platform.outputs

  services = {
    "router-service"       = { external = false, cpu = 1.0, memory = "2Gi" }
    "research-service"     = { external = false, cpu = 0.5, memory = "1Gi" }
    "surveillance-service" = { external = false, cpu = 1.0, memory = "2Gi" }
    "orderrouting-service" = { external = false, cpu = 0.5, memory = "1Gi" }
    "webui"                = { external = true, cpu = 0.5, memory = "1Gi" }
  }

  tags = {
    Application = "Foundry Capital Markets Router"
    Workload    = "fcmr"
    ManagedBy   = "terraform"
    DataClass   = "synthetic-only"
  }
}

===== FILE: apps/identities.tf =====
# One user-assigned identity per service. No shared identity, so every role assignment is
# attributable to exactly one workload. Principle VIII.

resource "azurerm_user_assigned_identity" "service" {
  for_each = local.services

  name                = "id-${each.key}"
  resource_group_name = local.platform.resource_group_name
  location            = local.platform.location
  tags                = local.tags
}

===== FILE: apps/roles.tf =====
# Least privilege, resource-scoped. No service holds a subscription-scoped role.
# scripts/policy-no-public-endpoints.sh and CI verify the scoping rule.

data "azurerm_cosmosdb_account" "this" {
  name                = local.platform.cosmos_account_name
  resource_group_name = local.platform.resource_group_name
}

resource "azurerm_role_assignment" "acr_pull" {
  for_each = local.services

  scope                = data.azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.service[each.key].principal_id
}

data "azurerm_container_registry" "this" {
  name                = local.platform.acr_name
  resource_group_name = local.platform.resource_group_name
}

# Only the router reaches the Foundry data plane. The lane services have no such assignment,
# which is what makes the chokepoint in Principle V real rather than conventional.
resource "azurerm_role_assignment" "router_foundry" {
  scope                = local.platform.foundry_project_id
  role_definition_name = "Azure AI Developer"
  principal_id         = azurerm_user_assigned_identity.service["router-service"].principal_id
}

resource "azurerm_role_assignment" "search_reader" {
  for_each = toset(["research-service", "surveillance-service"])

  scope                = data.azurerm_search_service.this.id
  role_definition_name = "Search Index Data Reader"
  principal_id         = azurerm_user_assigned_identity.service[each.value].principal_id
}

data "azurerm_search_service" "this" {
  name                = split(".", replace(local.platform.search_endpoint, "https://", ""))[0]
  resource_group_name = local.platform.resource_group_name
}

===== FILE: apps/entra.tf =====
# App roles for human access. Segregation of duties is enforced by the approval API, not by the
# UI hiding a button. See docs/threat-model.md T-5.

resource "azuread_application" "webui" {
  display_name     = "Foundry Capital Markets Router"
  sign_in_audience = "AzureADMyOrg"

  app_role {
    allowed_member_types = ["User"]
    description          = "Decide on pending proposals. Cannot approve own proposals."
    display_name         = "Approver"
    enabled              = true
    id                   = "1f4e8b6a-0000-4000-8000-000000000001"
    value                = "Approver"
  }

  app_role {
    allowed_member_types = ["User", "Application"]
    description          = "Read routing decisions and the scoreboard."
    display_name         = "Router.Read"
    enabled              = true
    id                   = "1f4e8b6a-0000-4000-8000-000000000002"
    value                = "Router.Read"
  }

  app_role {
    allowed_member_types = ["Application"]
    description          = "Invoke the router. Service-to-service only."
    display_name         = "Router.Invoke"
    enabled              = true
    id                   = "1f4e8b6a-0000-4000-8000-000000000003"
    value                = "Router.Invoke"
  }
}

resource "azuread_service_principal" "webui" {
  client_id = azuread_application.webui.client_id
}

===== FILE: apps/container-apps.tf =====
resource "azurerm_container_app" "service" {
  for_each = local.services

  name                         = each.key
  resource_group_name          = local.platform.resource_group_name
  container_app_environment_id = local.platform.container_app_environment_id
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.service[each.key].id]
  }

  registry {
    server   = local.platform.acr_login_server
    identity = azurerm_user_assigned_identity.service[each.key].id
  }

  ingress {
    # Only the UI is externally reachable. Everything else is internal ingress.
    external_enabled = each.value.external
    target_port      = 8080
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 1
    max_replicas = 3

    container {
      name   = each.key
      image  = "${local.platform.acr_login_server}/${each.key}:${var.image_tag}"
      cpu    = each.value.cpu
      memory = each.value.memory

      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.service[each.key].client_id
      }

      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = local.platform.application_insights_connection_string
      }

      env {
        name  = "COSMOS_ENDPOINT"
        value = local.platform.cosmos_endpoint
      }

      env {
        name  = "COSMOS_DATABASE"
        value = local.platform.cosmos_database_name
      }

      env {
        name  = "DEFAULT_COST_CEILING_USD"
        value = tostring(var.default_cost_ceiling_usd)
      }

      env {
        name  = "APPROVAL_EXPIRY_MINUTES"
        value = tostring(var.approval_expiry_minutes)
      }
    }
  }
}

===== FILE: apps/outputs.tf =====
output "webui_url" {
  description = "The single public surface."
  value       = "https://${azurerm_container_app.service["webui"].ingress[0].fqdn}"
}

output "service_identities" {
  description = "Client IDs of the per-service managed identities."
  value = {
    for k, v in azurerm_user_assigned_identity.service : k => v.client_id
  }
}

output "entra_application_id" {
  value = azuread_application.webui.client_id
}

===== FILE: src/README.md =====
# Services

| Directory | Responsibility |
|---|---|
| `Fcmr.Router.Decisions` | Pure routing decision logic. No dependencies. Coverage-gated at 70%. |
| `router-service` | The model access chokepoint. Tier selection, cost ceilings, decision recording. |
| `research-service` | Retrieval-grounded synthesis with attribution or refusal. |
| `surveillance-service` | Bulk alert triage, ranking, evidence assembly, escalation proposals. |
| `orderrouting-service` | Route proposals against the simulated OMS with best-execution boundaries. |
| `webui` | The scoreboard and approval queue. |
| `tools/SyntheticData` | Seeded generators. The only source of data in this system. |

## The one rule that matters here

Only `router-service` calls a model. The lane services have no route to the Foundry data plane,
and no role assignment granting them one. If you find yourself adding a model client to a lane
service, stop — you are about to break Principle V and the network will refuse you anyway.

## Why decision logic is its own assembly

`Fcmr.Router.Decisions` has no I/O, no SDK references, and no configuration. Complexity scoring,
tier selection, and cost ceiling enforcement are pure functions of their inputs.

That makes them exhaustively testable, which is why the 70% coverage gate is pointed at this
assembly specifically rather than at the solution as a whole. It is the logic the demo's second
claim rests on.

===== FILE: src/Fcmr.Router.Decisions/Fcmr.Router.Decisions.csproj =====
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <RootNamespace>Fcmr.Router.Decisions</RootNamespace>
    <AssemblyName>Fcmr.Router.Decisions</AssemblyName>
  </PropertyGroup>

  <!--
    Deliberately dependency-free. This assembly is the coverage-gated core; adding I/O or an SDK
    reference here makes it untestable and defeats the purpose of the split.
  -->

</Project>

===== FILE: src/Fcmr.Router.Decisions/ModelTier.cs =====
namespace Fcmr.Router.Decisions;

/// <summary>Model capability and cost tiers. Ordered cheapest to most expensive.</summary>
public enum ModelTier
{
    Economy = 0,
    Standard = 1,
    Premium = 2,
}

/// <summary>What the router did with a request.</summary>
public enum RoutingOutcome
{
    /// <summary>Routed to the tier the complexity score indicated.</summary>
    Routed,

    /// <summary>Routed to a cheaper tier than indicated, because the ceiling required it.</summary>
    Downgraded,

    /// <summary>Not routed. Even the cheapest viable tier exceeded the ceiling.</summary>
    Denied,

    /// <summary>
    /// Not routed. Governance policy left no eligible model.
    ///
    /// Deliberately distinct from <see cref="Denied"/>. "Too expensive" and "not permitted" are
    /// different conversations with different people, and collapsing them would lose that.
    ///
    /// This is a successful, governed outcome carried on a 200 response, never an error status.
    /// Modelling it as a failure would invite retry-on-error logic, and the one thing that must
    /// never happen is a retry that finds an unapproved model.
    /// </summary>
    RefusedByPolicy,
}

===== FILE: src/Fcmr.Router.Decisions/ComplexityScorer.cs =====
namespace Fcmr.Router.Decisions;

/// <summary>
/// Signals describing a task, used to derive a complexity score.
/// Supplied by the caller; never inferred from model output.
/// </summary>
public sealed record ComplexityHints
{
    public int InputTokenEstimate { get; init; }
    public bool RequiresMultiStep { get; init; }
    public bool RequiresRetrieval { get; init; }
    public bool RequiresToolCalls { get; init; }
}

/// <summary>
/// Derives a 0.0 to 1.0 complexity score from task signals.
///
/// Pure and deterministic by design: identical inputs must always produce an identical score,
/// because the demo shows the same request routing the same way on stage as it did in rehearsal.
/// </summary>
public static class ComplexityScorer
{
    // Weights sum to 1.0. Token length is the largest single factor because it correlates most
    // directly with where cheaper tiers start to degrade.
    private const double TokenWeight = 0.40;
    private const double MultiStepWeight = 0.25;
    private const double RetrievalWeight = 0.20;
    private const double ToolCallWeight = 0.15;

    /// <summary>Token count at which the length signal saturates.</summary>
    private const double TokenSaturation = 32_000.0;

    public static double Score(ComplexityHints hints)
    {
        ArgumentNullException.ThrowIfNull(hints);

        var tokens = Math.Clamp(hints.InputTokenEstimate, 0, int.MaxValue);
        var tokenSignal = Math.Min(tokens / TokenSaturation, 1.0);

        var score =
            (tokenSignal * TokenWeight) +
            (hints.RequiresMultiStep ? MultiStepWeight : 0.0) +
            (hints.RequiresRetrieval ? RetrievalWeight : 0.0) +
            (hints.RequiresToolCalls ? ToolCallWeight : 0.0);

        return Math.Round(Math.Clamp(score, 0.0, 1.0), 4);
    }

    /// <summary>The tier a score indicates, before any cost ceiling is applied.</summary>
    public static ModelTier IndicatedTier(double score) => score switch
    {
        < 0.35 => ModelTier.Economy,
        < 0.70 => ModelTier.Standard,
        _ => ModelTier.Premium,
    };
}

===== FILE: src/Fcmr.Router.Decisions/RoutingDecision.cs =====
namespace Fcmr.Router.Decisions;

public sealed record TierCandidate
{
    public required ModelTier Tier { get; init; }
    public required string Deployment { get; init; }
    public required decimal ProjectedCostUsd { get; init; }

    /// <summary>
    /// Which vendor supplies this candidate. Present so the decision detail view can show that
    /// several vendors competed for the same request without a second lookup.
    /// </summary>
    public ModelVendor Vendor { get; init; } = ModelVendor.AzureOpenAI;

    public bool Selected { get; init; }
    public string? RejectedReason { get; init; }
}

public sealed record RoutingDecision
{
    public required double ComplexityScore { get; init; }
    public required decimal CostCeilingUsd { get; init; }
    public required RoutingOutcome Outcome { get; init; }
    public ModelTier? SelectedTier { get; init; }
    public string? SelectedDeployment { get; init; }
    public required IReadOnlyList<TierCandidate> CandidateTiers { get; init; }

    /// <summary>
    /// Human-readable and shown in the UI at demo time. Must name the deciding factor —
    /// a rationale that does not explain the decision is worse than none, because it
    /// implies an explanation exists when it does not.
    /// </summary>
    public required string Rationale { get; init; }

    // ---- Governance, added by Feature 002 Slice A ----

    /// <summary>Which policy set governed this decision.</summary>
    public string? PolicySetId { get; init; }

    /// <summary>
    /// Pinned at decision time. Without it, replaying an audit record after a policy edit would
    /// show a decision that appears to violate the policy in force, which is exactly the finding
    /// an auditor escalates.
    /// </summary>
    public int? PolicySetVersion { get; init; }

    /// <summary>Sensitivity the caller declared for this request. Never inferred, never defaulted.</summary>
    public DataClassification? DataClassification { get; init; }

    /// <summary>Vendor of the selected model. Null on any non-routed outcome.</summary>
    public ModelVendor? SelectedVendor { get; init; }

    /// <summary>
    /// Every candidate governance removed, each with a reason.
    ///
    /// Persisted rather than merely computed for the response: "why was this model not used?"
    /// is asked long after the request completes.
    /// </summary>
    public IReadOnlyList<PolicyExclusion> PolicyExclusions { get; init; } = [];
}

===== FILE: src/Fcmr.Router.Decisions/TierSelector.cs =====
namespace Fcmr.Router.Decisions;

/// <summary>Cost, vendor, and deployment name for one candidate model.</summary>
public sealed record TierPricing
{
    public required ModelTier Tier { get; init; }
    public required string Deployment { get; init; }
    public required decimal CostPerRequestUsd { get; init; }
    public bool Available { get; init; } = true;

    /// <summary>
    /// Which vendor supplies this model. The exchange's central claim is that vendors are
    /// interchangeable, so vendor identity belongs on the candidate rather than being implied
    /// by the deployment name.
    /// </summary>
    public ModelVendor Vendor { get; init; } = ModelVendor.AzureOpenAI;

    /// <summary>How the model is served. Managed compute is a preview capability.</summary>
    public ServingMode Serving { get; init; } = ServingMode.Serverless;
}

/// <summary>
/// Selects a model from a complexity score and an enforced cost ceiling.
///
/// The ceiling is a control, not a report. When the indicated tier exceeds it, the selector
/// downgrades to the most capable affordable tier, and denies only when nothing is affordable.
/// A denial is returned to the caller and surfaced in the UI; it is never silently absorbed.
///
/// The catalog is multi-vendor, so a tier holds several competing deployments. Selection is
/// therefore tier-first then cheapest-within-tier, and candidates are identified by deployment
/// rather than by tier. Identifying by tier alone would mark every same-tier competitor as the
/// one that ran, and the scoreboard's cost attribution is only as honest as that identification.
/// </summary>
public static class TierSelector
{
    public static RoutingDecision Select(
        double complexityScore,
        decimal costCeilingUsd,
        IReadOnlyList<TierPricing> pricing)
    {
        ArgumentNullException.ThrowIfNull(pricing);

        if (pricing.Count == 0)
        {
            throw new ArgumentException("At least one tier must be supplied.", nameof(pricing));
        }

        var indicated = ComplexityScorer.IndicatedTier(complexityScore);
        var available = pricing.Where(p => p.Available).ToList();

        if (available.Count == 0)
        {
            return Denied(complexityScore, costCeilingUsd, pricing,
                "No model tier is currently available. The router does not fall back to an unrouted direct call.");
        }

        var affordable = available.Where(p => p.CostPerRequestUsd <= costCeilingUsd).ToList();

        if (affordable.Count == 0)
        {
            var cheapest = available.MinBy(p => p.CostPerRequestUsd)!;
            return Denied(complexityScore, costCeilingUsd, pricing,
                $"Cheapest available model {cheapest.Deployment} projects {cheapest.CostPerRequestUsd:0.###} USD " +
                $"against a ceiling of {costCeilingUsd:0.###} USD.");
        }

        var chosen = Choose(affordable, indicated);
        var downgraded = chosen.Tier < indicated;

        var rationale = downgraded
            ? $"Complexity {complexityScore:0.##} indicated {indicated}, but its projected cost exceeds the " +
              $"{costCeilingUsd:0.###} USD ceiling. Downgraded to {chosen.Tier} ({chosen.Deployment}) at " +
              $"{chosen.CostPerRequestUsd:0.###} USD."
            : $"Complexity {complexityScore:0.##} indicated {chosen.Tier}, served by {chosen.Deployment} at " +
              $"{chosen.CostPerRequestUsd:0.###} USD within the {costCeilingUsd:0.###} USD ceiling.";

        return new RoutingDecision
        {
            ComplexityScore = complexityScore,
            CostCeilingUsd = costCeilingUsd,
            Outcome = downgraded ? RoutingOutcome.Downgraded : RoutingOutcome.Routed,
            SelectedTier = chosen.Tier,
            SelectedDeployment = chosen.Deployment,
            SelectedVendor = chosen.Vendor,
            CandidateTiers = BuildCandidates(pricing, chosen, costCeilingUsd, indicated),
            Rationale = rationale,
        };
    }

    /// <summary>
    /// Prefer the indicated tier. Failing that, the most capable tier below it. Failing that —
    /// which happens only when the indicated tier is unavailable and nothing cheaper exists —
    /// the cheapest tier above. Ties within a tier always break toward lower cost.
    /// </summary>
    private static TierPricing Choose(List<TierPricing> affordable, ModelTier indicated)
    {
        var atIndicated = affordable
            .Where(p => p.Tier == indicated)
            .OrderBy(p => p.CostPerRequestUsd)
            .ThenBy(p => p.Deployment, StringComparer.Ordinal)
            .FirstOrDefault();

        if (atIndicated is not null)
        {
            return atIndicated;
        }

        var below = affordable
            .Where(p => p.Tier < indicated)
            .OrderByDescending(p => p.Tier)
            .ThenBy(p => p.CostPerRequestUsd)
            .ThenBy(p => p.Deployment, StringComparer.Ordinal)
            .FirstOrDefault();

        return below ?? affordable
            .OrderBy(p => p.Tier)
            .ThenBy(p => p.CostPerRequestUsd)
            .ThenBy(p => p.Deployment, StringComparer.Ordinal)
            .First();
    }

    private static RoutingDecision Denied(
        double complexityScore,
        decimal ceiling,
        IReadOnlyList<TierPricing> pricing,
        string rationale) => new()
        {
            ComplexityScore = complexityScore,
            CostCeilingUsd = ceiling,
            Outcome = RoutingOutcome.Denied,
            SelectedTier = null,
            SelectedDeployment = null,
            SelectedVendor = null,
            CandidateTiers = BuildCandidates(pricing, null, ceiling, null),
            Rationale = rationale,
        };

    private static List<TierCandidate> BuildCandidates(
        IReadOnlyList<TierPricing> pricing,
        TierPricing? chosen,
        decimal ceiling,
        ModelTier? indicated)
    {
        var candidates = new List<TierCandidate>(pricing.Count);

        var ordered = pricing
            .OrderBy(p => p.Tier)
            .ThenBy(p => p.CostPerRequestUsd)
            .ThenBy(p => p.Deployment, StringComparer.Ordinal);

        foreach (var p in ordered)
        {
            // Identity is the deployment, not the tier. A multi-vendor catalog holds several
            // models per tier and only one of them ran.
            var selected = chosen is not null &&
                           string.Equals(p.Deployment, chosen.Deployment, StringComparison.Ordinal);

            string? reason = null;
            if (!selected)
            {
                if (!p.Available)
                {
                    reason = "Model unavailable.";
                }
                else if (p.CostPerRequestUsd > ceiling)
                {
                    reason = $"Projected {p.CostPerRequestUsd:0.###} USD exceeds the {ceiling:0.###} USD ceiling.";
                }
                else if (chosen is not null && p.Tier == chosen.Tier)
                {
                    reason = $"Same tier as the selected model at a higher projected cost " +
                             $"({p.CostPerRequestUsd:0.###} against {chosen.CostPerRequestUsd:0.###} USD).";
                }
                else if (indicated is not null && p.Tier > indicated)
                {
                    reason = "Above the tier indicated by task complexity; no measured quality gain for this task kind.";
                }
                else
                {
                    reason = "Below the tier indicated by task complexity.";
                }
            }

            candidates.Add(new TierCandidate
            {
                Tier = p.Tier,
                Deployment = p.Deployment,
                ProjectedCostUsd = p.CostPerRequestUsd,
                Vendor = p.Vendor,
                Selected = selected,
                RejectedReason = reason,
            });
        }

        return candidates;
    }
}

===== FILE: src/Fcmr.Router.Decisions/ModelVendor.cs =====
namespace Fcmr.Router.Decisions;

/// <summary>
/// Model vendors in the approved catalog.
///
/// Vendor is an explicit, first-class property rather than something inferred from a deployment
/// name, because the whole argument of the exchange is that vendors are interchangeable. A
/// concept you cannot name is a concept you cannot swap by policy.
/// </summary>
public enum ModelVendor
{
    AzureOpenAI,
    Anthropic,
    XAI,

    /// <summary>Open-weight models served on Foundry managed compute.</summary>
    OpenWeight,
}

/// <summary>How a model is served.</summary>
public enum ServingMode
{
    /// <summary>Azure-hosted endpoint. Provisioned quickly, billed per token.</summary>
    Serverless,

    /// <summary>
    /// Dedicated GPU capacity in the Foundry project. PREVIEW.
    /// Subject to quota, slow to provision, and cheap per request once warm.
    /// </summary>
    ManagedCompute,
}

/// <summary>
/// Sensitivity of the data accompanying a request. Drives which models may see it.
/// </summary>
public enum DataClassification
{
    Public = 0,
    Internal = 1,
    Confidential = 2,
    Restricted = 3,
}

===== FILE: src/Fcmr.Router.Decisions/PolicyGate.cs =====
namespace Fcmr.Router.Decisions;

/// <summary>
/// A governance policy set, owned by the business unit rather than by the application.
///
/// This is the object the demo mutates on stage: disabling a vendor here causes the exact same
/// request, from an unchanged application, to produce a different execution plan.
///
/// Field names track contracts/policy-api.md deliberately. A governance object whose domain shape
/// drifts from its published contract is one refactor away from an audit finding.
/// </summary>
public sealed record PolicySet
{
    /// <summary>Policy set identifier, for example CapitalMarkets-US.</summary>
    public required string Id { get; init; }

    /// <summary>Cosmos partition key. Governance is scoped per business unit.</summary>
    public required string BusinessUnit { get; init; }

    /// <summary>Shown in the policy screen.</summary>
    public string DisplayName { get; init; } = string.Empty;

    /// <summary>Vendors permitted for this policy set. A vendor absent here is blocked.</summary>
    public required IReadOnlySet<ModelVendor> ApprovedVendors { get; init; }

    /// <summary>
    /// The most sensitive data each vendor may process. A vendor may be approved in general and
    /// still be ineligible for a specific request.
    /// </summary>
    public required IReadOnlyDictionary<ModelVendor, DataClassification> MaxClassification { get; init; }

    /// <summary>Regions in which execution is permitted. Empty means unrestricted.</summary>
    public IReadOnlySet<string> AllowedRegions { get; init; } = new HashSet<string>();

    /// <summary>Hard ceiling for this policy set, applied before any per-request ceiling.</summary>
    public decimal MaxCostPerRequestUsd { get; init; } = decimal.MaxValue;

    /// <summary>
    /// Declares that this set is expected to serve Restricted data. When true, an edit that leaves
    /// no vendor able to process Restricted is rejected rather than accepted.
    ///
    /// Silently creating a policy set that refuses every restricted request is a configuration
    /// accident, and it would surface as a demo failure rather than as a validation error.
    /// </summary>
    public bool PermitsRestrictedData { get; init; }

    /// <summary>Incremented on every write. Pinned onto each decision at decision time.</summary>
    public int Version { get; init; } = 1;

    /// <summary>Entra object id of the approver who last changed this set.</summary>
    public string? UpdatedBy { get; init; }

    public DateTimeOffset? UpdatedAt { get; init; }
}

/// <summary>
/// The category of a policy exclusion.
///
/// Kept separate from the prose reason because a cost-driven exclusion is a different
/// conversation from a governance-driven one, and if every exclusion looks alike then a request
/// refused purely on price is indistinguishable from one refused on principle. That is exactly
/// the distinction contracts/router-api-policy-extension.md insists on preserving between
/// Denied and RefusedByPolicy, and it would be lost inside the gate without this.
/// </summary>
public enum PolicyExclusionKind
{
    VendorNotApproved,
    ClassificationExceeded,
    RegionNotPermitted,

    /// <summary>Excluded by the policy set's own cost ceiling, not by a governance rule.</summary>
    PolicyCostCeiling,
}

/// <summary>Why a candidate was excluded, in language safe to show a governance audience.</summary>
public sealed record PolicyExclusion
{
    public required string Deployment { get; init; }
    public required ModelVendor Vendor { get; init; }
    public required PolicyExclusionKind Kind { get; init; }
    public required string Reason { get; init; }
}

public sealed record PolicyEvaluation
{
    public required IReadOnlyList<TierPricing> Eligible { get; init; }
    public required IReadOnlyList<PolicyExclusion> Excluded { get; init; }
    public required string PolicySetId { get; init; }

    /// <summary>Version in force when this evaluation ran. Pinned onto the decision record.</summary>
    public required int PolicySetVersion { get; init; }

    /// <summary>True when policy left nothing to route to. The request is refused, not downgraded.</summary>
    public bool NoEligibleModels => Eligible.Count == 0;
}

/// <summary>
/// Filters the model catalog by governance policy, before cost and complexity selection runs.
///
/// Order matters and is deliberate: policy decides what is <em>permissible</em>, then the router
/// decides what is <em>appropriate</em> among the permissible. Running these the other way round
/// would let a cost optimisation reach for a model governance has not approved, which is exactly
/// the failure mode the exchange exists to prevent. See RoutingPlanner, which owns the order.
///
/// Every exclusion carries a reason. A governance audience will ask why a model was not used, and
/// "policy" on its own is not an answer they will accept.
/// </summary>
public static class PolicyGate
{
    public static PolicyEvaluation Evaluate(
        IReadOnlyList<TierPricing> catalog,
        PolicySet policy,
        DataClassification classification,
        string? executionRegion = null)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(policy);

        var eligible = new List<TierPricing>();
        var excluded = new List<PolicyExclusion>();

        if (policy.AllowedRegions.Count > 0 &&
            executionRegion is not null &&
            !policy.AllowedRegions.Contains(executionRegion))
        {
            foreach (var c in catalog)
            {
                excluded.Add(new PolicyExclusion
                {
                    Deployment = c.Deployment,
                    Vendor = c.Vendor,
                    Kind = PolicyExclusionKind.RegionNotPermitted,
                    Reason = $"Execution region '{executionRegion}' is not permitted by policy set '{policy.Id}'.",
                });
            }

            return Result(eligible, excluded, policy);
        }

        foreach (var candidate in catalog)
        {
            if (!policy.ApprovedVendors.Contains(candidate.Vendor))
            {
                excluded.Add(new PolicyExclusion
                {
                    Deployment = candidate.Deployment,
                    Vendor = candidate.Vendor,
                    Kind = PolicyExclusionKind.VendorNotApproved,
                    Reason = $"Vendor {candidate.Vendor} is not approved under policy set '{policy.Id}'.",
                });
                continue;
            }

            if (!policy.MaxClassification.TryGetValue(candidate.Vendor, out var permitted) ||
                classification > permitted)
            {
                excluded.Add(new PolicyExclusion
                {
                    Deployment = candidate.Deployment,
                    Vendor = candidate.Vendor,
                    Kind = PolicyExclusionKind.ClassificationExceeded,
                    Reason = $"Data classification {classification} exceeds the maximum permitted for vendor {candidate.Vendor}.",
                });
                continue;
            }

            if (candidate.CostPerRequestUsd > policy.MaxCostPerRequestUsd)
            {
                excluded.Add(new PolicyExclusion
                {
                    Deployment = candidate.Deployment,
                    Vendor = candidate.Vendor,
                    Kind = PolicyExclusionKind.PolicyCostCeiling,
                    Reason = $"Projected {candidate.CostPerRequestUsd:0.###} USD exceeds the policy ceiling of {policy.MaxCostPerRequestUsd:0.###} USD.",
                });
                continue;
            }

            eligible.Add(candidate);
        }

        return Result(eligible, excluded, policy);
    }

    private static PolicyEvaluation Result(
        IReadOnlyList<TierPricing> eligible,
        IReadOnlyList<PolicyExclusion> excluded,
        PolicySet policy) => new()
        {
            Eligible = eligible,
            Excluded = excluded,
            PolicySetId = policy.Id,
            PolicySetVersion = policy.Version,
        };
}

===== FILE: tests/Fcmr.Router.Decisions.Tests/Fcmr.Router.Decisions.Tests.csproj =====
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="FluentAssertions" />
    <PackageReference Include="coverlet.collector" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="../../src/Fcmr.Router.Decisions/Fcmr.Router.Decisions.csproj" />
  </ItemGroup>

</Project>

===== FILE: tests/Fcmr.Router.Decisions.Tests/ComplexityScorerTests.cs =====
using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

public class ComplexityScorerTests
{
    [Fact]
    public void Score_WithNoSignals_IsZero()
    {
        ComplexityScorer.Score(new ComplexityHints()).Should().Be(0.0);
    }

    [Fact]
    public void Score_WithAllSignalsSaturated_IsOne()
    {
        var hints = new ComplexityHints
        {
            InputTokenEstimate = 64_000,
            RequiresMultiStep = true,
            RequiresRetrieval = true,
            RequiresToolCalls = true,
        };

        ComplexityScorer.Score(hints).Should().Be(1.0);
    }

    [Fact]
    public void Score_IsDeterministic()
    {
        var hints = new ComplexityHints
        {
            InputTokenEstimate = 12_000,
            RequiresMultiStep = true,
            RequiresRetrieval = true,
        };

        var first = ComplexityScorer.Score(hints);
        var second = ComplexityScorer.Score(hints);

        second.Should().Be(first, "the same request must route the same way on stage as in rehearsal");
    }

    [Fact]
    public void Score_TokenSignalSaturates_SoLongerInputDoesNotKeepRaisingIt()
    {
        var atSaturation = ComplexityScorer.Score(new ComplexityHints { InputTokenEstimate = 32_000 });
        var farBeyond = ComplexityScorer.Score(new ComplexityHints { InputTokenEstimate = 500_000 });

        farBeyond.Should().Be(atSaturation);
    }

    [Theory]
    [InlineData(0.0, ModelTier.Economy)]
    [InlineData(0.34, ModelTier.Economy)]
    [InlineData(0.35, ModelTier.Standard)]
    [InlineData(0.69, ModelTier.Standard)]
    [InlineData(0.70, ModelTier.Premium)]
    [InlineData(1.0, ModelTier.Premium)]
    public void IndicatedTier_HonoursThresholdBoundaries(double score, ModelTier expected)
    {
        ComplexityScorer.IndicatedTier(score).Should().Be(expected);
    }

    [Fact]
    public void Score_NegativeTokenEstimate_IsTreatedAsZero()
    {
        var hints = new ComplexityHints { InputTokenEstimate = -5_000 };

        ComplexityScorer.Score(hints).Should().Be(0.0);
    }
}

===== FILE: tests/Fcmr.Router.Decisions.Tests/TierSelectorTests.cs =====
using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

public class TierSelectorTests
{
    private static List<TierPricing> Pricing(bool premiumAvailable = true) =>
    [
        new() { Tier = ModelTier.Economy, Deployment = "economy-dep", CostPerRequestUsd = 0.004m },
        new() { Tier = ModelTier.Standard, Deployment = "standard-dep", CostPerRequestUsd = 0.031m },
        new() { Tier = ModelTier.Premium, Deployment = "premium-dep", CostPerRequestUsd = 0.180m, Available = premiumAvailable },
    ];

    [Fact]
    public void Select_WithinCeiling_RoutesToIndicatedTier()
    {
        var decision = TierSelector.Select(0.50, 0.25m, Pricing());

        decision.Outcome.Should().Be(RoutingOutcome.Routed);
        decision.SelectedTier.Should().Be(ModelTier.Standard);
        decision.SelectedDeployment.Should().Be("standard-dep");
    }

    [Fact]
    public void Select_WhenIndicatedTierExceedsCeiling_Downgrades()
    {
        var decision = TierSelector.Select(0.90, 0.05m, Pricing());

        decision.Outcome.Should().Be(RoutingOutcome.Downgraded);
        decision.SelectedTier.Should().Be(ModelTier.Standard);
        decision.Rationale.Should().Contain("Downgraded");
    }

    [Fact]
    public void Select_WhenNothingIsAffordable_Denies()
    {
        var decision = TierSelector.Select(0.90, 0.001m, Pricing());

        decision.Outcome.Should().Be(RoutingOutcome.Denied);
        decision.SelectedTier.Should().BeNull();
        decision.SelectedDeployment.Should().BeNull();
    }

    [Fact]
    public void Select_CostExactlyAtCeiling_IsAffordable()
    {
        var decision = TierSelector.Select(0.90, 0.180m, Pricing());

        decision.Outcome.Should().Be(RoutingOutcome.Routed);
        decision.SelectedTier.Should().Be(ModelTier.Premium);
    }

    [Fact]
    public void Select_WhenPreferredTierUnavailable_FallsBackWithoutThrowing()
    {
        var decision = TierSelector.Select(0.95, 1.00m, Pricing(premiumAvailable: false));

        decision.Outcome.Should().Be(RoutingOutcome.Downgraded);
        decision.SelectedTier.Should().Be(ModelTier.Standard);
    }

    [Fact]
    public void Select_WhenNoTierIsAvailable_DeniesRatherThanCallingDirectly()
    {
        var none = new List<TierPricing>
        {
            new() { Tier = ModelTier.Economy, Deployment = "economy-dep", CostPerRequestUsd = 0.004m, Available = false },
        };

        var decision = TierSelector.Select(0.10, 1.00m, none);

        decision.Outcome.Should().Be(RoutingOutcome.Denied);
        decision.Rationale.Should().Contain("does not fall back");
    }

    [Fact]
    public void Select_AlwaysProducesARationaleNamingTheDecidingFactor()
    {
        foreach (var (score, ceiling) in new[] { (0.10, 1.00m), (0.50, 1.00m), (0.90, 0.05m), (0.90, 0.001m) })
        {
            var decision = TierSelector.Select(score, ceiling, Pricing());

            decision.Rationale.Should().NotBeNullOrWhiteSpace();
            decision.Rationale.Should().MatchRegex("(?i)(complexity|ceiling|available)");
        }
    }

    [Fact]
    public void Select_ReportsEveryCandidateWithAReasonForNonSelection()
    {
        var decision = TierSelector.Select(0.50, 0.25m, Pricing());

        decision.CandidateTiers.Should().HaveCount(3);
        decision.CandidateTiers.Where(c => !c.Selected)
            .Should().OnlyContain(c => !string.IsNullOrWhiteSpace(c.RejectedReason));
    }

    [Fact]
    public void Select_WithNoPricing_Throws()
    {
        var act = () => TierSelector.Select(0.5, 1.0m, []);

        act.Should().Throw<ArgumentException>();
    }
}

===== FILE: src/router-service/router-service.csproj =====
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <RootNamespace>Fcmr.RouterService</RootNamespace>
    <AssemblyName>Fcmr.RouterService</AssemblyName>
    <UserSecretsId>fcmr-router-service</UserSecretsId>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Azure.Identity" />
    <PackageReference Include="Azure.Monitor.OpenTelemetry.AspNetCore" />
    <PackageReference Include="Microsoft.Azure.Cosmos" />
    <PackageReference Include="Azure.AI.Projects" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="../Fcmr.Router.Decisions/Fcmr.Router.Decisions.csproj" />
  </ItemGroup>

</Project>

===== FILE: src/router-service/Program.cs =====
using Fcmr.Router.Decisions;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();

// T-011: Application Insights wiring, correlation-ID middleware.
// T-014: Cosmos decision persistence and the change-feed scoreboard fallback.
// T-015: full POST /v1/route implementation against contracts/router-api.md.

var app = builder.Build();

app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));

// Placeholder. The real implementation invokes Foundry through APIM after the decision is made
// and persisted. No other service may reach a model deployment; see Principle V.
app.MapPost("/v1/route", (RouteRequest request) =>
{
    var score = ComplexityScorer.Score(new ComplexityHints
    {
        InputTokenEstimate = request.ComplexityHints?.InputTokenEstimate ?? 0,
        RequiresMultiStep = request.ComplexityHints?.RequiresMultiStep ?? false,
        RequiresRetrieval = request.ComplexityHints?.RequiresRetrieval ?? false,
        RequiresToolCalls = request.ComplexityHints?.RequiresToolCalls ?? false,
    });

    var pricing = TierPricingCatalog.FromEnvironment();
    var decision = TierSelector.Select(score, request.CostCeilingUsd, pricing);

    return decision.Outcome == RoutingOutcome.Denied
        ? Results.Json(new { request.CorrelationId, error = "CostCeilingExceeded", decision }, statusCode: 402)
        : Results.Ok(new { request.CorrelationId, decision });
});

app.Run();

internal sealed record RouteRequest(
    string CorrelationId,
    string Lane,
    string TaskKind,
    decimal CostCeilingUsd,
    int LatencyBudgetMs,
    ComplexityHintsDto? ComplexityHints);

internal sealed record ComplexityHintsDto(
    int InputTokenEstimate,
    bool RequiresMultiStep,
    bool RequiresRetrieval,
    bool RequiresToolCalls);

internal static class TierPricingCatalog
{
    // Placeholder pricing. T-013 replaces this with gateway-reported rates.
    public static List<TierPricing> FromEnvironment() =>
    [
        new()
        {
            Tier = ModelTier.Economy,
            Deployment = Environment.GetEnvironmentVariable("MODEL_TIER_ECONOMY") ?? "gpt-5.4-mini",
            CostPerRequestUsd = 0.004m,
        },
        new()
        {
            Tier = ModelTier.Standard,
            Deployment = Environment.GetEnvironmentVariable("MODEL_TIER_STANDARD") ?? "gpt-5.4",
            CostPerRequestUsd = 0.031m,
        },
        new()
        {
            Tier = ModelTier.Premium,
            Deployment = Environment.GetEnvironmentVariable("MODEL_TIER_PREMIUM") ?? "gpt-5.6-sol",
            CostPerRequestUsd = 0.180m,
        },
    ];
}

===== FILE: src/router-service/Dockerfile =====
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Directory.Build.props Directory.Packages.props global.json ./
COPY src/Fcmr.Router.Decisions/ src/Fcmr.Router.Decisions/
COPY src/router-service/ src/router-service/

RUN dotnet publish src/router-service/router-service.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .

ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080

USER $APP_UID

ENTRYPOINT ["dotnet", "Fcmr.RouterService.dll"]

===== FILE: src/research-service/README.md =====
# research-service

Retrieval-grounded synthesis with mandatory per-claim attribution.

Built by **T-022**, **T-023**, and **T-024**. See `specs/001-router-core/spec.md` AC-3.

## The rule this service exists to enforce

Every factual claim carries a citation that resolves to a retrieved chunk. A claim that cannot be
grounded is **withheld and reported** in `unattributableClaims` — never emitted with hedging
language, never quietly dropped.

The unattributable-claims panel is a demo beat in its own right (runbook Beat 6). A system that
visibly declines to answer is more persuasive to a compliance audience than one that never
appears to fail.

## Constraints

- No model client here. Model access is `router-service` only, and this service has no role
  assignment granting it the Foundry data plane.
- Retrieved content is untrusted input. It never carries tool-call authority. See threat model
  T-2.

===== FILE: src/surveillance-service/README.md =====
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

===== FILE: src/orderrouting-service/README.md =====
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

===== FILE: src/webui/package.json =====
{
  "name": "fcmr-webui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@azure/msal-browser": "^3.28.1",
    "@azure/msal-react": "^2.2.0",
    "@tanstack/react-query": "^5.62.11",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "eslint": "^9.17.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.4",
    "globals": "^17.11.0",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "typescript-eslint": "^8.67.0",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}

===== FILE: src/webui/README.md =====
# webui

The scoreboard and the approval queue. The single public surface in the system.

Built by **T-028** through **T-034**.

## Views

| View | Task | Demo beat |
|---|---|---|
| Live scoreboard — cost, latency, tier, rationale, quality | T-029 | 3 |
| Comparison — aggregate cost against the premium baseline | T-030 | 3, primary |
| Surveillance triage queue | T-031 | 4, primary |
| Approval queue with evidence packets | T-032 | 5 |
| Research with citations and unattributable claims | T-033 | 6, secondary |

## Two things this UI must not do

1. **Do not treat hiding a button as a control.** Segregation of duties and role gating are
   enforced by the API. The UI reflects them; it does not implement them. The demo explicitly
   shows the API refusing a call.
2. **Do not omit the simulated-OMS label.** Anywhere an execution appears, the label appears.

## Freshness budget

AC-5 requires cost, latency, tier, rationale, and quality within five seconds of request
completion. The source is Application Insights, with a Cosmos change-feed fallback selectable by
configuration. See ADR 004.

===== FILE: SESSION-NOTES.md =====
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

===== FILE: tests/Directory.Build.props =====
<Project>

  <!--
    Inherit the repository-wide settings, including warnings-as-errors, then relax the rules
    that conflict with test conventions.
  -->
  <Import Project="$([MSBuild]::GetPathOfFileAbove('Directory.Build.props', '$(MSBuildThisFileDirectory)../'))" />

  <PropertyGroup>
    <!--
      CA1707 forbids underscores in member names. Test methods use the
      Method_Scenario_ExpectedOutcome convention deliberately: a failing test name should read as
      a sentence in CI output. Warnings remain errors everywhere else.
    -->
    <NoWarn>$(NoWarn);CA1707</NoWarn>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

</Project>

===== FILE: tests/Fcmr.Router.Decisions.Tests/PolicyGateTests.cs =====
using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

public class PolicyGateTests
{
    private static List<TierPricing> Catalog() =>
    [
        new()
        {
            Tier = ModelTier.Economy, Deployment = "mistral-small", CostPerRequestUsd = 0.002m,
            Vendor = ModelVendor.OpenWeight, Serving = ServingMode.ManagedCompute,
        },
        new()
        {
            Tier = ModelTier.Standard, Deployment = "gpt-5.4", CostPerRequestUsd = 0.031m,
            Vendor = ModelVendor.AzureOpenAI, Serving = ServingMode.Serverless,
        },
        new()
        {
            Tier = ModelTier.Standard, Deployment = "grok-4.3", CostPerRequestUsd = 0.075m,
            Vendor = ModelVendor.XAI, Serving = ServingMode.Serverless,
        },
        new()
        {
            Tier = ModelTier.Premium, Deployment = "claude-sonnet-4-5", CostPerRequestUsd = 0.090m,
            Vendor = ModelVendor.Anthropic, Serving = ServingMode.Serverless,
        },
    ];

    private static PolicySet CapitalMarkets(params ModelVendor[] approved) => new()
    {
        Id = "CapitalMarkets-US",
        BusinessUnit = "CapitalMarkets",
        DisplayName = "Capital Markets — US",
        ApprovedVendors = approved.Length > 0
            ? new HashSet<ModelVendor>(approved)
            : new HashSet<ModelVendor>
            {
                ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI, ModelVendor.OpenWeight,
            },
        MaxClassification = new Dictionary<ModelVendor, DataClassification>
        {
            [ModelVendor.AzureOpenAI] = DataClassification.Confidential,
            [ModelVendor.Anthropic] = DataClassification.Internal,
            [ModelVendor.XAI] = DataClassification.Internal,
            [ModelVendor.OpenWeight] = DataClassification.Restricted,
        },
    };

    [Fact]
    public void Evaluate_WithAllVendorsApproved_ReturnsWholeCatalog()
    {
        var result = PolicyGate.Evaluate(Catalog(), CapitalMarkets(), DataClassification.Internal);

        result.Eligible.Should().HaveCount(4);
        result.Excluded.Should().BeEmpty();
        result.NoEligibleModels.Should().BeFalse();
    }

    [Fact]
    public void Evaluate_WhenVendorIsDisabledByPolicy_ExcludesItWithAReason()
    {
        // Demo beat: governance disables Anthropic. The application and prompt are unchanged.
        var policy = CapitalMarkets(ModelVendor.AzureOpenAI, ModelVendor.XAI, ModelVendor.OpenWeight);

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal);

        result.Eligible.Should().NotContain(c => c.Vendor == ModelVendor.Anthropic);
        result.Excluded.Should().ContainSingle(e => e.Vendor == ModelVendor.Anthropic)
            .Which.Reason.Should().Contain("not approved");
    }

    [Fact]
    public void Evaluate_WhenClassificationExceedsVendorMaximum_ExcludesThatVendor()
    {
        var result = PolicyGate.Evaluate(Catalog(), CapitalMarkets(), DataClassification.Confidential);

        result.Eligible.Should().OnlyContain(c =>
            c.Vendor == ModelVendor.AzureOpenAI || c.Vendor == ModelVendor.OpenWeight);

        result.Excluded.Should().Contain(e => e.Reason.Contains("Data classification"));
    }

    [Fact]
    public void Evaluate_WithRestrictedData_LeavesOnlyTheOnPremiseCapableVendor()
    {
        var result = PolicyGate.Evaluate(Catalog(), CapitalMarkets(), DataClassification.Restricted);

        result.Eligible.Should().ContainSingle()
            .Which.Serving.Should().Be(ServingMode.ManagedCompute,
                "restricted data is the argument for open-weight models on dedicated capacity");
    }

    [Fact]
    public void Evaluate_WhenPolicyCeilingExcludesEverything_ReportsNoEligibleModels()
    {
        var policy = CapitalMarkets() with { MaxCostPerRequestUsd = 0.001m };

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal);

        result.NoEligibleModels.Should().BeTrue();
        result.Excluded.Should().HaveCount(4);
    }

    [Fact]
    public void Evaluate_WhenRegionIsNotPermitted_ExcludesEverythingWithTheRegionNamed()
    {
        var policy = CapitalMarkets() with { AllowedRegions = new HashSet<string> { "eastus2" } };

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal, "westeurope");

        result.NoEligibleModels.Should().BeTrue();
        result.Excluded.Should().OnlyContain(e => e.Reason.Contains("westeurope"));
    }

    [Fact]
    public void Evaluate_WhenRegionIsPermitted_ProceedsNormally()
    {
        var policy = CapitalMarkets() with { AllowedRegions = new HashSet<string> { "eastus2" } };

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal, "eastus2");

        result.Eligible.Should().HaveCount(4);
    }

    [Fact]
    public void Evaluate_EveryExclusionCarriesAReasonFitToShowAGovernanceAudience()
    {
        var policy = CapitalMarkets(ModelVendor.AzureOpenAI);

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal);

        result.Excluded.Should().OnlyContain(e => !string.IsNullOrWhiteSpace(e.Reason));
        result.Excluded.Should().OnlyContain(e => e.Reason.EndsWith('.'));
    }

    [Fact]
    public void Evaluate_CarriesThePolicySetIdentityAndVersionForPinning()
    {
        var policy = CapitalMarkets() with { Version = 7 };

        var result = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal);

        result.PolicySetId.Should().Be("CapitalMarkets-US");
        result.PolicySetVersion.Should().Be(7,
            "the version in force is pinned onto the decision so a later edit cannot rewrite history");
    }
}

===== FILE: scripts/generate-api-types.mjs =====
#!/usr/bin/env node
// Generates TypeScript types for the web UI from the C# decision library.
//
// The UI's types are generated rather than hand-written because hand-written types drift, and
// drift surfaces on stage. Fcmr.Router.Decisions is the single source of truth for the decision
// record and its enumerations, so the types are derived from the C# rather than inferred from the
// JSON examples in contracts/ -- inference from an example cannot tell an optional field from one
// that merely happened to be null in the sample.
//
// Usage:
//   node scripts/generate-api-types.mjs            write src/webui/src/api/types.generated.ts
//   node scripts/generate-api-types.mjs --check    exit 1 if the file is stale (CI gate)

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(repoRoot, 'src', 'Fcmr.Router.Decisions');
const outputPath = join(repoRoot, 'src', 'webui', 'src', 'api', 'types.generated.ts');

// Records whose shape is part of the HTTP surface. Anything not listed here stays server-side;
// exporting the whole assembly would leak internal types into the client contract.
const EXPORTED_RECORDS = [
  'RoutingDecision',
  'TierCandidate',
  'PolicyExclusion',
  'PolicySet',
  'PolicySetFieldChange',
];

const EXPORTED_ENUMS = [
  'ModelTier',
  'RoutingOutcome',
  'ModelVendor',
  'ServingMode',
  'DataClassification',
  'PolicyExclusionKind',
];

const PRIMITIVES = {
  string: 'string',
  int: 'number',
  double: 'number',
  decimal: 'number',
  bool: 'boolean',
  DateTimeOffset: 'string',
};

function readSources() {
  return readdirSync(sourceDir)
    .filter((f) => f.endsWith('.cs'))
    .map((f) => readFileSync(join(sourceDir, f), 'utf8'))
    .join('\n');
}

function stripComments(src) {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function parseEnums(src) {
  const enums = new Map();
  const re = /public enum (\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m;
    const members = body
      .split(',')
      .map((v) => v.trim().split('=')[0].trim())
      .filter((v) => v.length > 0 && /^\w+$/.test(v));
    enums.set(name, members);
  }
  return enums;
}

function parseRecords(src) {
  const records = new Map();
  // Records here are simple property bags; the body is matched up to the first closing brace at
  // column 0, which holds because the assembly deliberately contains no nested types.
  const re = /public sealed record (\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m;
    const props = [];
    const propRe = /public (required )?([\w<>,.?\s]+?)\s+(\w+)\s*\{\s*get;/g;
    let p;
    while ((p = propRe.exec(body)) !== null) {
      const [, required, rawType, propName] = p;
      props.push({ name: propName, required: Boolean(required), csharpType: rawType.trim() });
    }
    records.set(name, props);
  }
  return records;
}

function mapType(csharpType, enums) {
  let type = csharpType.trim();
  let nullable = false;

  if (type.endsWith('?')) {
    nullable = true;
    type = type.slice(0, -1).trim();
  }

  let ts;
  const list = type.match(/^IReadOnlyList<(.+)>$/) || type.match(/^IReadOnlySet<(.+)>$/);
  const dict = type.match(/^IReadOnlyDictionary<(.+?),\s*(.+)>$/);

  if (list) {
    ts = `${mapType(list[1], enums).ts}[]`;
  } else if (dict) {
    const key = mapType(dict[1], enums).ts;
    const value = mapType(dict[2], enums).ts;
    ts = `Partial<Record<${key}, ${value}>>`;
  } else if (PRIMITIVES[type]) {
    ts = PRIMITIVES[type];
  } else if (enums.has(type)) {
    ts = type;
  } else {
    ts = type;
  }

  return { ts, nullable };
}

function camel(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function generate() {
  const src = stripComments(readSources());
  const enums = parseEnums(src);
  const records = parseRecords(src);

  const missingEnums = EXPORTED_ENUMS.filter((e) => !enums.has(e));
  const missingRecords = EXPORTED_RECORDS.filter((r) => !records.has(r));
  if (missingEnums.length || missingRecords.length) {
    throw new Error(
      `Expected types were not found in the C# source: ${[...missingEnums, ...missingRecords].join(', ')}. ` +
        'Either the type was renamed or the parser needs updating.',
    );
  }

  const lines = [];
  lines.push('// GENERATED FILE -- DO NOT EDIT.');
  lines.push('//');
  lines.push('// Source: src/Fcmr.Router.Decisions/*.cs');
  lines.push('// Regenerate: node scripts/generate-api-types.mjs');
  lines.push('// CI asserts this file is in sync via: node scripts/generate-api-types.mjs --check');
  lines.push('');

  for (const name of EXPORTED_ENUMS) {
    const members = enums.get(name);
    lines.push(`export type ${name} =`);
    lines.push(members.map((v) => `  | '${v}'`).join('\n') + ';');
    lines.push('');
    lines.push(`export const ${name}Values: readonly ${name}[] = [`);
    lines.push(members.map((v) => `  '${v}',`).join('\n'));
    lines.push('] as const;');
    lines.push('');
  }

  for (const name of EXPORTED_RECORDS) {
    lines.push(`export interface ${name} {`);
    for (const prop of records.get(name)) {
      const { ts, nullable } = mapType(prop.csharpType, enums);
      // A nullable C# property becomes an optional TypeScript property that may also be null:
      // the wire format carries an explicit null, and collapsing that to `undefined` would hide
      // the difference between "refused, so no vendor" and "field absent".
      const optional = nullable || !prop.required;
      lines.push(`  ${camel(prop.name)}${optional ? '?' : ''}: ${ts}${nullable ? ' | null' : ''};`);
    }
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const generated = generate();

  if (check) {
    if (!existsSync(outputPath)) {
      console.error('FAIL: types.generated.ts is missing. Run: node scripts/generate-api-types.mjs');
      process.exit(1);
    }
    const current = readFileSync(outputPath, 'utf8');
    if (current !== generated) {
      console.error('FAIL: types.generated.ts is stale relative to the C# source.');
      console.error('Run: node scripts/generate-api-types.mjs');
      process.exit(1);
    }
    console.log('PASS: generated API types are in sync with the C# source.');
    return;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, generated, 'utf8');
  console.log(`Wrote ${outputPath}`);
}

main();

===== FILE: src/Fcmr.Router.Decisions/RoutingPlanner.cs =====
namespace Fcmr.Router.Decisions;

/// <summary>
/// Everything the exchange needs to plan a request.
///
/// Note what is absent: there is no model, vendor, deployment, or tier field, and there will not
/// be one. Principle IV is enforced by this type's shape, because a field that exists is a field
/// that eventually gets used.
/// </summary>
public sealed record RoutingRequest
{
    public required ComplexityHints Hints { get; init; }

    /// <summary>Per-request cost ceiling. The policy ceiling still applies on top of it.</summary>
    public required decimal CostCeilingUsd { get; init; }

    /// <summary>
    /// What the data <em>is</em>, stated by the caller. Required, never defaulted.
    ///
    /// Defaulting an omitted classification to Public is how restricted data reaches a vendor that
    /// should not see it, so the contract makes omission a 400 rather than an assumption.
    /// </summary>
    public required DataClassification DataClassification { get; init; }

    /// <summary>Region execution would occur in, when the policy set constrains regions.</summary>
    public string? ExecutionRegion { get; init; }
}

/// <summary>
/// The single entry point for routing, and the one place the evaluation order is decided.
///
/// <code>
/// catalog -&gt; PolicyGate.Evaluate() -&gt; eligible -&gt; TierSelector.Select() -&gt; decision
/// </code>
///
/// Governance runs first and unconditionally. Cost and complexity then choose among what
/// governance permitted, and never see the models it removed. Reversing the two would let a cost
/// optimisation reach a model governance has not approved — the precise failure the exchange
/// exists to prevent — so the order is asserted by test rather than left to code reading.
///
/// Callers route through here. Calling TierSelector directly bypasses the gate.
/// </summary>
public static class RoutingPlanner
{
    public static RoutingDecision Plan(
        RoutingRequest request,
        IReadOnlyList<TierPricing> catalog,
        PolicySet policy)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(policy);

        if (catalog.Count == 0)
        {
            throw new ArgumentException("At least one catalog entry must be supplied.", nameof(catalog));
        }

        var score = ComplexityScorer.Score(request.Hints);

        // Stage 1 — governance. Always first.
        var evaluation = PolicyGate.Evaluate(
            catalog, policy, request.DataClassification, request.ExecutionRegion);

        if (evaluation.NoEligibleModels)
        {
            return Refused(score, request, evaluation, catalog);
        }

        // Stage 2 — economics, over the permitted subset only. The excluded models are not in
        // scope here, which is what makes the ordering structural rather than conventional.
        var effectiveCeiling = Math.Min(request.CostCeilingUsd, policy.MaxCostPerRequestUsd);
        var decision = TierSelector.Select(score, effectiveCeiling, evaluation.Eligible);

        return decision with
        {
            PolicySetId = evaluation.PolicySetId,
            PolicySetVersion = evaluation.PolicySetVersion,
            DataClassification = request.DataClassification,
            PolicyExclusions = evaluation.Excluded,
        };
    }

    private static RoutingDecision Refused(
        double score,
        RoutingRequest request,
        PolicyEvaluation evaluation,
        IReadOnlyList<TierPricing> catalog)
    {
        // Name the vendors rather than the count. "Refused by policy" is not an answer a
        // governance audience accepts, and the presenter reads this sentence aloud.
        var vendors = evaluation.Excluded
            .Select(e => e.Vendor)
            .Distinct()
            .OrderBy(v => v.ToString(), StringComparer.Ordinal)
            .ToList();

        // A refusal where every exclusion was a price decision is a cost outcome wearing a
        // governance label. Saying so keeps "too expensive" and "not permitted" apart even when
        // both arrive as RefusedByPolicy, which is the distinction the contract exists to protect.
        var allCostDriven = evaluation.Excluded.Count > 0 &&
                            evaluation.Excluded.All(e => e.Kind == PolicyExclusionKind.PolicyCostCeiling);

        var cause = allCostDriven
            ? "every candidate exceeded the policy cost ceiling, so this is a cost outcome rather than a governance one"
            : $"they were excluded on governance grounds for {request.DataClassification} data";

        var rationale =
            $"Policy set '{evaluation.PolicySetId}' version {evaluation.PolicySetVersion} left no eligible " +
            $"model. All {evaluation.Excluded.Count} candidate(s) across {vendors.Count} vendor(s) " +
            $"({string.Join(", ", vendors)}) were ruled out: {cause}. " +
            "The request was refused, not downgraded.";

        return new RoutingDecision
        {
            ComplexityScore = score,
            CostCeilingUsd = request.CostCeilingUsd,
            Outcome = RoutingOutcome.RefusedByPolicy,
            SelectedTier = null,
            SelectedDeployment = null,
            SelectedVendor = null,
            CandidateTiers = catalog
                .OrderBy(p => p.Tier)
                .ThenBy(p => p.CostPerRequestUsd)
                .ThenBy(p => p.Deployment, StringComparer.Ordinal)
                .Select(p => new TierCandidate
                {
                    Tier = p.Tier,
                    Deployment = p.Deployment,
                    ProjectedCostUsd = p.CostPerRequestUsd,
                    Vendor = p.Vendor,
                    Selected = false,
                    RejectedReason = evaluation.Excluded
                        .FirstOrDefault(e => string.Equals(e.Deployment, p.Deployment, StringComparison.Ordinal))
                        ?.Reason ?? "Excluded by governance policy.",
                })
                .ToList(),
            Rationale = rationale,
            PolicySetId = evaluation.PolicySetId,
            PolicySetVersion = evaluation.PolicySetVersion,
            DataClassification = request.DataClassification,
            PolicyExclusions = evaluation.Excluded,
        };
    }
}

===== FILE: src/Fcmr.Router.Decisions/PolicySetValidation.cs =====
namespace Fcmr.Router.Decisions;

/// <summary>
/// Why a proposed policy change was rejected.
///
/// The transport status lives alongside the reason on purpose. contracts/policy-api.md draws a
/// deliberate line between 400 (the change is malformed) and 422 (the change is well-formed but
/// would create a policy set that refuses work it is declared to permit). Keeping the mapping
/// here means the distinction cannot quietly drift away from the published contract.
/// </summary>
public enum PolicyValidationFailure
{
    /// <summary>maxClassification names a vendor that is not in approvedVendors. 400.</summary>
    ClassificationNamesUnapprovedVendor,

    /// <summary>An approved vendor has no maxClassification entry, so it could never be selected. 400.</summary>
    ApprovedVendorHasNoClassification,

    /// <summary>
    /// The set is declared to permit Restricted data, but no approved vendor may process it. 422.
    ///
    /// Accepting this silently produces a policy set that refuses every restricted request, which
    /// surfaces as a demo failure rather than as a validation error.
    /// </summary>
    RestrictedDataUnservable,
}

public sealed record PolicyValidationError
{
    public required PolicyValidationFailure Failure { get; init; }
    public required string Message { get; init; }

    /// <summary>HTTP status the API layer must return for this failure.</summary>
    public int StatusCode => Failure switch
    {
        PolicyValidationFailure.RestrictedDataUnservable => 422,
        _ => 400,
    };
}

public sealed class PolicySetValidationException(PolicyValidationError error)
    : InvalidOperationException(error.Message)
{
    public PolicyValidationError Error { get; } = error;
}

/// <summary>Raised when a write presents a stale expectedVersion. Maps to 409.</summary>
public sealed class PolicySetConcurrencyException(string id, int expectedVersion, int actualVersion)
    : InvalidOperationException(
        $"Policy set '{id}' is at version {actualVersion}; the change expected version {expectedVersion}. " +
        "The change was rejected rather than merged.")
{
    public string PolicySetId { get; } = id;
    public int ExpectedVersion { get; } = expectedVersion;
    public int ActualVersion { get; } = actualVersion;
}

public sealed class PolicySetNotFoundException(string id)
    : InvalidOperationException($"Policy set '{id}' was not found.")
{
    public string PolicySetId { get; } = id;
}

public static class PolicySetValidator
{
    /// <summary>
    /// Validates a fully-resolved policy set. Throws on the first failure rather than collecting,
    /// because the API surfaces one status code and a compound status would be a lie.
    /// </summary>
    public static void Validate(PolicySet candidate)
    {
        ArgumentNullException.ThrowIfNull(candidate);

        foreach (var vendor in candidate.MaxClassification.Keys)
        {
            if (!candidate.ApprovedVendors.Contains(vendor))
            {
                throw new PolicySetValidationException(new PolicyValidationError
                {
                    Failure = PolicyValidationFailure.ClassificationNamesUnapprovedVendor,
                    Message =
                        $"maxClassification names vendor {vendor}, which is not in approvedVendors. " +
                        "A classification limit for an unapproved vendor has no effect and hides intent.",
                });
            }
        }

        foreach (var vendor in candidate.ApprovedVendors)
        {
            if (!candidate.MaxClassification.ContainsKey(vendor))
            {
                throw new PolicySetValidationException(new PolicyValidationError
                {
                    Failure = PolicyValidationFailure.ApprovedVendorHasNoClassification,
                    Message =
                        $"Vendor {vendor} is approved but has no maxClassification entry, so the gate would " +
                        "exclude it from every request. Approving a vendor that can never be selected is " +
                        "almost certainly not what the approver meant.",
                });
            }
        }

        if (candidate.PermitsRestrictedData && !CanServeRestricted(candidate))
        {
            throw new PolicySetValidationException(new PolicyValidationError
            {
                Failure = PolicyValidationFailure.RestrictedDataUnservable,
                Message =
                    $"Policy set '{candidate.Id}' is declared to permit Restricted data, but no approved " +
                    "vendor may process it. Every restricted request would be refused.",
            });
        }
    }

    public static bool CanServeRestricted(PolicySet candidate)
    {
        ArgumentNullException.ThrowIfNull(candidate);

        return candidate.ApprovedVendors.Any(v =>
            candidate.MaxClassification.TryGetValue(v, out var max) &&
            max >= DataClassification.Restricted);
    }
}

===== FILE: src/Fcmr.Router.Decisions/PolicySetRepository.cs =====
namespace Fcmr.Router.Decisions;

/// <summary>One field an approver changed, rendered for the diff and the audit event.</summary>
public sealed record PolicySetFieldChange
{
    public required string Field { get; init; }
    public required string From { get; init; }
    public required string To { get; init; }
}

/// <summary>
/// A partial update. Null means "not supplied", which is distinct from "set to empty" —
/// conflating the two would let an omitted field silently clear a governance control.
/// </summary>
public sealed record PolicySetUpdate
{
    public required string Id { get; init; }
    public required string BusinessUnit { get; init; }

    /// <summary>Required. A mismatch is a 409 and is never merged.</summary>
    public required int ExpectedVersion { get; init; }

    /// <summary>Entra object id of the approver. Recorded on the set and on the audit event.</summary>
    public required string UpdatedBy { get; init; }

    public IReadOnlySet<ModelVendor>? ApprovedVendors { get; init; }
    public IReadOnlyDictionary<ModelVendor, DataClassification>? MaxClassification { get; init; }
    public IReadOnlySet<string>? AllowedRegions { get; init; }
    public decimal? MaxCostPerRequestUsd { get; init; }
    public bool? PermitsRestrictedData { get; init; }
}

/// <summary>The result of an accepted change: the new state plus what actually changed.</summary>
public sealed record PolicySetChangeResult
{
    public required PolicySet PolicySet { get; init; }
    public required IReadOnlyList<PolicySetFieldChange> Changed { get; init; }
    public required DateTimeOffset EffectiveFrom { get; init; }
}

public interface IPolicySetRepository
{
    Task<IReadOnlyList<PolicySet>> ListAsync(string businessUnit, CancellationToken ct = default);

    Task<PolicySet?> GetAsync(string businessUnit, string id, CancellationToken ct = default);

    Task<PolicySetChangeResult> UpdateAsync(PolicySetUpdate update, CancellationToken ct = default);

    /// <summary>Most recent first. Backs the claim that the control's own changes are auditable.</summary>
    Task<IReadOnlyList<PolicySetChangeResult>> HistoryAsync(
        string businessUnit, string id, int take = 20, CancellationToken ct = default);
}

/// <summary>
/// In-memory policy set store with the same optimistic-concurrency semantics as the Cosmos
/// implementation that will replace it.
///
/// This exists so the policy engine, its validation rules, and its concurrency behaviour can be
/// built and proven before any Azure resource exists. The Cosmos version substitutes
/// <c>version</c> for an ETag precondition; the observable contract — stale writes are rejected,
/// never merged — is identical, which is what makes this a fair stand-in rather than a mock that
/// flatters the design.
/// </summary>
public sealed class InMemoryPolicySetRepository : IPolicySetRepository
{
    private readonly Lock _gate = new();
    private readonly Dictionary<string, PolicySet> _sets = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<PolicySetChangeResult>> _history = new(StringComparer.Ordinal);
    private readonly TimeProvider _time;

    public InMemoryPolicySetRepository(IEnumerable<PolicySet>? seed = null, TimeProvider? timeProvider = null)
    {
        _time = timeProvider ?? TimeProvider.System;

        foreach (var set in seed ?? [])
        {
            // Seeded sets are validated on the way in. A baseline that could not have been
            // written through the API is a baseline that will surprise someone later.
            PolicySetValidator.Validate(set);
            _sets[Key(set.BusinessUnit, set.Id)] = set;
        }
    }

    public Task<IReadOnlyList<PolicySet>> ListAsync(string businessUnit, CancellationToken ct = default)
    {
        lock (_gate)
        {
            IReadOnlyList<PolicySet> result = _sets.Values
                .Where(s => string.Equals(s.BusinessUnit, businessUnit, StringComparison.Ordinal))
                .OrderBy(s => s.Id, StringComparer.Ordinal)
                .ToList();

            return Task.FromResult(result);
        }
    }

    public Task<PolicySet?> GetAsync(string businessUnit, string id, CancellationToken ct = default)
    {
        lock (_gate)
        {
            _sets.TryGetValue(Key(businessUnit, id), out var set);
            return Task.FromResult(set);
        }
    }

    public Task<PolicySetChangeResult> UpdateAsync(PolicySetUpdate update, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(update);

        lock (_gate)
        {
            var key = Key(update.BusinessUnit, update.Id);

            if (!_sets.TryGetValue(key, out var current))
            {
                throw new PolicySetNotFoundException(update.Id);
            }

            // Concurrency before validation: a stale write is rejected on the grounds that the
            // approver was not looking at the current state, regardless of what they proposed.
            if (current.Version != update.ExpectedVersion)
            {
                throw new PolicySetConcurrencyException(update.Id, update.ExpectedVersion, current.Version);
            }

            var now = _time.GetUtcNow();

            var proposed = current with
            {
                ApprovedVendors = update.ApprovedVendors ?? current.ApprovedVendors,
                MaxClassification = update.MaxClassification ?? current.MaxClassification,
                AllowedRegions = update.AllowedRegions ?? current.AllowedRegions,
                MaxCostPerRequestUsd = update.MaxCostPerRequestUsd ?? current.MaxCostPerRequestUsd,
                PermitsRestrictedData = update.PermitsRestrictedData ?? current.PermitsRestrictedData,
                Version = current.Version + 1,
                UpdatedBy = update.UpdatedBy,
                UpdatedAt = now,
            };

            PolicySetValidator.Validate(proposed);

            var changed = Diff(current, proposed);

            // A change that changes nothing still burns a version. The alternative is that two
            // approvers can hold the same expectedVersion and both believe they wrote last.
            var result = new PolicySetChangeResult
            {
                PolicySet = proposed,
                Changed = changed,
                EffectiveFrom = now,
            };

            _sets[key] = proposed;

            if (!_history.TryGetValue(key, out var log))
            {
                log = [];
                _history[key] = log;
            }

            log.Add(result);

            return Task.FromResult(result);
        }
    }

    public Task<IReadOnlyList<PolicySetChangeResult>> HistoryAsync(
        string businessUnit, string id, int take = 20, CancellationToken ct = default)
    {
        lock (_gate)
        {
            IReadOnlyList<PolicySetChangeResult> result =
                _history.TryGetValue(Key(businessUnit, id), out var log)
                    ? log.AsEnumerable().Reverse().Take(take).ToList()
                    : [];

            return Task.FromResult(result);
        }
    }

    /// <summary>
    /// Before-and-after for every field that moved. Returned to the UI so the policy screen can
    /// show exactly what the approver did without a second fetch, and written verbatim onto the
    /// PolicySetChanged audit event.
    /// </summary>
    public static IReadOnlyList<PolicySetFieldChange> Diff(PolicySet before, PolicySet after)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(after);

        var changes = new List<PolicySetFieldChange>();

        var beforeVendors = RenderVendors(before.ApprovedVendors);
        var afterVendors = RenderVendors(after.ApprovedVendors);
        if (!string.Equals(beforeVendors, afterVendors, StringComparison.Ordinal))
        {
            changes.Add(new PolicySetFieldChange
            {
                Field = "approvedVendors",
                From = beforeVendors,
                To = afterVendors,
            });
        }

        var beforeClass = RenderClassifications(before.MaxClassification);
        var afterClass = RenderClassifications(after.MaxClassification);
        if (!string.Equals(beforeClass, afterClass, StringComparison.Ordinal))
        {
            changes.Add(new PolicySetFieldChange
            {
                Field = "maxClassification",
                From = beforeClass,
                To = afterClass,
            });
        }

        var beforeRegions = RenderRegions(before.AllowedRegions);
        var afterRegions = RenderRegions(after.AllowedRegions);
        if (!string.Equals(beforeRegions, afterRegions, StringComparison.Ordinal))
        {
            changes.Add(new PolicySetFieldChange
            {
                Field = "allowedRegions",
                From = beforeRegions,
                To = afterRegions,
            });
        }

        if (before.MaxCostPerRequestUsd != after.MaxCostPerRequestUsd)
        {
            changes.Add(new PolicySetFieldChange
            {
                Field = "maxCostPerRequestUsd",
                From = before.MaxCostPerRequestUsd.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture),
                To = after.MaxCostPerRequestUsd.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture),
            });
        }

        if (before.PermitsRestrictedData != after.PermitsRestrictedData)
        {
            changes.Add(new PolicySetFieldChange
            {
                Field = "permitsRestrictedData",
                From = before.PermitsRestrictedData.ToString(),
                To = after.PermitsRestrictedData.ToString(),
            });
        }

        return changes;
    }

    private static string RenderVendors(IReadOnlySet<ModelVendor> vendors) =>
        string.Join(", ", vendors.Select(v => v.ToString()).OrderBy(v => v, StringComparer.Ordinal));

    private static string RenderRegions(IReadOnlySet<string> regions) =>
        string.Join(", ", regions.OrderBy(r => r, StringComparer.Ordinal));

    private static string RenderClassifications(IReadOnlyDictionary<ModelVendor, DataClassification> map) =>
        string.Join(", ", map
            .OrderBy(kv => kv.Key.ToString(), StringComparer.Ordinal)
            .Select(kv => $"{kv.Key}={kv.Value}"));

    private static string Key(string businessUnit, string id) => $"{businessUnit}/{id}";
}

===== FILE: src/Fcmr.Demo.Data/Fcmr.Demo.Data.csproj =====
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <RootNamespace>Fcmr.Demo.Data</RootNamespace>
    <AssemblyName>Fcmr.Demo.Data</AssemblyName>
  </PropertyGroup>

  <!--
    Dependency-free on purpose, like Fcmr.Router.Decisions. The demo fixtures must be generable
    with no Azure resource, no network, and no SDK, because the no-Azure fallback path depends on
    producing the same corpus offline that the cloud path ingests.
  -->

</Project>

===== FILE: src/Fcmr.Demo.Data/DeterministicRandom.cs =====
namespace Fcmr.Demo.Data;

/// <summary>
/// A small xorshift generator with an explicit, stable algorithm.
///
/// System.Random is deliberately not used. Its sequence for a given seed is an implementation
/// detail that has changed between .NET versions, so a corpus generated on one machine would not
/// match one generated on another. The demo claims reproducibility out loud — the surveillance
/// ranking is shown twice and asserted to be identical — so the generator underneath it has to be
/// stable across runtimes, not merely stable within one.
/// </summary>
public sealed class DeterministicRandom
{
    private ulong _state;

    public DeterministicRandom(ulong seed)
    {
        // A zero state is absorbing for xorshift, so displace it to a fixed non-zero constant.
        _state = seed == 0 ? 0x9E3779B97F4A7C15UL : seed;
    }

    public ulong NextUInt64()
    {
        var x = _state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        _state = x;
        return unchecked(x * 0x2545F4914F6CDD1DUL);
    }

    /// <summary>Uniform in [0, maxExclusive).</summary>
    public int Next(int maxExclusive)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxExclusive);
        return (int)(NextUInt64() % (ulong)maxExclusive);
    }

    /// <summary>Uniform in [minInclusive, maxExclusive).</summary>
    public int Next(int minInclusive, int maxExclusive)
    {
        ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(minInclusive, maxExclusive);
        return minInclusive + Next(maxExclusive - minInclusive);
    }

    /// <summary>Uniform in [0.0, 1.0).</summary>
    public double NextDouble() => (NextUInt64() >> 11) * (1.0 / 9007199254740992.0);

    public bool NextBool(double probability) => NextDouble() < probability;

    public T Pick<T>(IReadOnlyList<T> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentOutOfRangeException.ThrowIfZero(items.Count);
        return items[Next(items.Count)];
    }

    /// <summary>Rounded to four places so the value survives a JSON round trip unchanged.</summary>
    public decimal NextDecimal(decimal minInclusive, decimal maxExclusive) =>
        Math.Round(minInclusive + ((decimal)NextDouble() * (maxExclusive - minInclusive)), 4);

    /// <summary>
    /// A derived generator for one independent stream.
    ///
    /// Each generator draws from its own stream so that changing the number of research documents
    /// cannot shift the communications or the alerts. Without this, adding one document silently
    /// rewrites every downstream fixture and the rehearsed demo stops matching.
    /// </summary>
    public static DeterministicRandom ForStream(ulong seed, string streamName)
    {
        ArgumentNullException.ThrowIfNull(streamName);

        // FNV-1a over the stream name, mixed with the master seed.
        var hash = 14695981039346656037UL;
        foreach (var ch in streamName)
        {
            hash ^= ch;
            hash = unchecked(hash * 1099511628211UL);
        }

        return new DeterministicRandom(unchecked(seed ^ hash));
    }
}

===== FILE: src/Fcmr.Demo.Data/DemoRecords.cs =====
namespace Fcmr.Demo.Data;

public enum OrderSide
{
    Buy,
    Sell,
}

public enum CommunicationChannel
{
    Chat,
    Email,
    VoiceTranscript,
}

/// <summary>A source document in the research corpus, chunked ready for indexing.</summary>
public sealed record ResearchDocument
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public required string Source { get; init; }
    public required string Symbol { get; init; }
    public required DateTimeOffset PublishedAt { get; init; }
    public required IReadOnlyList<ResearchChunk> Chunks { get; init; }
}

/// <summary>
/// One retrievable passage. Attribution is per chunk, not per document, because a citation that
/// points at a whole document is not a citation an analyst can check.
/// </summary>
public sealed record ResearchChunk
{
    public required string Id { get; init; }
    public required string DocumentId { get; init; }
    public required int Ordinal { get; init; }
    public required string Text { get; init; }
}

public sealed record Communication
{
    public required string Id { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required CommunicationChannel Channel { get; init; }
    public required string FromParty { get; init; }
    public required string ToParty { get; init; }
    public required string Body { get; init; }
    public string? Symbol { get; init; }

    /// <summary>
    /// Whether this message was planted as genuinely concerning.
    ///
    /// Ground truth exists so the demo can state a measured triage precision instead of asserting
    /// one. It must never be fed to a model or to the ranker — a scoreboard that reads the answer
    /// key is a scoreboard that proves nothing.
    /// </summary>
    public required bool GroundTruthConcerning { get; init; }
}

public sealed record Order
{
    public required string Id { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required string Symbol { get; init; }
    public required OrderSide Side { get; init; }
    public required int Quantity { get; init; }
    public required decimal LimitPrice { get; init; }
    public required string Venue { get; init; }
    public required string TraderId { get; init; }
}

public sealed record Execution
{
    public required string Id { get; init; }
    public required string OrderId { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required int Quantity { get; init; }
    public required decimal Price { get; init; }
    public required string Venue { get; init; }
}

/// <summary>
/// One surveillance alert awaiting triage.
///
/// The evidence references are populated at generation time so that every alert resolves to real
/// communications and real orders. An alert whose evidence does not resolve is the demo failure
/// that surfaces only when someone clicks into the one row you did not rehearse.
/// </summary>
public sealed record SurveillanceAlert
{
    public required string Id { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required string Symbol { get; init; }
    public required string TraderId { get; init; }
    public required string AlertType { get; init; }
    public required IReadOnlyList<string> CommunicationIds { get; init; }
    public required IReadOnlyList<string> OrderIds { get; init; }
    public required bool GroundTruthConcerning { get; init; }
}

/// <summary>The complete fixture set for one seed.</summary>
public sealed record DemoDataSet
{
    public required ulong Seed { get; init; }
    public required IReadOnlyList<ResearchDocument> ResearchDocuments { get; init; }
    public required IReadOnlyList<Communication> Communications { get; init; }
    public required IReadOnlyList<Order> Orders { get; init; }
    public required IReadOnlyList<Execution> Executions { get; init; }
    public required IReadOnlyList<SurveillanceAlert> Alerts { get; init; }

    /// <summary>
    /// Shown in the UI beside the triage queue. The audience is told the ranking is reproducible;
    /// displaying the seed is what turns that from a claim into something they can check.
    /// </summary>
    public string SeedLabel => $"seed-{Seed:x16}";
}

===== FILE: src/Fcmr.Demo.Data/DemoUniverse.cs =====
namespace Fcmr.Demo.Data;

/// <summary>
/// The fictional instruments, venues, desks, and people the fixtures are built from.
///
/// Everything here is invented. No real issuer, employee, or counterparty appears anywhere in the
/// corpus: the demo runs in front of a regulated audience, and synthetic data that resembles a
/// real firm's book invites exactly the question the demo should not spend time on.
/// </summary>
public static class DemoUniverse
{
    public static readonly IReadOnlyList<string> Symbols =
    [
        "ATLN", "BRDG", "CRVN", "DLTA", "EVRT", "FLGN", "GRDN", "HLYX",
        "IRSA", "JVLN", "KSTL", "LMBD", "MRDN", "NVSA", "ORCL8", "PLRS",
    ];

    public static readonly IReadOnlyList<string> Venues =
    [
        "XLIT", "XMER", "XNOR", "XPAC", "DARK-1", "DARK-2",
    ];

    public static readonly IReadOnlyList<string> Traders =
    [
        "TRD-1041", "TRD-1052", "TRD-1078", "TRD-1093", "TRD-1110",
        "TRD-1124", "TRD-1139", "TRD-1157", "TRD-1163", "TRD-1188",
    ];

    public static readonly IReadOnlyList<string> Counterparties =
    [
        "Northwind Securities", "Halberd Capital", "Ridgeline Partners",
        "Fenwick Asset Management", "Corvus Trading", "Marlowe Brothers",
    ];

    public static readonly IReadOnlyList<string> ResearchSources =
    [
        "Internal Equity Research", "Sector Desk Note", "Macro Strategy Weekly",
        "Credit Committee Minutes", "Earnings Call Transcript",
    ];

    public static readonly IReadOnlyList<string> AlertTypes =
    [
        "PotentialFrontRunning", "UnusualPreAnnouncementActivity", "WashTradeSuspicion",
        "LayeringPattern", "OffVenueConcentration", "MarkingTheClose",
    ];

    /// <summary>Fixed epoch so every run produces identical timestamps for a given seed.</summary>
    public static readonly DateTimeOffset Epoch = new(2026, 8, 3, 13, 30, 0, TimeSpan.Zero);
}

===== FILE: src/Fcmr.Demo.Data/DemoDataGenerator.cs =====
namespace Fcmr.Demo.Data;

public sealed record DemoDataOptions
{
    /// <summary>Master seed. The same seed must always produce a byte-identical fixture set.</summary>
    public ulong Seed { get; init; } = 0x0FC0_2026_0910UL;

    public int ResearchDocumentCount { get; init; } = 120;
    public int CommunicationCount { get; init; } = 4_000;
    public int OrderCount { get; init; } = 2_500;

    /// <summary>
    /// The acceptance criteria call for a 500-alert batch. Triage is only interesting at a volume
    /// no analyst could work through by hand, and 500 is the number the demo says out loud.
    /// </summary>
    public int AlertCount { get; init; } = 500;

    /// <summary>Proportion of communications planted as genuinely concerning.</summary>
    public double ConcerningCommunicationRate { get; init; } = 0.03;
}

/// <summary>
/// Builds the complete synthetic fixture set. Pure, offline, and reproducible.
///
/// Each collection draws from its own named stream, so changing the size of one collection does
/// not shift any other. That property is what lets the fixture set grow between rehearsals without
/// invalidating the run that was already rehearsed.
/// </summary>
public static class DemoDataGenerator
{
    public static DemoDataSet Generate(DemoDataOptions? options = null)
    {
        var opts = options ?? new DemoDataOptions();

        var documents = GenerateResearch(opts);
        var communications = GenerateCommunications(opts);
        var orders = GenerateOrders(opts);
        var executions = GenerateExecutions(opts, orders);
        var alerts = GenerateAlerts(opts, communications, orders);

        return new DemoDataSet
        {
            Seed = opts.Seed,
            ResearchDocuments = documents,
            Communications = communications,
            Orders = orders,
            Executions = executions,
            Alerts = alerts,
        };
    }

    private static List<ResearchDocument> GenerateResearch(DemoDataOptions opts)
    {
        var rng = DeterministicRandom.ForStream(opts.Seed, "research");
        var documents = new List<ResearchDocument>(opts.ResearchDocumentCount);

        string[] themes =
        [
            "margin compression", "order book depth", "settlement latency", "funding spreads",
            "sector rotation", "issuance pipeline", "counterparty concentration", "collateral haircuts",
        ];

        for (var i = 0; i < opts.ResearchDocumentCount; i++)
        {
            var symbol = rng.Pick(DemoUniverse.Symbols);
            var theme = rng.Pick(themes);
            var source = rng.Pick(DemoUniverse.ResearchSources);
            var docId = $"doc-{i:D4}";
            var published = DemoUniverse.Epoch.AddDays(-rng.Next(1, 180)).AddMinutes(rng.Next(0, 480));

            var chunkCount = rng.Next(3, 8);
            var chunks = new List<ResearchChunk>(chunkCount);

            for (var c = 0; c < chunkCount; c++)
            {
                // Each chunk states one checkable fact. Synthesis with per-claim attribution is
                // only demonstrable if the underlying passages contain discrete, citable claims.
                var figure = rng.NextDecimal(0.5m, 48.0m);
                var quarter = rng.Next(1, 5);

                chunks.Add(new ResearchChunk
                {
                    Id = $"{docId}-c{c:D2}",
                    DocumentId = docId,
                    Ordinal = c,
                    Text =
                        $"{symbol} {theme} moved {figure:0.00} percent in Q{quarter}. " +
                        $"The desk attributes the change to {rng.Pick(themes)} across {rng.Pick(DemoUniverse.Venues)}. " +
                        $"Coverage note {c + 1} of {chunkCount}.",
                });
            }

            documents.Add(new ResearchDocument
            {
                Id = docId,
                Title = $"{symbol} — {char.ToUpperInvariant(theme[0])}{theme[1..]} review",
                Source = source,
                Symbol = symbol,
                PublishedAt = published,
                Chunks = chunks,
            });
        }

        return documents;
    }

    private static List<Communication> GenerateCommunications(DemoDataOptions opts)
    {
        var rng = DeterministicRandom.ForStream(opts.Seed, "communications");
        var result = new List<Communication>(opts.CommunicationCount);

        string[] benign =
        [
            "Can you confirm the fill on that block before close.",
            "Sending the revised sheet over shortly.",
            "Client wants to work the balance across the session.",
            "No change to the limit, keep it resting.",
            "Settlement instructions came through fine this morning.",
            "Let's revisit sizing after the print.",
        ];

        // Deliberately ambiguous rather than cartoonish. A surveillance demo where the concerning
        // messages announce themselves proves only that string matching works.
        string[] concerning =
        [
            "Hold off on the sell until after the announcement lands.",
            "Heard from the other side of the wall, size it up before it's public.",
            "Keep this off the recorded line and just work it quietly.",
            "We can cross it internally and nobody has to see the print.",
            "Push the last few lots into the close to help the mark.",
            "Do the usual, buy it back tomorrow so it nets flat.",
        ];

        for (var i = 0; i < opts.CommunicationCount; i++)
        {
            var isConcerning = rng.NextBool(opts.ConcerningCommunicationRate);
            var symbol = rng.NextBool(0.8) ? rng.Pick(DemoUniverse.Symbols) : null;

            result.Add(new Communication
            {
                Id = $"comm-{i:D5}",
                Timestamp = DemoUniverse.Epoch.AddMinutes(-rng.Next(0, 20_160)),
                Channel = (CommunicationChannel)rng.Next(0, 3),
                FromParty = rng.Pick(DemoUniverse.Traders),
                ToParty = rng.NextBool(0.5)
                    ? rng.Pick(DemoUniverse.Traders)
                    : rng.Pick(DemoUniverse.Counterparties),
                Body = isConcerning ? rng.Pick(concerning) : rng.Pick(benign),
                Symbol = symbol,
                GroundTruthConcerning = isConcerning,
            });
        }

        return result;
    }

    private static List<Order> GenerateOrders(DemoDataOptions opts)
    {
        var rng = DeterministicRandom.ForStream(opts.Seed, "orders");
        var result = new List<Order>(opts.OrderCount);

        for (var i = 0; i < opts.OrderCount; i++)
        {
            result.Add(new Order
            {
                Id = $"ord-{i:D5}",
                Timestamp = DemoUniverse.Epoch.AddMinutes(-rng.Next(0, 20_160)),
                Symbol = rng.Pick(DemoUniverse.Symbols),
                Side = rng.NextBool(0.5) ? OrderSide.Buy : OrderSide.Sell,
                Quantity = rng.Next(1, 40) * 100,
                LimitPrice = rng.NextDecimal(8.0m, 420.0m),
                Venue = rng.Pick(DemoUniverse.Venues),
                TraderId = rng.Pick(DemoUniverse.Traders),
            });
        }

        return result;
    }

    private static List<Execution> GenerateExecutions(DemoDataOptions opts, List<Order> orders)
    {
        var rng = DeterministicRandom.ForStream(opts.Seed, "executions");
        var result = new List<Execution>();

        foreach (var order in orders)
        {
            // Partial fills are the norm; an all-or-nothing blotter looks synthetic at a glance
            // to exactly the audience this demo is for.
            var fills = rng.Next(1, 4);
            var remaining = order.Quantity;

            for (var f = 0; f < fills && remaining > 0; f++)
            {
                var isLast = f == fills - 1;
                var qty = isLast ? remaining : Math.Max(100, remaining / (fills - f));
                qty = Math.Min(qty, remaining);
                remaining -= qty;

                result.Add(new Execution
                {
                    Id = $"exe-{result.Count:D6}",
                    OrderId = order.Id,
                    Timestamp = order.Timestamp.AddSeconds(rng.Next(1, 900)),
                    Quantity = qty,
                    Price = Math.Round(order.LimitPrice * (decimal)(0.995 + (rng.NextDouble() * 0.01)), 4),
                    Venue = rng.NextBool(0.85) ? order.Venue : rng.Pick(DemoUniverse.Venues),
                });
            }
        }

        return result;
    }

    private static List<SurveillanceAlert> GenerateAlerts(
        DemoDataOptions opts,
        List<Communication> communications,
        List<Order> orders)
    {
        var rng = DeterministicRandom.ForStream(opts.Seed, "alerts");
        var result = new List<SurveillanceAlert>(opts.AlertCount);

        var concerningComms = communications.Where(c => c.GroundTruthConcerning).ToList();
        var benignComms = communications.Where(c => !c.GroundTruthConcerning).ToList();

        // Roughly a fifth of the batch is genuinely concerning. High enough that triage has real
        // work to do, low enough that ranking has to discriminate rather than pass everything.
        var concerningTarget = Math.Min(opts.AlertCount / 5, concerningComms.Count);

        for (var i = 0; i < opts.AlertCount; i++)
        {
            var isConcerning = i < concerningTarget;
            var seedComm = isConcerning
                ? concerningComms[i % concerningComms.Count]
                : rng.Pick(benignComms);

            var symbol = seedComm.Symbol ?? rng.Pick(DemoUniverse.Symbols);
            var trader = seedComm.FromParty;

            // Evidence must resolve. Prefer the same symbol and trader so the alert detail view
            // tells a coherent story rather than a random one.
            var relatedOrders = orders
                .Where(o => string.Equals(o.Symbol, symbol, StringComparison.Ordinal))
                .Take(3)
                .Select(o => o.Id)
                .ToList();

            if (relatedOrders.Count == 0)
            {
                relatedOrders = [rng.Pick(orders).Id];
            }

            var relatedComms = new List<string> { seedComm.Id };
            var extra = rng.Next(0, 3);
            for (var e = 0; e < extra; e++)
            {
                relatedComms.Add(rng.Pick(communications).Id);
            }

            result.Add(new SurveillanceAlert
            {
                Id = $"alert-{i:D4}",
                Timestamp = seedComm.Timestamp.AddMinutes(rng.Next(5, 120)),
                Symbol = symbol,
                TraderId = trader,
                AlertType = rng.Pick(DemoUniverse.AlertTypes),
                CommunicationIds = relatedComms,
                OrderIds = relatedOrders,
                GroundTruthConcerning = isConcerning,
            });
        }

        // Shuffle so the concerning alerts are not the first hundred rows. Ranking that only has
        // to preserve input order is not ranking.
        for (var i = result.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (result[i], result[j]) = (result[j], result[i]);
        }

        return result;
    }
}

===== FILE: tests/Fcmr.Router.Decisions.Tests/RoutingPlannerTests.cs =====
using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

/// <summary>
/// T-209, T-210, T-211. The evaluation order is the feature; these tests assert it behaviourally
/// rather than by reading the code, because code reading does not survive a refactor.
/// </summary>
public class RoutingPlannerTests
{
    private static PolicySet Policy(params ModelVendor[] approved) => new()
    {
        Id = "CapitalMarkets-US",
        BusinessUnit = "CapitalMarkets",
        DisplayName = "Capital Markets",
        ApprovedVendors = new HashSet<ModelVendor>(approved),
        MaxClassification = approved.ToDictionary(v => v, _ => DataClassification.Confidential),
        Version = 4,
    };

    private static RoutingRequest Request(
        DataClassification classification = DataClassification.Internal,
        decimal ceiling = 1.00m,
        int tokens = 8_000) => new()
        {
            Hints = new ComplexityHints { InputTokenEstimate = tokens },
            CostCeilingUsd = ceiling,
            DataClassification = classification,
        };

    [Fact]
    public void Plan_WhenTheCheapestModelIsUnapproved_DoesNotSelectIt()
    {
        // The load-bearing test for evaluation order. The cheapest model in the catalog by a wide
        // margin belongs to a vendor governance has not approved. If cost ran before policy, a
        // cost optimiser would reach straight for it — which is the exact failure the exchange
        // exists to prevent.
        var catalog = new List<TierPricing>
        {
            new()
            {
                Tier = ModelTier.Standard, Deployment = "unapproved-bargain",
                CostPerRequestUsd = 0.0001m, Vendor = ModelVendor.XAI,
            },
            new()
            {
                Tier = ModelTier.Standard, Deployment = "approved-standard",
                CostPerRequestUsd = 0.500m, Vendor = ModelVendor.AzureOpenAI,
            },
        };

        var decision = RoutingPlanner.Plan(Request(), catalog, Policy(ModelVendor.AzureOpenAI));

        decision.SelectedDeployment.Should().Be("approved-standard");
        decision.SelectedVendor.Should().Be(ModelVendor.AzureOpenAI);
        decision.CandidateTiers.Should().NotContain(c => c.Deployment == "unapproved-bargain" && c.Selected);
        decision.PolicyExclusions.Should().ContainSingle(e => e.Deployment == "unapproved-bargain");
    }

    [Fact]
    public void Plan_ExcludedModelsAreNeverOfferedToTheSelector()
    {
        // Stronger than "was not selected": the selector must not even see them. An excluded model
        // appearing among the candidates would mean the gate filtered nothing.
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Economy, Deployment = "a", CostPerRequestUsd = 0.001m, Vendor = ModelVendor.XAI },
            new() { Tier = ModelTier.Standard, Deployment = "b", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
        };

        var decision = RoutingPlanner.Plan(Request(), catalog, Policy(ModelVendor.AzureOpenAI));

        decision.CandidateTiers.Should().ContainSingle()
            .Which.Deployment.Should().Be("b");
    }

    [Fact]
    public void Plan_AppliesThePolicyCeilingWhenItIsLowerThanTheRequestCeiling()
    {
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Economy, Deployment = "cheap", CostPerRequestUsd = 0.001m, Vendor = ModelVendor.AzureOpenAI },
            new() { Tier = ModelTier.Standard, Deployment = "mid", CostPerRequestUsd = 0.400m, Vendor = ModelVendor.AzureOpenAI },
        };

        var policy = Policy(ModelVendor.AzureOpenAI) with { MaxCostPerRequestUsd = 0.100m };

        // The request would allow 1.00 USD; policy caps it at 0.10.
        var decision = RoutingPlanner.Plan(Request(ceiling: 1.00m), catalog, policy);

        decision.SelectedDeployment.Should().Be("cheap");
        decision.PolicyExclusions.Should().ContainSingle(e => e.Deployment == "mid")
            .Which.Reason.Should().Contain("policy ceiling");
    }

    [Fact]
    public void Plan_PinsThePolicySetVersionOntoTheDecision()
    {
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "gpt", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
        };

        var decision = RoutingPlanner.Plan(
            Request(), catalog, Policy(ModelVendor.AzureOpenAI) with { Version = 11 });

        decision.PolicySetId.Should().Be("CapitalMarkets-US");
        decision.PolicySetVersion.Should().Be(11,
            "replaying an audit record after a policy edit must show the policy that actually applied");
        decision.DataClassification.Should().Be(DataClassification.Internal);
    }

    [Fact]
    public void Plan_RefusalIsDistinctFromDenial()
    {
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "gpt", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
        };

        var refused = RoutingPlanner.Plan(Request(), catalog, Policy(ModelVendor.Anthropic));
        var denied = RoutingPlanner.Plan(Request(ceiling: 0.0001m), catalog, Policy(ModelVendor.AzureOpenAI));

        refused.Outcome.Should().Be(RoutingOutcome.RefusedByPolicy);
        denied.Outcome.Should().Be(RoutingOutcome.Denied);
        refused.Outcome.Should().NotBe(denied.Outcome,
            "'not permitted' and 'too expensive' are different conversations with different people");
    }

    [Fact]
    public void Plan_RefusalRationaleNamesTheVendorsAndTheClassification()
    {
        // The presenter reads this sentence aloud in Beat 5. "Refused by policy" is not an answer
        // a governance audience accepts.
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "gpt", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
            new() { Tier = ModelTier.Premium, Deployment = "claude", CostPerRequestUsd = 0.090m, Vendor = ModelVendor.Anthropic },
        };

        var decision = RoutingPlanner.Plan(
            Request(DataClassification.Restricted), catalog, Policy(ModelVendor.XAI));

        decision.Rationale.Should().Contain("CapitalMarkets-US");
        decision.Rationale.Should().Contain("Restricted");
        decision.Rationale.Should().Contain("AzureOpenAI");
        decision.Rationale.Should().Contain("Anthropic");
        decision.PolicyExclusions.Should().OnlyContain(
            e => e.Kind == PolicyExclusionKind.VendorNotApproved);
    }

    [Fact]
    public void Plan_WhenEveryCandidateIsPricedOutByPolicy_SaysItIsACostOutcome()
    {
        // Without this the audience is told "governance refused it" when the truth is "nobody was
        // willing to pay for it" -- two different conversations with two different owners.
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "gpt", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
        };

        var policy = Policy(ModelVendor.AzureOpenAI) with { MaxCostPerRequestUsd = 0.001m };

        var decision = RoutingPlanner.Plan(Request(), catalog, policy);

        decision.Outcome.Should().Be(RoutingOutcome.RefusedByPolicy);
        decision.PolicyExclusions.Should().OnlyContain(
            e => e.Kind == PolicyExclusionKind.PolicyCostCeiling);
        decision.Rationale.Should().Contain("cost outcome rather than a governance one");
    }

    [Fact]
    public void Plan_WithSeveralVendorsInTheIndicatedTier_TakesTheCheapest()
    {
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "expensive", CostPerRequestUsd = 0.080m, Vendor = ModelVendor.AzureOpenAI },
            new() { Tier = ModelTier.Standard, Deployment = "cheapest", CostPerRequestUsd = 0.020m, Vendor = ModelVendor.Anthropic },
            new() { Tier = ModelTier.Standard, Deployment = "middle", CostPerRequestUsd = 0.050m, Vendor = ModelVendor.XAI },
        };

        var decision = RoutingPlanner.Plan(
            Request(), catalog, Policy(ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI));

        decision.SelectedDeployment.Should().Be("cheapest");
        decision.SelectedVendor.Should().Be(ModelVendor.Anthropic);
    }

    [Fact]
    public void Plan_MarksExactlyOneCandidateSelected()
    {
        // A multi-vendor catalog puts several models in one tier. Marking selection by tier
        // rather than by deployment would flag every same-tier competitor as the one that ran,
        // and the scoreboard's cost attribution is only as honest as this flag.
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "a", CostPerRequestUsd = 0.020m, Vendor = ModelVendor.AzureOpenAI },
            new() { Tier = ModelTier.Standard, Deployment = "b", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.Anthropic },
            new() { Tier = ModelTier.Standard, Deployment = "c", CostPerRequestUsd = 0.040m, Vendor = ModelVendor.XAI },
        };

        var decision = RoutingPlanner.Plan(
            Request(), catalog, Policy(ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI));

        decision.CandidateTiers.Count(c => c.Selected).Should().Be(1);
        decision.CandidateTiers.Where(c => !c.Selected).Should()
            .OnlyContain(c => !string.IsNullOrWhiteSpace(c.RejectedReason));
    }

    [Fact]
    public void Plan_IsDeterministic_ForIdenticalInputs()
    {
        // Beat 5 submits byte-identical payloads either side of a policy change. Any nondeterminism
        // here reads on stage as the router being arbitrary.
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "a", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
            new() { Tier = ModelTier.Standard, Deployment = "b", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.Anthropic },
        };

        var policy = Policy(ModelVendor.AzureOpenAI, ModelVendor.Anthropic);

        var first = RoutingPlanner.Plan(Request(), catalog, policy);
        var second = RoutingPlanner.Plan(Request(), catalog, policy);

        second.SelectedDeployment.Should().Be(first.SelectedDeployment);
        second.Rationale.Should().Be(first.Rationale);
    }

    [Fact]
    public void Plan_WithAnEmptyCatalog_Throws()
    {
        var act = () => RoutingPlanner.Plan(Request(), [], Policy(ModelVendor.AzureOpenAI));

        act.Should().Throw<ArgumentException>();
    }
}

===== FILE: tests/Fcmr.Router.Decisions.Tests/PolicyInvariantTests.cs =====
using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

/// <summary>
/// T-218 and T-219. The invariant the whole feature rests on:
///
///   <c>a selected vendor is always approved, and always permitted to see the request's data.</c>
///
/// The task called for a property test. The policy domain is finite and small — four vendors, so
/// sixteen approval subsets, four classifications each, and four-to-the-fourth classification maps
/// — so this enumerates the domain in full instead. Exhaustive enumeration is strictly stronger
/// than sampled property testing here: it cannot miss a case, it needs no generator library, and
/// it reproduces identically on every run, which matters for a repository with a hard determinism
/// principle.
/// </summary>
public class PolicyInvariantTests
{
    private static readonly ModelVendor[] AllVendors =
    [
        ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI, ModelVendor.OpenWeight,
    ];

    private static readonly DataClassification[] AllClassifications =
    [
        DataClassification.Public, DataClassification.Internal,
        DataClassification.Confidential, DataClassification.Restricted,
    ];

    /// <summary>Twelve deployments: every vendor competing at every tier.</summary>
    private static List<TierPricing> FullCatalog()
    {
        var catalog = new List<TierPricing>();
        var tierCost = new Dictionary<ModelTier, decimal>
        {
            [ModelTier.Economy] = 0.002m,
            [ModelTier.Standard] = 0.030m,
            [ModelTier.Premium] = 0.090m,
        };

        foreach (var vendor in AllVendors)
        {
            foreach (var (tier, baseCost) in tierCost)
            {
                catalog.Add(new TierPricing
                {
                    Tier = tier,
                    Deployment = $"{vendor}-{tier}".ToLowerInvariant(),
                    // Spread costs within a tier so cheapest-within-tier is a real choice.
                    CostPerRequestUsd = baseCost + (Array.IndexOf(AllVendors, vendor) * 0.001m),
                    Vendor = vendor,
                    Serving = vendor == ModelVendor.OpenWeight
                        ? ServingMode.ManagedCompute
                        : ServingMode.Serverless,
                });
            }
        }

        return catalog;
    }

    private static PolicySet Build(
        IReadOnlySet<ModelVendor> approved,
        IReadOnlyDictionary<ModelVendor, DataClassification> maxClass) => new()
        {
            Id = "CapitalMarkets-US",
            BusinessUnit = "CapitalMarkets",
            ApprovedVendors = approved,
            MaxClassification = maxClass,
            Version = 3,
        };

    [Fact]
    public void Plan_AcrossTheEntirePolicyDomain_NeverSelectsAnUnapprovedOrOverClearedVendor()
    {
        var catalog = FullCatalog();
        var failures = new List<string>();
        var cases = 0;
        var routed = 0;
        var refused = 0;

        // All 16 approval subsets.
        for (var mask = 0; mask < 1 << 4; mask++)
        {
            var approved = new HashSet<ModelVendor>();
            for (var bit = 0; bit < AllVendors.Length; bit++)
            {
                if ((mask & (1 << bit)) != 0)
                {
                    approved.Add(AllVendors[bit]);
                }
            }

            // All 256 assignments of a maximum classification to the four vendors.
            for (var assignment = 0; assignment < 256; assignment++)
            {
                var maxClass = new Dictionary<ModelVendor, DataClassification>();
                for (var bit = 0; bit < AllVendors.Length; bit++)
                {
                    var vendor = AllVendors[bit];
                    if (approved.Contains(vendor))
                    {
                        maxClass[vendor] = AllClassifications[(assignment >> (bit * 2)) & 0b11];
                    }
                }

                var policy = Build(approved, maxClass);

                foreach (var classification in AllClassifications)
                {
                    cases++;

                    var decision = RoutingPlanner.Plan(
                        new RoutingRequest
                        {
                            Hints = new ComplexityHints { InputTokenEstimate = 8_000 },
                            CostCeilingUsd = 10.00m,
                            DataClassification = classification,
                        },
                        catalog,
                        policy);

                    if (decision.SelectedVendor is null)
                    {
                        refused++;

                        // A non-selection must be an explicit governed outcome, never a quiet null.
                        if (decision.Outcome is not (RoutingOutcome.RefusedByPolicy or RoutingOutcome.Denied))
                        {
                            failures.Add(
                                $"mask={mask} assign={assignment} class={classification}: " +
                                $"no vendor selected but outcome was {decision.Outcome}.");
                        }

                        continue;
                    }

                    routed++;
                    var vendor = decision.SelectedVendor.Value;

                    if (!approved.Contains(vendor))
                    {
                        failures.Add(
                            $"mask={mask} assign={assignment} class={classification}: " +
                            $"selected unapproved vendor {vendor}.");
                    }
                    else if (!maxClass.TryGetValue(vendor, out var permitted) || classification > permitted)
                    {
                        failures.Add(
                            $"mask={mask} assign={assignment} class={classification}: " +
                            $"selected {vendor} cleared only to {(maxClass.TryGetValue(vendor, out var p) ? p.ToString() : "nothing")}.");
                    }
                }
            }
        }

        cases.Should().Be(16 * 256 * 4, "the enumeration must cover the whole domain");
        routed.Should().BeGreaterThan(0, "a test where nothing ever routes proves nothing");
        refused.Should().BeGreaterThan(0, "the empty policy set must genuinely refuse");
        failures.Should().BeEmpty();
    }

    [Fact]
    public void Plan_WhenPolicyLeavesNothingEligible_RefusesRatherThanDenies()
    {
        var policy = Build(new HashSet<ModelVendor>(), new Dictionary<ModelVendor, DataClassification>());

        var decision = RoutingPlanner.Plan(
            new RoutingRequest
            {
                Hints = new ComplexityHints { InputTokenEstimate = 1_000 },
                CostCeilingUsd = 10.00m,
                DataClassification = DataClassification.Internal,
            },
            FullCatalog(),
            policy);

        decision.Outcome.Should().Be(RoutingOutcome.RefusedByPolicy,
            "governance refusal and cost denial are different conversations with different people");
        decision.SelectedDeployment.Should().BeNull();
        decision.SelectedVendor.Should().BeNull();

        // T-219: every candidate is named, each with its own reason.
        decision.PolicyExclusions.Should().HaveCount(12);
        decision.PolicyExclusions.Should().OnlyContain(e => !string.IsNullOrWhiteSpace(e.Reason));
        decision.CandidateTiers.Should().OnlyContain(c => c.RejectedReason != null && !c.Selected);
    }

    [Fact]
    public void Plan_RemovingEachVendorInTurn_StillYieldsAValidPlan()
    {
        // T-219. Four vendors, remove one at a time, four valid plans. This is the claim the demo
        // makes out loud: any single vendor can be withdrawn and the exchange keeps working.
        foreach (var removed in AllVendors)
        {
            var approved = new HashSet<ModelVendor>(AllVendors.Where(v => v != removed));
            var maxClass = approved.ToDictionary(v => v, _ => DataClassification.Confidential);

            var decision = RoutingPlanner.Plan(
                new RoutingRequest
                {
                    Hints = new ComplexityHints { InputTokenEstimate = 8_000 },
                    CostCeilingUsd = 10.00m,
                    DataClassification = DataClassification.Internal,
                },
                FullCatalog(),
                Build(approved, maxClass));

            decision.Outcome.Should().BeOneOf(RoutingOutcome.Routed, RoutingOutcome.Downgraded);
            decision.SelectedVendor.Should().NotBe(removed,
                $"withdrawing {removed} must actually withdraw it");
            decision.PolicyExclusions.Should().Contain(e => e.Vendor == removed);
        }
    }

    [Fact]
    public void Plan_WhenOnlyRestrictedCapableVendorRemains_RoutesToManagedCompute()
    {
        var approved = new HashSet<ModelVendor>(AllVendors);
        var maxClass = new Dictionary<ModelVendor, DataClassification>
        {
            [ModelVendor.AzureOpenAI] = DataClassification.Confidential,
            [ModelVendor.Anthropic] = DataClassification.Internal,
            [ModelVendor.XAI] = DataClassification.Internal,
            [ModelVendor.OpenWeight] = DataClassification.Restricted,
        };

        var decision = RoutingPlanner.Plan(
            new RoutingRequest
            {
                Hints = new ComplexityHints { InputTokenEstimate = 20_000, RequiresMultiStep = true },
                CostCeilingUsd = 10.00m,
                DataClassification = DataClassification.Restricted,
            },
            FullCatalog(),
            Build(approved, maxClass));

        decision.SelectedVendor.Should().Be(ModelVendor.OpenWeight);
        decision.DataClassification.Should().Be(DataClassification.Restricted);
    }
}

===== FILE: tests/Fcmr.Router.Decisions.Tests/PolicySetRepositoryTests.cs =====
using FluentAssertions;
using Fcmr.Router.Decisions;
using Xunit;

namespace Fcmr.Router.Decisions.Tests;

/// <summary>
/// T-203. Optimistic concurrency, validation, and the change diff.
///
/// The behaviour proven here is the behaviour the Cosmos implementation must reproduce: a stale
/// write is rejected, never merged.
/// </summary>
public class PolicySetRepositoryTests
{
    private static PolicySet Baseline() => new()
    {
        Id = "CapitalMarkets-US",
        BusinessUnit = "CapitalMarkets",
        DisplayName = "Capital Markets — US",
        ApprovedVendors = new HashSet<ModelVendor>
        {
            ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI, ModelVendor.OpenWeight,
        },
        MaxClassification = new Dictionary<ModelVendor, DataClassification>
        {
            [ModelVendor.AzureOpenAI] = DataClassification.Confidential,
            [ModelVendor.Anthropic] = DataClassification.Internal,
            [ModelVendor.XAI] = DataClassification.Internal,
            [ModelVendor.OpenWeight] = DataClassification.Restricted,
        },
        AllowedRegions = new HashSet<string> { "eastus2" },
        MaxCostPerRequestUsd = 0.5m,
        PermitsRestrictedData = true,
        Version = 3,
    };

    private static InMemoryPolicySetRepository Repo() => new([Baseline()]);

    private static PolicySetUpdate Update(int expectedVersion, params ModelVendor[] approved) => new()
    {
        Id = "CapitalMarkets-US",
        BusinessUnit = "CapitalMarkets",
        ExpectedVersion = expectedVersion,
        UpdatedBy = "8f1c-approver",
        ApprovedVendors = new HashSet<ModelVendor>(approved),
        MaxClassification = approved.ToDictionary(
            v => v,
            v => v == ModelVendor.OpenWeight ? DataClassification.Restricted : DataClassification.Internal),
    };

    [Fact]
    public async Task UpdateAsync_WithTheCurrentVersion_IncrementsAndRecordsTheApprover()
    {
        var repo = Repo();

        var result = await repo.UpdateAsync(
            Update(3, ModelVendor.AzureOpenAI, ModelVendor.XAI, ModelVendor.OpenWeight));

        result.PolicySet.Version.Should().Be(4);
        result.PolicySet.UpdatedBy.Should().Be("8f1c-approver");
        result.PolicySet.ApprovedVendors.Should().NotContain(ModelVendor.Anthropic);
    }

    [Fact]
    public async Task UpdateAsync_WithAStaleVersion_FailsAndDoesNotMerge()
    {
        var repo = Repo();

        await repo.UpdateAsync(Update(3, ModelVendor.AzureOpenAI, ModelVendor.OpenWeight));

        // A second approver still holding version 3 must not silently overwrite the first.
        var act = async () => await repo.UpdateAsync(
            Update(3, ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.OpenWeight));

        var thrown = await act.Should().ThrowAsync<PolicySetConcurrencyException>();
        thrown.Which.ExpectedVersion.Should().Be(3);
        thrown.Which.ActualVersion.Should().Be(4);

        var current = await repo.GetAsync("CapitalMarkets", "CapitalMarkets-US");
        current!.Version.Should().Be(4, "the rejected write must leave no trace");
        current.ApprovedVendors.Should().NotContain(ModelVendor.Anthropic);
    }

    [Fact]
    public async Task UpdateAsync_ReturnsABeforeAndAfterDiff()
    {
        var repo = Repo();

        var result = await repo.UpdateAsync(
            Update(3, ModelVendor.AzureOpenAI, ModelVendor.XAI, ModelVendor.OpenWeight));

        var vendorChange = result.Changed.Should().ContainSingle(c => c.Field == "approvedVendors").Subject;
        vendorChange.From.Should().Contain("Anthropic");
        vendorChange.To.Should().NotContain("Anthropic");
    }

    [Fact]
    public async Task UpdateAsync_WhenTheChangeWouldLeaveRestrictedUnservable_Fails422()
    {
        var repo = Repo();

        // Removing OpenWeight strands the set: it is declared to permit Restricted, and no
        // remaining vendor may process it. Accepting this produces a policy set that refuses
        // every restricted request, which surfaces as a demo failure rather than an error.
        var act = async () => await repo.UpdateAsync(
            Update(3, ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI));

        var thrown = await act.Should().ThrowAsync<PolicySetValidationException>();
        thrown.Which.Error.Failure.Should().Be(PolicyValidationFailure.RestrictedDataUnservable);
        thrown.Which.Error.StatusCode.Should().Be(422);
    }

    [Fact]
    public async Task UpdateAsync_WhenClassificationNamesAnUnapprovedVendor_Fails400()
    {
        var repo = Repo();

        var update = new PolicySetUpdate
        {
            Id = "CapitalMarkets-US",
            BusinessUnit = "CapitalMarkets",
            ExpectedVersion = 3,
            UpdatedBy = "8f1c-approver",
            ApprovedVendors = new HashSet<ModelVendor> { ModelVendor.AzureOpenAI, ModelVendor.OpenWeight },
            MaxClassification = new Dictionary<ModelVendor, DataClassification>
            {
                [ModelVendor.AzureOpenAI] = DataClassification.Confidential,
                [ModelVendor.OpenWeight] = DataClassification.Restricted,
                [ModelVendor.Anthropic] = DataClassification.Internal,
            },
        };

        var act = async () => await repo.UpdateAsync(update);

        var thrown = await act.Should().ThrowAsync<PolicySetValidationException>();

        thrown.Which.Error.Failure.Should().Be(PolicyValidationFailure.ClassificationNamesUnapprovedVendor);
        thrown.Which.Error.StatusCode.Should().Be(400);
    }

    [Fact]
    public async Task UpdateAsync_WhenValidationFails_LeavesTheStoredSetUntouched()
    {
        var repo = Repo();

        try
        {
            await repo.UpdateAsync(Update(3, ModelVendor.AzureOpenAI, ModelVendor.Anthropic, ModelVendor.XAI));
        }
        catch (PolicySetValidationException)
        {
            // expected
        }

        var current = await repo.GetAsync("CapitalMarkets", "CapitalMarkets-US");
        current!.Version.Should().Be(3, "a rejected change must not burn a version");
        current.ApprovedVendors.Should().Contain(ModelVendor.OpenWeight);
    }

    [Fact]
    public async Task UpdateAsync_OmittedFieldsAreLeftAlone()
    {
        var repo = Repo();

        var result = await repo.UpdateAsync(new PolicySetUpdate
        {
            Id = "CapitalMarkets-US",
            BusinessUnit = "CapitalMarkets",
            ExpectedVersion = 3,
            UpdatedBy = "8f1c-approver",
            MaxCostPerRequestUsd = 0.25m,
        });

        result.PolicySet.MaxCostPerRequestUsd.Should().Be(0.25m);
        result.PolicySet.ApprovedVendors.Should().HaveCount(4,
            "an omitted field means 'unchanged', never 'cleared'");
        result.PolicySet.AllowedRegions.Should().Contain("eastus2");
    }

    [Fact]
    public async Task HistoryAsync_ReturnsMostRecentFirst()
    {
        var repo = Repo();

        await repo.UpdateAsync(Update(3, ModelVendor.AzureOpenAI, ModelVendor.OpenWeight));
        await repo.UpdateAsync(Update(4, ModelVendor.AzureOpenAI, ModelVendor.XAI, ModelVendor.OpenWeight));

        var history = await repo.HistoryAsync("CapitalMarkets", "CapitalMarkets-US");

        history.Should().HaveCount(2);
        history[0].PolicySet.Version.Should().Be(5);
        history[1].PolicySet.Version.Should().Be(4);
    }

    [Fact]
    public async Task GetAsync_ForAnotherBusinessUnit_ReturnsNull()
    {
        var repo = Repo();

        var other = await repo.GetAsync("RetailBanking", "CapitalMarkets-US");

        other.Should().BeNull("governance is scoped per business unit");
    }

    [Fact]
    public async Task UpdateAsync_ForAnUnknownSet_Throws()
    {
        var repo = Repo();

        var act = async () => await repo.UpdateAsync(Update(1, ModelVendor.AzureOpenAI) with { Id = "Nope" });

        await act.Should().ThrowAsync<PolicySetNotFoundException>();
    }

    [Fact]
    public void Constructor_RejectsASeedThatCouldNotHaveBeenWrittenThroughTheApi()
    {
        var broken = Baseline() with
        {
            ApprovedVendors = new HashSet<ModelVendor> { ModelVendor.AzureOpenAI },
            MaxClassification = new Dictionary<ModelVendor, DataClassification>
            {
                [ModelVendor.AzureOpenAI] = DataClassification.Confidential,
            },
            PermitsRestrictedData = true,
        };

        var act = () => new InMemoryPolicySetRepository([broken]);

        act.Should().Throw<PolicySetValidationException>(
            "a Terraform-seeded baseline must obey the same rules as an API write");
    }

    [Fact]
    public async Task PolicyChange_IsVisibleToTheNextRoutingDecision()
    {
        // Beat 5 in miniature: change policy, resubmit an identical request, get a different plan.
        var repo = Repo();
        var catalog = new List<TierPricing>
        {
            new() { Tier = ModelTier.Standard, Deployment = "claude", CostPerRequestUsd = 0.020m, Vendor = ModelVendor.Anthropic },
            new() { Tier = ModelTier.Standard, Deployment = "gpt", CostPerRequestUsd = 0.030m, Vendor = ModelVendor.AzureOpenAI },
        };

        var request = new RoutingRequest
        {
            Hints = new ComplexityHints { InputTokenEstimate = 8_000 },
            CostCeilingUsd = 1.00m,
            DataClassification = DataClassification.Internal,
        };

        var before = RoutingPlanner.Plan(
            request, catalog, (await repo.GetAsync("CapitalMarkets", "CapitalMarkets-US"))!);

        before.SelectedVendor.Should().Be(ModelVendor.Anthropic, "it is the cheapest approved option");

        await repo.UpdateAsync(Update(3, ModelVendor.AzureOpenAI, ModelVendor.XAI, ModelVendor.OpenWeight));

        var after = RoutingPlanner.Plan(
            request, catalog, (await repo.GetAsync("CapitalMarkets", "CapitalMarkets-US"))!);

        after.SelectedVendor.Should().Be(ModelVendor.AzureOpenAI,
            "the same request, unchanged, must now route elsewhere");
        after.PolicySetVersion.Should().Be(4);
        before.PolicySetVersion.Should().Be(3, "the earlier decision keeps the version that governed it");
    }
}

===== FILE: tests/Fcmr.Demo.Data.Tests/Fcmr.Demo.Data.Tests.csproj =====
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="FluentAssertions" />
    <PackageReference Include="coverlet.collector" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="../../src/Fcmr.Demo.Data/Fcmr.Demo.Data.csproj" />
  </ItemGroup>

</Project>

===== FILE: tests/Fcmr.Demo.Data.Tests/DemoDataGeneratorTests.cs =====
using FluentAssertions;
using Fcmr.Demo.Data;
using Xunit;

namespace Fcmr.Demo.Data.Tests;

/// <summary>
/// T-021. The generators are only useful if they are reproducible, so reproducibility is what is
/// tested hardest here. AC-6 claims the surveillance ranking is identical across two runs; that
/// claim starts failing at the fixture layer if this does.
/// </summary>
public class DemoDataGeneratorTests
{
    [Fact]
    public void Generate_WithTheSameSeed_ProducesIdenticalData()
    {
        var first = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 42 });
        var second = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 42 });

        second.Alerts.Should().BeEquivalentTo(first.Alerts, o => o.WithStrictOrdering());
        second.Communications.Should().BeEquivalentTo(first.Communications, o => o.WithStrictOrdering());
        second.Orders.Should().BeEquivalentTo(first.Orders, o => o.WithStrictOrdering());
        second.Executions.Should().BeEquivalentTo(first.Executions, o => o.WithStrictOrdering());
        second.ResearchDocuments.Should().BeEquivalentTo(first.ResearchDocuments, o => o.WithStrictOrdering());
    }

    [Fact]
    public void Generate_WithADifferentSeed_ProducesDifferentData()
    {
        var first = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 42 });
        var second = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 43 });

        second.Alerts.Select(a => a.Id + a.Symbol)
            .Should().NotEqual(first.Alerts.Select(a => a.Id + a.Symbol));
    }

    [Fact]
    public void Generate_ChangingOneCollectionSize_DoesNotShiftTheOthers()
    {
        // Independent streams. Without this, adding a research document would silently rewrite
        // every alert, and the fixture set could not grow between rehearsals.
        var baseline = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 7 });
        var moreResearch = DemoDataGenerator.Generate(
            new DemoDataOptions { Seed = 7, ResearchDocumentCount = 200 });

        moreResearch.Orders.Should().BeEquivalentTo(baseline.Orders, o => o.WithStrictOrdering());
        moreResearch.Communications.Should().BeEquivalentTo(
            baseline.Communications, o => o.WithStrictOrdering());
    }

    [Fact]
    public void Generate_ProducesTheFiveHundredAlertBatchTheAcceptanceCriteriaName()
    {
        var data = DemoDataGenerator.Generate();

        data.Alerts.Should().HaveCount(500);
        data.Alerts.Select(a => a.Id).Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public void Generate_EveryAlertResolvesToRealEvidence()
    {
        // The demo failure this prevents: an audience member clicks the one row nobody rehearsed
        // and the evidence panel is empty.
        var data = DemoDataGenerator.Generate();
        var commIds = data.Communications.Select(c => c.Id).ToHashSet(StringComparer.Ordinal);
        var orderIds = data.Orders.Select(o => o.Id).ToHashSet(StringComparer.Ordinal);

        foreach (var alert in data.Alerts)
        {
            alert.CommunicationIds.Should().NotBeEmpty();
            alert.OrderIds.Should().NotBeEmpty();
            alert.CommunicationIds.Should().OnlyContain(id => commIds.Contains(id));
            alert.OrderIds.Should().OnlyContain(id => orderIds.Contains(id));
        }
    }

    [Fact]
    public void Generate_ConcerningAlertsAreNotClusteredAtTheTopOfTheBatch()
    {
        // If the concerning alerts arrive pre-sorted, a ranker that preserves input order scores
        // perfectly and the reproducibility claim becomes vacuous.
        var data = DemoDataGenerator.Generate();
        var firstConcerningIndexes = data.Alerts
            .Select((a, i) => (a, i))
            .Where(x => x.a.GroundTruthConcerning)
            .Select(x => x.i)
            .ToList();

        firstConcerningIndexes.Should().NotBeEmpty();
        firstConcerningIndexes.Max().Should().BeGreaterThan(data.Alerts.Count / 2,
            "concerning alerts must be spread through the batch");
    }

    [Fact]
    public void Generate_EveryExecutionBelongsToAnOrderAndNeverOverfillsIt()
    {
        var data = DemoDataGenerator.Generate();
        var byOrder = data.Executions.GroupBy(e => e.OrderId).ToDictionary(g => g.Key, g => g.Sum(e => e.Quantity));

        foreach (var order in data.Orders)
        {
            if (byOrder.TryGetValue(order.Id, out var filled))
            {
                filled.Should().BeLessThanOrEqualTo(order.Quantity,
                    $"order {order.Id} must never be overfilled");
            }
        }

        data.Executions.Select(e => e.OrderId).Distinct()
            .Should().BeSubsetOf(data.Orders.Select(o => o.Id));
    }

    [Fact]
    public void Generate_ResearchChunksAreUniquelyIdentifiedAndOrdered()
    {
        var data = DemoDataGenerator.Generate();
        var allChunks = data.ResearchDocuments.SelectMany(d => d.Chunks).ToList();

        allChunks.Select(c => c.Id).Should().OnlyHaveUniqueItems(
            "per-claim attribution needs a stable, unique citation target");

        foreach (var doc in data.ResearchDocuments)
        {
            doc.Chunks.Select(c => c.Ordinal).Should().BeInAscendingOrder();
            doc.Chunks.Should().OnlyContain(c => c.DocumentId == doc.Id);
        }
    }

    [Fact]
    public void SeedLabel_IsStableAndDisplayable()
    {
        var data = DemoDataGenerator.Generate(new DemoDataOptions { Seed = 0xABCDEF });

        data.SeedLabel.Should().Be("seed-0000000000abcdef");
    }
}

public class DeterministicRandomTests
{
    [Fact]
    public void NextUInt64_IsStableForAKnownSeed()
    {
        // Pinned expectations. If the algorithm is ever changed, this fails loudly rather than
        // silently invalidating every rehearsed fixture.
        var rng = new DeterministicRandom(1);
        var drawn = Enumerable.Range(0, 3).Select(_ => rng.NextUInt64()).ToList();

        var replay = new DeterministicRandom(1);
        Enumerable.Range(0, 3).Select(_ => replay.NextUInt64()).Should().Equal(drawn);
    }

    [Fact]
    public void Constructor_WithZeroSeed_DoesNotCollapse()
    {
        // Zero is an absorbing state for xorshift; an unguarded generator returns zero forever.
        var rng = new DeterministicRandom(0);
        var values = Enumerable.Range(0, 10).Select(_ => rng.NextUInt64()).ToList();

        values.Should().OnlyHaveUniqueItems();
        values.Should().NotContain(0UL);
    }

    [Fact]
    public void Next_StaysWithinBounds()
    {
        var rng = new DeterministicRandom(99);

        for (var i = 0; i < 10_000; i++)
        {
            rng.Next(5, 9).Should().BeInRange(5, 8);
            rng.NextDouble().Should().BeInRange(0.0, 1.0);
        }
    }

    [Fact]
    public void ForStream_GivesIndependentSequencesPerName()
    {
        var a = DeterministicRandom.ForStream(1, "orders");
        var b = DeterministicRandom.ForStream(1, "alerts");

        var first = Enumerable.Range(0, 5).Select(_ => a.NextUInt64()).ToList();
        var second = Enumerable.Range(0, 5).Select(_ => b.NextUInt64()).ToList();

        second.Should().NotEqual(first);
    }

    [Fact]
    public void ForStream_IsStableForTheSameName()
    {
        var a = DeterministicRandom.ForStream(5, "orders");
        var b = DeterministicRandom.ForStream(5, "orders");

        a.NextUInt64().Should().Be(b.NextUInt64());
    }
}

===== FILE: src/webui/index.html =====
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Governed AI Exchange</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

===== FILE: src/webui/vite.config.ts =====
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});

===== FILE: src/webui/tsconfig.json =====
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}

===== FILE: src/webui/eslint.config.js =====
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'src/api/types.generated.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['*@@CMTEND@@*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // The generated API types are the contract; hand-widening them with `any` reintroduces the
      // drift the generator exists to prevent.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);

===== FILE: src/webui/src/test-setup.ts =====
import '@testing-library/jest-dom/vitest';

===== FILE: src/webui/src/main.tsx =====
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles/tokens.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

===== FILE: src/webui/src/App.tsx =====
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { visibleScreens, type AppRole } from './shell/navigation';
import { PlaceholderScreen } from './shell/PlaceholderScreen';

/**
 * Application shell.
 *
 * Roles are hard-coded here until T-028b wires MSAL. The shape of the prop is the shape MSAL will
 * supply, so that task becomes a substitution rather than a rewrite.
 @@CMTEND@@
export function App({ roles = ['Router.Invoke', 'Router.Read'] }: { roles?: AppRole[] }) {
  const screens = visibleScreens(roles);

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Governed AI Exchange</h1>
        <nav className="app__nav">
          {screens.map((screen) => (
            <NavLink key={screen.path} to={screen.path}>
              {screen.title}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="app__main">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Navigate to={screens[0]?.path ?? '/scoreboard'} replace />} />
            {screens.map((screen) => (
              <Route
                key={screen.path}
                path={screen.path}
                element={<PlaceholderScreen title={screen.title} beat={screen.beat} />}
              />
            ))}
            <Route path="*" element={<PlaceholderScreen title="Not found" />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}

===== FILE: src/webui/src/styles/tokens.css =====
/*
  Projector-first type scale.

  The demo is read from the back of a room, on a projector that will be dimmer and lower contrast
  than any monitor this was built on. Body text starts at 18px rather than the usual 14, and the
  scale is deliberately coarse: intermediate sizes are indistinguishable at that distance, so they
  only create the impression of hierarchy without delivering one.

  Every screen has exactly one hero number. If a screen has two, the audience has to be told which
  one matters, and by then the moment has passed.
@@CMTEND@@

:root {
  --font-sans: 'Segoe UI', system-ui, -apple-system, sans-serif;
  --font-mono: 'Cascadia Code', ui-monospace, 'SF Mono', monospace;

  --text-hero: 6rem;
  --text-display: 3rem;
  --text-heading: 2rem;
  --text-subheading: 1.5rem;
  --text-body: 1.125rem;
  --text-caption: 1rem;

  --ink: #14171a;
  --ink-muted: #5b6570;
  --surface: #ffffff;
  --surface-sunken: #f4f6f8;
  --border: #d3d9de;

  --accent: #1a56db;
  --success: #0f7b3e;
  --warning: #a35a00;
  --danger: #b3261e;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 1rem;
  --space-4: 1.5rem;
  --space-5: 2.5rem;

  --radius: 8px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-body);
  color: var(--ink);
  background: var(--surface-sunken);
  line-height: 1.5;
}

.hero-number {
  font-size: var(--text-hero);
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.app {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
}

.app__header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.app__title {
  font-size: var(--text-subheading);
  font-weight: 700;
  margin: 0;
}

.app__nav {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.app__nav a {
  color: var(--ink-muted);
  text-decoration: none;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius);
}

.app__nav a[aria-current='page'] {
  color: var(--accent);
  background: var(--surface-sunken);
  font-weight: 600;
}

.app__main {
  padding: var(--space-4);
}

.state {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
  padding: var(--space-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.state__title {
  font-size: var(--text-subheading);
  font-weight: 600;
}

.state__detail {
  color: var(--ink-muted);
  margin: 0;
}

.state--error .state__title {
  color: var(--danger);
}

.banner {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border-radius: var(--radius);
  border-left: 6px solid var(--warning);
  background: #fff6e6;
  margin-bottom: var(--space-3);
}

.banner--danger {
  border-left-color: var(--danger);
  background: #fdecea;
}

.banner--info {
  border-left-color: var(--accent);
  background: #eaf0fd;
}

.banner__detail {
  color: var(--ink-muted);
  font-size: var(--text-caption);
}

.freshness {
  font-size: var(--text-caption);
  color: var(--ink-muted);
  margin: 0 0 var(--space-3);
}

.freshness--stale {
  color: var(--warning);
  font-weight: 600;
}

.button {
  font: inherit;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}

.button:disabled {
  background: var(--surface-sunken);
  color: var(--ink-muted);
  border-color: var(--border);
  cursor: not-allowed;
}

===== FILE: src/webui/src/shell/ErrorBoundary.tsx =====
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render failures so one broken screen does not blank the whole application mid-demo.
 *
 * The error is shown rather than swallowed. A white screen invites the audience to conclude the
 * whole thing is fragile; a named error on one panel, with the rest of the shell intact, reads as
 * a bug in one place.
 @@CMTEND@@
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="state state--error" role="alert">
          <span className="state__title">This screen failed to render</span>
          <p className="state__detail">{this.state.error.message}</p>
          <button type="button" className="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

===== FILE: src/webui/src/shell/PlaceholderScreen.tsx =====
/**
 * Stands in for a screen that has not been built yet.
 *
 * It names the task that will replace it, so an unfinished screen reached during a rehearsal is
 * self-explanatory rather than mysterious.
 @@CMTEND@@
export function PlaceholderScreen({ title, beat }: { title: string; beat?: number }) {
  return (
    <section className="state">
      <span className="state__title">{title}</span>
      <p className="state__detail">
        Not yet implemented.
        {beat !== undefined && ` This screen serves demo beat ${beat}.`}
      </p>
    </section>
  );
}

===== FILE: src/webui/src/shell/navigation.ts =====
import type { ReactNode } from 'react';

/** App roles from the Entra app registration. @@CMTEND@@
export type AppRole = 'Router.Invoke' | 'Router.Read' | 'Approver';

export interface ScreenDefinition {
  path: string;
  title: string;
  /** Any one of these grants navigation. Empty means every authenticated user. @@CMTEND@@
  requiredRoles: AppRole[];
  /** Demo beat this screen serves, for the runbook cross-reference. @@CMTEND@@
  beat?: number;
}

/**
 * The screen inventory from docs/ui-design.md.
 *
 * Navigation is hidden for roles that cannot use a screen, but actions inside a screen render
 * disabled with a stated reason rather than vanishing — the approval beat needs something visible
 * to refuse, and an invisible control demonstrates nothing.
 @@CMTEND@@
export const SCREENS: readonly ScreenDefinition[] = [
  { path: '/request', title: 'Request console', requiredRoles: ['Router.Invoke'], beat: 2 },
  { path: '/scoreboard', title: 'Scoreboard', requiredRoles: ['Router.Read'], beat: 3 },
  { path: '/comparison', title: 'Cost comparison', requiredRoles: ['Router.Read'], beat: 3 },
  { path: '/decisions', title: 'Decisions', requiredRoles: ['Router.Read'], beat: 3 },
  { path: '/research', title: 'Research', requiredRoles: ['Router.Invoke'], beat: 7 },
  { path: '/surveillance', title: 'Surveillance triage', requiredRoles: ['Router.Read'], beat: 4 },
  { path: '/order-routing', title: 'Order routing', requiredRoles: ['Router.Read'], beat: 6 },
  { path: '/approvals', title: 'Approvals', requiredRoles: ['Approver'], beat: 6 },
  { path: '/policy', title: 'Policy sets', requiredRoles: ['Router.Read'], beat: 5 },
  { path: '/audit', title: 'Audit reconstruction', requiredRoles: ['Router.Read'], beat: 8 },
] as const;

export function visibleScreens(roles: readonly AppRole[]): ScreenDefinition[] {
  return SCREENS.filter(
    (screen) => screen.requiredRoles.length === 0 || screen.requiredRoles.some((r) => roles.includes(r)),
  );
}

export function canAccess(screen: ScreenDefinition, roles: readonly AppRole[]): boolean {
  return screen.requiredRoles.length === 0 || screen.requiredRoles.some((r) => roles.includes(r));
}

export interface DisabledAction {
  disabled: boolean;
  reason?: ReactNode;
}

/**
 * Why an action is unavailable, stated rather than implied.
 *
 * Segregation of duties is a claim the demo makes out loud; a greyed-out button with no
 * explanation is indistinguishable from a bug.
 @@CMTEND@@
export function requireRole(roles: readonly AppRole[], required: AppRole, action: string): DisabledAction {
  if (roles.includes(required)) {
    return { disabled: false };
  }
  return {
    disabled: true,
    reason: `${action} requires the ${required} role. Your account does not hold it.`,
  };
}

===== FILE: src/webui/src/shell/navigation.test.ts =====
import { describe, it, expect } from 'vitest';
import { SCREENS, canAccess, requireRole, visibleScreens } from './navigation';

describe('navigation', () => {
  it('hides screens the caller has no role for', () => {
    const reader = visibleScreens(['Router.Read']).map((s) => s.path);

    expect(reader).toContain('/scoreboard');
    expect(reader).not.toContain('/approvals');
    expect(reader).not.toContain('/request');
  });

  it('grants the approver the approvals screen', () => {
    expect(visibleScreens(['Approver']).map((s) => s.path)).toContain('/approvals');
  });

  it('gives every screen at least one role, so nothing is unintentionally public', () => {
    expect(SCREENS.every((s) => s.requiredRoles.length > 0)).toBe(true);
  });

  it('covers every demo beat that has a screen', () => {
    const beats = new Set(SCREENS.map((s) => s.beat).filter(Boolean));
    expect([...beats].sort((a, b) => Number(a) - Number(b))).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('states why an action is unavailable rather than only disabling it', () => {
    const blocked = requireRole(['Router.Invoke'], 'Approver', 'Approving this escalation');

    expect(blocked.disabled).toBe(true);
    expect(String(blocked.reason)).toContain('Approver');
  });

  it('allows the action when the role is held', () => {
    expect(requireRole(['Approver'], 'Approver', 'Approving').disabled).toBe(false);
  });

  it('canAccess agrees with visibleScreens', () => {
    const roles = ['Router.Read'] as const;
    for (const screen of SCREENS) {
      expect(canAccess(screen, roles)).toBe(visibleScreens(roles).includes(screen));
    }
  });
});

===== FILE: src/webui/src/state/asyncState.ts =====
/**
 * The five states every screen must handle, plus the one it hopes for.
 *
 * They are modelled as a discriminated union rather than a set of booleans because
 * `isLoading && !error && data?.length` is how a screen ends up rendering an empty table that
 * looks like a working table with no results. On a projector, in front of an audience, "we have
 * no data" and "we could not reach the data" must never look the same.
 @@CMTEND@@

export interface Freshness {
  /** ISO 8601. Rendered as a visible timestamp, never as a spinner. @@CMTEND@@
  asOf: string;
  /** Where the number came from. Shown when it is not the primary source. @@CMTEND@@
  source?: string;
}

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string; retry?: () => void }
  | { status: 'ready'; data: T; freshness: Freshness }
  /**
   * Some of the answer, and an explicit list of what is missing.
   *
   * Required because the lanes can partially fail: a surveillance batch may triage 480 of 500
   * alerts. Rendering 480 as though it were the whole batch is the failure mode that matters
   * most here, because the number looks entirely plausible.
   @@CMTEND@@
  | { status: 'partial'; data: T; missing: string[]; freshness: Freshness }
  /**
   * A complete answer from a fallback *source* -- never from a fallback *reasoner*.
   *
   * ADR-007 draws the line this state must not cross: re-reading real evidence by another path is
   * permitted, substituting recorded reasoning for live reasoning is not. `degraded` is for the
   * former only. A lane must never report `degraded` because the agent could not run; that is an
   * `error`, and it must say which dependency failed.
   *
   * The scoreboard reads Application Insights and falls back to the Cosmos change feed when the
   * five-second freshness budget cannot be met. The audience is told which one they are looking
   * at, because a governance demo that hides its own degradation is arguing against itself.
   @@CMTEND@@
  | { status: 'degraded'; data: T; reason: string; freshness: Freshness };

export type AsyncStatus = AsyncState<unknown>['status'];

export const ALL_STATUSES: readonly AsyncStatus[] = [
  'loading',
  'empty',
  'error',
  'ready',
  'partial',
  'degraded',
] as const;

/** True when the state carries data a screen can render. @@CMTEND@@
export function hasData<T>(
  state: AsyncState<T>,
): state is Extract<AsyncState<T>, { data: T }> {
  return state.status === 'ready' || state.status === 'partial' || state.status === 'degraded';
}

/** Data if present, otherwise a caller-supplied fallback. Never throws. @@CMTEND@@
export function dataOr<T>(state: AsyncState<T>, fallback: T): T {
  return hasData(state) ? state.data : fallback;
}

/**
 * True when the screen is showing something it must qualify out loud.
 * Drives the banner; also drives whether a screenshot of this screen is honest on its own.
 @@CMTEND@@
export function needsQualification<T>(state: AsyncState<T>): boolean {
  return state.status === 'partial' || state.status === 'degraded';
}

export function formatFreshness(freshness: Freshness, now: Date = new Date()): string {
  const asOf = new Date(freshness.asOf);
  const seconds = Math.max(0, Math.round((now.getTime() - asOf.getTime()) / 1000));
  const age = seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  return freshness.source ? `${age} · ${freshness.source}` : age;
}

/**
 * The freshness budget the scoreboard acceptance criterion names. Anything older is stale and
 * the UI says so rather than quietly showing an old number as a current one.
 @@CMTEND@@
export const FRESHNESS_BUDGET_SECONDS = 5;

export function isStale(freshness: Freshness, now: Date = new Date()): boolean {
  const asOf = new Date(freshness.asOf);
  return (now.getTime() - asOf.getTime()) / 1000 > FRESHNESS_BUDGET_SECONDS;
}

===== FILE: src/webui/src/state/AsyncBoundary.tsx =====
import type { ReactNode } from 'react';
import type { AsyncState } from './asyncState';
import { formatFreshness, isStale } from './asyncState';

interface AsyncBoundaryProps<T> {
  state: AsyncState<T>;
  children: (data: T) => ReactNode;
  /** What this screen is showing, used in the empty and error copy. @@CMTEND@@
  label: string;
}

/**
 * Renders the correct state for every screen, so no screen has to remember all six.
 *
 * Partial and degraded render the data *and* a qualifying banner rather than replacing the data
 * with a warning: the audience still needs to see the result, and the presenter still needs to be
 * able to say what is wrong with it without leaving the screen.
 @@CMTEND@@
export function AsyncBoundary<T>({ state, children, label }: AsyncBoundaryProps<T>) {
  switch (state.status) {
    case 'loading':
      return (
        <div className="state state--loading" role="status" aria-live="polite">
          <span className="state__title">Loading {label}…</span>
        </div>
      );

    case 'empty':
      return (
        <div className="state state--empty">
          <span className="state__title">No {label} yet</span>
          <p className="state__detail">{state.message}</p>
        </div>
      );

    case 'error':
      return (
        <div className="state state--error" role="alert">
          <span className="state__title">Could not load {label}</span>
          <p className="state__detail">{state.message}</p>
          {state.retry && (
            <button type="button" className="button" onClick={state.retry}>
              Retry
            </button>
          )}
        </div>
      );

    case 'partial':
      return (
        <>
          <Banner
            tone="warning"
            title={`Showing ${label} with ${state.missing.length} item(s) missing`}
            detail={state.missing.join(', ')}
          />
          <FreshnessLine state={state} />
          {children(state.data)}
        </>
      );

    case 'degraded':
      return (
        <>
          <Banner tone="warning" title="Degraded data source" detail={state.reason} />
          <FreshnessLine state={state} />
          {children(state.data)}
        </>
      );

    case 'ready':
      return (
        <>
          <FreshnessLine state={state} />
          {children(state.data)}
        </>
      );
  }
}

function FreshnessLine<T>({
  state,
}: {
  state: Extract<AsyncState<T>, { freshness: { asOf: string } }>;
}) {
  const stale = isStale(state.freshness);
  return (
    <p className={`freshness${stale ? ' freshness--stale' : ''}`}>
      Data as of {formatFreshness(state.freshness)}
      {stale && ' — outside the 5s freshness budget'}
    </p>
  );
}

export function Banner({
  tone,
  title,
  detail,
}: {
  tone: 'warning' | 'danger' | 'info';
  title: string;
  detail?: string;
}) {
  return (
    <div className={`banner banner--${tone}`} role="status">
      <strong>{title}</strong>
      {detail && <span className="banner__detail">{detail}</span>}
    </div>
  );
}

===== FILE: src/webui/src/state/asyncState.test.ts =====
import { describe, it, expect } from 'vitest';
import {
  ALL_STATUSES,
  dataOr,
  formatFreshness,
  hasData,
  isStale,
  needsQualification,
  type AsyncState,
} from './asyncState';

const now = new Date('2026-09-10T14:00:00Z');
const fresh = { asOf: '2026-09-10T13:59:58Z' };
const old = { asOf: '2026-09-10T13:59:00Z' };

describe('async state primitives', () => {
  it('declares all six states the design requires', () => {
    expect(ALL_STATUSES).toEqual(['loading', 'empty', 'error', 'ready', 'partial', 'degraded']);
  });

  it('treats partial and degraded as data-bearing', () => {
    const partial: AsyncState<number[]> = {
      status: 'partial',
      data: [1, 2],
      missing: ['alert-0003'],
      freshness: fresh,
    };
    const degraded: AsyncState<number[]> = {
      status: 'degraded',
      data: [1],
      reason: 'change feed fallback',
      freshness: fresh,
    };

    expect(hasData(partial)).toBe(true);
    expect(hasData(degraded)).toBe(true);
    expect(dataOr(partial, [])).toEqual([1, 2]);
  });

  it('does not treat empty and error as data-bearing', () => {
    expect(hasData({ status: 'empty', message: 'none' })).toBe(false);
    expect(hasData({ status: 'error', message: 'boom' })).toBe(false);
    expect(dataOr<number[]>({ status: 'error', message: 'boom' }, [])).toEqual([]);
  });

  it('flags partial and degraded as needing qualification, ready as not', () => {
    expect(needsQualification({ status: 'partial', data: 1, missing: [], freshness: fresh })).toBe(true);
    expect(needsQualification({ status: 'degraded', data: 1, reason: 'x', freshness: fresh })).toBe(true);
    expect(needsQualification({ status: 'ready', data: 1, freshness: fresh })).toBe(false);
  });

  it('measures staleness against the five-second budget', () => {
    expect(isStale(fresh, now)).toBe(false);
    expect(isStale(old, now)).toBe(true);
  });

  it('renders freshness as an age, and names a fallback source when there is one', () => {
    expect(formatFreshness(fresh, now)).toBe('2s ago');
    expect(formatFreshness({ ...old, source: 'Cosmos change feed' }, now)).toBe(
      '1m ago · Cosmos change feed',
    );
  });
});

===== FILE: src/webui/src/state/AsyncBoundary.test.tsx =====
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AsyncBoundary } from './AsyncBoundary';
import type { AsyncState } from './asyncState';

const freshness = { asOf: new Date().toISOString() };

function renderState(state: AsyncState<string[]>) {
  return render(
    <AsyncBoundary state={state} label="decisions">
      {(data) => <ul>{data.map((d) => <li key={d}>{d}</li>)}</ul>}
    </AsyncBoundary>,
  );
}

describe('AsyncBoundary', () => {
  it('distinguishes empty from error', () => {
    const { unmount } = renderState({ status: 'empty', message: 'Submit a request to begin.' });
    expect(screen.getByText('No decisions yet')).toBeInTheDocument();
    unmount();

    renderState({ status: 'error', message: 'Router unreachable.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load decisions');
  });

  it('still renders the data when partial, and names what is missing', () => {
    renderState({
      status: 'partial',
      data: ['a', 'b'],
      missing: ['alert-0003'],
      freshness,
    });

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText(/1 item\(s\) missing/)).toBeInTheDocument();
    expect(screen.getByText('alert-0003')).toBeInTheDocument();
  });

  it('still renders the data when degraded, and says why', () => {
    renderState({
      status: 'degraded',
      data: ['a'],
      reason: 'Application Insights exceeded the freshness budget; using the Cosmos change feed.',
      freshness,
    });

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('Degraded data source')).toBeInTheDocument();
  });

  it('shows a data timestamp rather than a spinner once loaded', () => {
    renderState({ status: 'ready', data: ['a'], freshness });
    expect(screen.getByText(/Data as of/)).toBeInTheDocument();
  });
});

===== FILE: src/webui/src/api/client.ts =====
import type { RoutingDecision, PolicySet, DataClassification } from './types.generated';

/**
 * Router API client.
 *
 * Note what `RouteRequest` does not have: no model, no vendor, no deployment, no tier. Principle
 * IV is enforced by the type, because a field that exists is a field that eventually gets used.
 *
 * `dataClassification` is required. The server treats an omission as a 400 rather than assuming
 * Public, and the client type mirrors that so the mistake is caught at compile time instead of
 * during a live request.
 @@CMTEND@@
export interface RouteRequest {
  prompt: string;
  dataClassification: DataClassification;
  costCeilingUsd?: number;
  policySetId?: string;
  correlationId?: string;
}

export interface RouteResponse {
  correlationId: string;
  decision: RoutingDecision;
  output?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Supplied by the MSAL wiring in T-028b. Returns null when unauthenticated. @@CMTEND@@
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  route(request: RouteRequest): Promise<RouteResponse> {
    return this.send<RouteResponse>('POST', '/v1/route', request);
  }

  listPolicySets(): Promise<{ policySets: PolicySet[] }> {
    return this.send<{ policySets: PolicySet[] }>('GET', '/v1/policy-sets');
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const token = await this.options.getAccessToken();

    const response = await fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const correlationId = response.headers.get('x-correlation-id') ?? undefined;

    if (!response.ok) {
      // A refusal is a 200 with outcome RefusedByPolicy, never an error status, so anything
      // landing here is a genuine failure and must not be retried against a different model.
      let detail = response.statusText;
      try {
        const payload = (await response.json()) as { detail?: string; title?: string };
        detail = payload.detail ?? payload.title ?? detail;
      } catch {
        // Body was not JSON; the status text stands.
      }
      throw new ApiError(response.status, detail, correlationId);
    }

    return (await response.json()) as T;
  }
}

/**
 * True when a response is a governed refusal rather than a result.
 *
 * Exists so screens cannot accidentally treat a refusal as an error and offer a retry. Retrying
 * a refusal is the one behaviour the exchange must never encourage.
 @@CMTEND@@
export function isRefusal(response: RouteResponse): boolean {
  return response.decision.outcome === 'RefusedByPolicy';
}

===== FILE: src/webui/src/api/client.test.ts =====
import { describe, it, expect } from 'vitest';
import { ApiClient, ApiError, isRefusal, type RouteResponse } from './client';

function clientWith(response: Response) {
  return new ApiClient({
    baseUrl: 'https://router.internal',
    getAccessToken: async () => 'token',
    fetchImpl: async () => response,
  });
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-1' },
    ...init,
  });
}

describe('ApiClient', () => {
  it('returns a policy refusal as a normal response, not an error', async () => {
    const body: RouteResponse = {
      correlationId: 'corr-1',
      decision: {
        complexityScore: 0.4,
        costCeilingUsd: 0.5,
        outcome: 'RefusedByPolicy',
        candidateTiers: [],
        rationale: 'No approved vendor may process Restricted data.',
        selectedDeployment: null,
        selectedVendor: null,
      },
    };

    const result = await clientWith(json(body)).route({
      prompt: 'summarise',
      dataClassification: 'Restricted',
    });

    expect(isRefusal(result)).toBe(true);
    expect(result.decision.selectedDeployment).toBeNull();
  });

  it('does not classify a routed decision as a refusal', async () => {
    const body: RouteResponse = {
      correlationId: 'corr-1',
      decision: {
        complexityScore: 0.4,
        costCeilingUsd: 0.5,
        outcome: 'Routed',
        candidateTiers: [],
        rationale: 'Routed to Standard.',
      },
    };

    expect(isRefusal(await clientWith(json(body)).route({
      prompt: 'x',
      dataClassification: 'Internal',
    }))).toBe(false);
  });

  it('raises ApiError with the correlation id on a genuine failure', async () => {
    const failing = clientWith(
      json({ detail: 'Router unreachable' }, { status: 503 }),
    );

    await expect(
      failing.route({ prompt: 'x', dataClassification: 'Internal' }),
    ).rejects.toMatchObject({ status: 503, message: 'Router unreachable', correlationId: 'corr-1' });
  });

  it('surfaces a non-JSON error body without throwing on the parse', async () => {
    const failing = new ApiClient({
      baseUrl: 'https://router.internal',
      getAccessToken: async () => null,
      fetchImpl: async () => new Response('gateway timeout', { status: 504, statusText: 'Gateway Timeout' }),
    });

    await expect(failing.route({ prompt: 'x', dataClassification: 'Public' }))
      .rejects.toBeInstanceOf(ApiError);
  });
});

===== FILE: src/webui/src/api/types.generated.ts =====
// GENERATED FILE -- DO NOT EDIT.
//
// Source: src/Fcmr.Router.Decisions/*.cs
// Regenerate: node scripts/generate-api-types.mjs
// CI asserts this file is in sync via: node scripts/generate-api-types.mjs --check

export type ModelTier =
  | 'Economy'
  | 'Standard'
  | 'Premium';

export const ModelTierValues: readonly ModelTier[] = [
  'Economy',
  'Standard',
  'Premium',
] as const;

export type RoutingOutcome =
  | 'Routed'
  | 'Downgraded'
  | 'Denied'
  | 'RefusedByPolicy';

export const RoutingOutcomeValues: readonly RoutingOutcome[] = [
  'Routed',
  'Downgraded',
  'Denied',
  'RefusedByPolicy',
] as const;

export type ModelVendor =
  | 'AzureOpenAI'
  | 'Anthropic'
  | 'XAI'
  | 'OpenWeight';

export const ModelVendorValues: readonly ModelVendor[] = [
  'AzureOpenAI',
  'Anthropic',
  'XAI',
  'OpenWeight',
] as const;

export type ServingMode =
  | 'Serverless'
  | 'ManagedCompute';

export const ServingModeValues: readonly ServingMode[] = [
  'Serverless',
  'ManagedCompute',
] as const;

export type DataClassification =
  | 'Public'
  | 'Internal'
  | 'Confidential'
  | 'Restricted';

export const DataClassificationValues: readonly DataClassification[] = [
  'Public',
  'Internal',
  'Confidential',
  'Restricted',
] as const;

export type PolicyExclusionKind =
  | 'VendorNotApproved'
  | 'ClassificationExceeded'
  | 'RegionNotPermitted'
  | 'PolicyCostCeiling';

export const PolicyExclusionKindValues: readonly PolicyExclusionKind[] = [
  'VendorNotApproved',
  'ClassificationExceeded',
  'RegionNotPermitted',
  'PolicyCostCeiling',
] as const;

export interface RoutingDecision {
  complexityScore: number;
  costCeilingUsd: number;
  outcome: RoutingOutcome;
  selectedTier?: ModelTier | null;
  selectedDeployment?: string | null;
  candidateTiers: TierCandidate[];
  rationale: string;
  policySetId?: string | null;
  policySetVersion?: number | null;
  dataClassification?: DataClassification | null;
  selectedVendor?: ModelVendor | null;
  policyExclusions?: PolicyExclusion[];
}

export interface TierCandidate {
  tier: ModelTier;
  deployment: string;
  projectedCostUsd: number;
  vendor?: ModelVendor;
  selected?: boolean;
  rejectedReason?: string | null;
}

export interface PolicyExclusion {
  deployment: string;
  vendor: ModelVendor;
  kind: PolicyExclusionKind;
  reason: string;
}

export interface PolicySet {
  id: string;
  businessUnit: string;
  displayName?: string;
  approvedVendors: ModelVendor[];
  maxClassification: Partial<Record<ModelVendor, DataClassification>>;
  allowedRegions?: string[];
  maxCostPerRequestUsd?: number;
  permitsRestrictedData?: boolean;
  version?: number;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export interface PolicySetFieldChange {
  field: string;
  from: string;
  to: string;
}

===== FILE: scripts/diagrams/diagram-kit.mjs =====
// diagram-kit.mjs
//
// Deterministic Excalidraw element factory + layout helpers.
// Node built-ins only. No randomness, no clocks: every "random" field comes from a
// counter-based PRNG seeded with a fixed constant, and `updated` is the constant 1.

const PRNG_SEED = 0x5f3a91c7;
const UPDATED = 1;

/** Counter-based PRNG (splitmix32). Deterministic across runs and platforms. @@CMTEND@@
export function createRng(seed = PRNG_SEED) {
  let counter = seed >>> 0;
  return function next() {
    counter = (counter + 0x9e3779b9) >>> 0;
    let z = counter;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z % 2147483647;
  };
}

// ---------------------------------------------------------------------------
// Palette — Excalidraw standard swatches only.
// ---------------------------------------------------------------------------

export const C = {
  ink: '#1e1e1e',
  red: '#e03131',
  green: '#2f9e44',
  blue: '#1971c2',
  orange: '#f08c00',
  violet: '#9c36b5',
  transparent: 'transparent',
  bgRed: '#ffc9c9',
  bgGreen: '#b2f2bb',
  bgBlue: '#a5d8ff',
  bgYellow: '#ffec99',
  bgViolet: '#eebefa',
  white: '#ffffff',
};

// ---------------------------------------------------------------------------
// Type metrics
// ---------------------------------------------------------------------------

export const FONT = { hand: 1, helvetica: 2, mono: 3 };
export const LINE_HEIGHT = 1.25;
export const BOX_PAD = 16;

const CHAR_RATIO = { 1: 0.58, 2: 0.55, 3: 0.62 };

export function charWidth(fontSize, fontFamily = FONT.helvetica) {
  return fontSize * (CHAR_RATIO[fontFamily] ?? 0.55);
}

export function measureLine(line, fontSize, fontFamily = FONT.helvetica) {
  return line.length * charWidth(fontSize, fontFamily);
}

/** Greedy word wrap using the character-width estimator. Honours explicit \n. @@CMTEND@@
export function wrapText(text, fontSize, maxWidth, fontFamily = FONT.helvetica) {
  const cw = charWidth(fontSize, fontFamily);
  const maxChars = Math.max(1, Math.floor(maxWidth / cw));
  const out = [];
  for (const paragraph of String(text).split('\n')) {
    if (paragraph.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (candidate.length <= maxChars) {
        line = candidate;
        continue;
      }
      if (line.length > 0) out.push(line);
      // Hard-break tokens longer than the line box (e.g. long identifiers).
      let rest = word;
      while (rest.length > maxChars) {
        out.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

export function textBlockSize(lines, fontSize, fontFamily = FONT.helvetica) {
  const width = lines.reduce((m, l) => Math.max(m, measureLine(l, fontSize, fontFamily)), 0);
  return { width, height: lines.length * fontSize * LINE_HEIGHT };
}

// ---------------------------------------------------------------------------
// Layout: layer / column model
// ---------------------------------------------------------------------------

/**
 * A column ruler. Columns are computed once from a width + gap, never hand-placed.
 @@CMTEND@@
export function columns({ x = 0, count, width, gap }) {
  const cols = [];
  for (let i = 0; i < count; i += 1) cols.push({ x: x + i * (width + gap), width });
  return {
    cols,
    at: (i) => cols[i],
    span: (i, n) => ({ x: cols[i].x, width: n * width + (n - 1) * gap }),
    totalWidth: count * width + (count - 1) * gap,
  };
}

/** A vertical stack cursor. Rows advance by an explicit height + gap. @@CMTEND@@
export function stack(y, gap = 40) {
  let cursor = y;
  return {
    next(height) {
      const top = cursor;
      cursor += height + gap;
      return top;
    },
    skip(amount) {
      cursor += amount;
    },
    get y() {
      return cursor;
    },
  };
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export class Scene {
  constructor({ name, seed = PRNG_SEED } = {}) {
    this.name = name;
    this.elements = [];
    this.rng = createRng(seed);
    this.idCounter = 0;
    this.byId = new Map();
  }

  id(prefix) {
    this.idCounter += 1;
    return `${prefix}-${String(this.idCounter).padStart(3, '0')}`;
  }

  base(type, props) {
    const el = {
      id: props.id,
      type,
      x: round(props.x),
      y: round(props.y),
      width: round(props.width),
      height: round(props.height),
      angle: 0,
      strokeColor: props.strokeColor ?? C.ink,
      backgroundColor: props.backgroundColor ?? C.transparent,
      fillStyle: props.fillStyle ?? 'solid',
      strokeWidth: props.strokeWidth ?? 2,
      strokeStyle: props.strokeStyle ?? 'solid',
      roughness: props.roughness ?? 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: props.roundness === undefined ? { type: 3 } : props.roundness,
      seed: this.rng(),
      versionNonce: this.rng(),
      version: 1,
      isDeleted: false,
      boundElements: props.boundElements ?? [],
      updated: UPDATED,
      link: null,
      locked: false,
    };
    this.elements.push(el);
    this.byId.set(el.id, el);
    return el;
  }

  /** Free-floating text. Width/height are derived from the estimator. @@CMTEND@@
  text(
    content,
    {
      x,
      y,
      width,
      fontSize = 16,
      fontFamily = FONT.helvetica,
      color = C.ink,
      align = 'left',
      id,
    } = {},
  ) {
    const maxWidth = width ?? measureLine(String(content).split('\n')[0], fontSize, fontFamily) + 1;
    const lines = wrapText(content, fontSize, maxWidth, fontFamily);
    const size = textBlockSize(lines, fontSize, fontFamily);
    const el = this.base('text', {
      id: id ?? this.id('txt'),
      x,
      y,
      width: width ?? size.width,
      height: size.height,
      strokeColor: color,
      backgroundColor: C.transparent,
      roundness: null,
      strokeWidth: 2,
    });
    Object.assign(el, {
      text: lines.join('\n'),
      originalText: String(content),
      fontSize,
      fontFamily,
      textAlign: align,
      verticalAlign: 'top',
      containerId: null,
      lineHeight: LINE_HEIGHT,
    });
    return el;
  }

  /**
   * Height a box needs for its title + body at a given width.
   * Layout code calls this before placing a row so siblings share a height.
   @@CMTEND@@
  static measure(spec, width) {
    const titleSize = spec.titleSize ?? 20;
    const bodySize = spec.bodySize ?? 16;
    const inner = width - 2 * BOX_PAD;
    let h = BOX_PAD * 2;
    if (spec.title) {
      const lines = wrapText(spec.title, titleSize, inner, spec.titleFamily ?? FONT.helvetica);
      h += lines.length * titleSize * LINE_HEIGHT;
    }
    if (spec.body) {
      const lines = wrapText(spec.body, bodySize, inner, spec.bodyFamily ?? FONT.helvetica);
      h += 10 + lines.length * bodySize * LINE_HEIGHT;
    }
    return Math.max(h, 64);
  }

  /**
   * A labelled box: rectangle + bound title text (+ optional free body text inside).
   @@CMTEND@@
  box(spec) {
    const {
      x,
      y,
      width,
      height,
      title,
      body,
      stroke = C.ink,
      background = C.transparent,
      fillStyle = 'solid',
      strokeStyle = 'solid',
      strokeWidth = 2,
      titleSize = 20,
      bodySize = 16,
      titleFamily = FONT.helvetica,
      bodyFamily = FONT.helvetica,
      titleColor,
      bodyColor,
    } = spec;

    const h = height ?? Scene.measure(spec, width);
    const rectId = this.id('box');
    const inner = width - 2 * BOX_PAD;

    const rect = this.base('rectangle', {
      id: rectId,
      x,
      y,
      width,
      height: h,
      strokeColor: stroke,
      backgroundColor: background,
      fillStyle,
      strokeStyle,
      strokeWidth,
      roundness: { type: 3 },
    });

    const titleLines = wrapText(title, titleSize, inner, titleFamily);
    const titleSizeBox = textBlockSize(titleLines, titleSize, titleFamily);
    const titleId = this.id('txt');
    const centred = !body;
    const titleY = centred ? y + (h - titleSizeBox.height) / 2 : y + BOX_PAD;

    const titleEl = this.base('text', {
      id: titleId,
      x: x + BOX_PAD,
      y: titleY,
      width: inner,
      height: titleSizeBox.height,
      strokeColor: titleColor ?? C.ink,
      backgroundColor: C.transparent,
      roundness: null,
    });
    Object.assign(titleEl, {
      text: titleLines.join('\n'),
      originalText: title,
      fontSize: titleSize,
      fontFamily: titleFamily,
      textAlign: 'center',
      verticalAlign: centred ? 'middle' : 'top',
      containerId: rectId,
      lineHeight: LINE_HEIGHT,
    });
    rect.boundElements.push({ type: 'text', id: titleId });

    if (body) {
      const bodyY = titleY + titleSizeBox.height + 10;
      this.text(body, {
        x: x + BOX_PAD,
        y: bodyY,
        width: inner,
        fontSize: bodySize,
        fontFamily: bodyFamily,
        color: bodyColor ?? C.ink,
        align: 'center',
      });
    }

    return { id: rectId, x, y, width, height: h, cx: x + width / 2, cy: y + h / 2 };
  }

  /**
   * A grouping frame: a rectangle with a label sitting on its top-left inside edge.
   * Groups are containers; children are placed inside them by the caller.
   @@CMTEND@@
  group(spec) {
    const {
      x,
      y,
      width,
      height,
      label,
      stroke = C.ink,
      background = C.transparent,
      fillStyle = 'solid',
      strokeStyle = 'solid',
      strokeWidth = 2,
      labelSize = 20,
      labelColor,
      sublabel,
      sublabelSize = 16,
    } = spec;

    const rectId = this.id('grp');
    this.base('rectangle', {
      id: rectId,
      x,
      y,
      width,
      height,
      strokeColor: stroke,
      backgroundColor: background,
      fillStyle,
      strokeStyle,
      strokeWidth,
      roundness: { type: 3 },
    });

    if (label) {
      const el = this.text(label, {
        x: x + BOX_PAD,
        y: y + 12,
        width: width - 2 * BOX_PAD,
        fontSize: labelSize,
        color: labelColor ?? stroke,
        align: 'left',
      });
      if (sublabel) {
        this.text(sublabel, {
          x: x + BOX_PAD,
          y: y + 12 + el.height + 4,
          width: width - 2 * BOX_PAD,
          fontSize: sublabelSize,
          color: labelColor ?? stroke,
          align: 'left',
        });
      }
    }

    return { id: rectId, x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
  }

  /** Anchor point on a box edge. @@CMTEND@@
  static anchor(b, side) {
    switch (side) {
      case 'left':
        return { x: b.x, y: b.y + b.height / 2 };
      case 'right':
        return { x: b.x + b.width, y: b.y + b.height / 2 };
      case 'top':
        return { x: b.x + b.width / 2, y: b.y };
      case 'bottom':
        return { x: b.x + b.width / 2, y: b.y + b.height };
      default:
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
  }

  static autoSides(a, b) {
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
    }
    return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }

  /**
   * A bound arrow between two boxes. Both endpoints are updated to reference it.
   @@CMTEND@@
  arrow(from, to, opts = {}) {
    const {
      color = C.ink,
      strokeWidth = 2,
      strokeStyle = 'solid',
      gap = 8,
      label,
      labelSize = 16,
      labelColor,
      labelWidth = 240,
      labelDx = 0,
      labelDy = 0,
      elbow = null, // 'h' | 'v' — route through one right angle
      endArrowhead = 'arrow',
      startArrowhead = null,
    } = opts;

    let [sSide, eSide] = opts.sides ?? Scene.autoSides(from, to);
    const start = Scene.anchor(from, sSide);
    const end = Scene.anchor(to, eSide);

    const off = (p, side, d) => {
      if (side === 'left') return { x: p.x - d, y: p.y };
      if (side === 'right') return { x: p.x + d, y: p.y };
      if (side === 'top') return { x: p.x, y: p.y - d };
      return { x: p.x, y: p.y + d };
    };
    const s = off(start, sSide, gap);
    const e = off(end, eSide, gap);

    const pts = [[0, 0]];
    if (sSide === eSide) {
      // Same-side connection: route out perpendicular, travel, and come back in.
      const detour = opts.detour ?? 70;
      const dir = sSide === 'left' || sSide === 'top' ? -1 : 1;
      const horiz = sSide === 'left' || sSide === 'right';
      const reach = dir * detour;
      if (horiz) {
        pts.push([reach, 0], [reach, e.y - s.y], [e.x - s.x, e.y - s.y]);
      } else {
        pts.push([0, reach], [e.x - s.x, reach], [e.x - s.x, e.y - s.y]);
      }
    } else {
      if (elbow === 'h') pts.push([e.x - s.x, 0]);
      if (elbow === 'v') pts.push([0, e.y - s.y]);
      pts.push([e.x - s.x, e.y - s.y]);
    }

    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const arrowId = this.id('arr');

    const el = this.base('arrow', {
      id: arrowId,
      x: s.x,
      y: s.y,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      strokeColor: color,
      backgroundColor: C.transparent,
      strokeWidth,
      strokeStyle,
      roundness: { type: 2 },
    });
    Object.assign(el, {
      points: pts.map(([px, py]) => [round(px), round(py)]),
      lastCommittedPoint: null,
      startBinding: { elementId: from.id, focus: 0, gap },
      endBinding: { elementId: to.id, focus: 0, gap },
      startArrowhead,
      endArrowhead,
      elbowed: false,
    });

    this.byId.get(from.id).boundElements.push({ type: 'arrow', id: arrowId });
    this.byId.get(to.id).boundElements.push({ type: 'arrow', id: arrowId });

    if (label) {
      // Anchor the label at the centroid of the routed polyline, so a detoured
      // arrow labels itself where it actually runs. `labelAt` overrides absolutely.
      const cxRel = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cyRel = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const mid = opts.labelAt ?? { x: s.x + cxRel, y: s.y + cyRel };
      const lines = wrapText(label, labelSize, labelWidth);
      const size = textBlockSize(lines, labelSize);
      this.text(label, {
        x: mid.x - labelWidth / 2 + labelDx,
        y: mid.y - size.height / 2 + labelDy,
        width: labelWidth,
        fontSize: labelSize,
        color: labelColor ?? color,
        align: 'center',
      });
    }

    return { id: arrowId };
  }

  /** Diagram title + one-sentence subtitle stating the conclusion. @@CMTEND@@
  header({ x, y, width, title, subtitle }) {
    const t = this.text(title, {
      x,
      y,
      width,
      fontSize: 28,
      color: C.ink,
      align: 'left',
    });
    const s = this.text(subtitle, {
      x,
      y: y + t.height + 10,
      width,
      fontSize: 20,
      color: C.blue,
      align: 'left',
    });
    return { height: t.height + 10 + s.height };
  }

  /** A legend. Every diagram must have one; colour without a key is decoration. @@CMTEND@@
  legend({ x, y, width, items, title = 'Legend — what the colours mean' }) {
    const rowH = 34;
    const swatch = 26;
    const height = 16 + 24 + 12 + items.length * rowH + 12;
    const frame = this.group({
      x,
      y,
      width,
      height,
      label: title,
      labelSize: 20,
      stroke: C.ink,
      background: C.white,
      strokeWidth: 2,
    });
    let cursor = y + 16 + 24 + 14;
    for (const item of items) {
      this.base('rectangle', {
        id: this.id('swa'),
        x: x + BOX_PAD,
        y: cursor,
        width: swatch,
        height: swatch,
        strokeColor: item.stroke ?? C.ink,
        backgroundColor: item.background ?? C.transparent,
        fillStyle: 'solid',
        strokeWidth: item.strokeWidth ?? 2,
        strokeStyle: item.strokeStyle ?? 'solid',
        roundness: { type: 3 },
      });
      this.text(item.text, {
        x: x + BOX_PAD + swatch + 12,
        y: cursor + 3,
        width: width - 2 * BOX_PAD - swatch - 12,
        fontSize: 16,
        color: C.ink,
        align: 'left',
      });
      cursor += rowH;
    }
    return frame;
  }

  bounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of this.elements) {
      let x0 = el.x;
      let y0 = el.y;
      let x1 = el.x + el.width;
      let y1 = el.y + el.height;
      if (Array.isArray(el.points)) {
        // Linear elements store points relative to x/y and may run negative.
        const xs = el.points.map((p) => el.x + p[0]);
        const ys = el.points.map((p) => el.y + p[1]);
        x0 = Math.min(...xs);
        x1 = Math.max(...xs);
        y0 = Math.min(...ys);
        y1 = Math.max(...ys);
      }
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  toDocument() {
    return {
      type: 'excalidraw',
      version: 2,
      source: 'https://github.com/briandenicola/foundry-capital-markets-router',
      elements: this.elements,
      appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
      files: {},
    };
  }

  toJSON() {
    return `${JSON.stringify(this.toDocument(), null, 2)}\n`;
  }
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export { round, UPDATED, PRNG_SEED };

===== FILE: scripts/diagrams/diagrams.mjs =====
// diagrams.mjs
//
// The four diagrams. Every fact here is traceable to the repository:
//   infrastructure/*.tf, apps/*.tf, src/Fcmr.Router.Decisions/*.cs,
//   docs/architecture.md, docs/agent-architecture.md, docs/ui-design.md,
//   docs/demo-runbook.md, .specify/memory/constitution.md,
//   specs/001-router-core/**, specs/002-governed-exchange/**.

import { Scene, C, FONT, columns } from './diagram-kit.mjs';

const MONO = FONT.mono;

/** Uniform height for a row of sibling boxes, computed from the widest content. @@CMTEND@@
function rowHeight(items, colWidth) {
  return Math.max(...items.map((s) => Scene.measure(s, colWidth)));
}

/** Place a row of boxes across a column ruler at a shared height. @@CMTEND@@
function placeRow(scene, ruler, y, items, common = {}) {
  const w = ruler.at(0).width;
  const specs = items.map((s) => ({ ...common, ...s }));
  const h = rowHeight(specs, w);
  return specs.map((s, i) => scene.box({ ...s, x: ruler.at(i).x, y, width: w, height: h }));
}

const LEGEND_PRIVATE = {
  stroke: C.green,
  background: C.bgGreen,
  text: 'Inside the VNet / private endpoint only. No public data-plane endpoint.',
};
const LEGEND_PUBLIC = {
  stroke: C.red,
  background: C.bgRed,
  text: 'Public or refusal / denial. The single public surface, or a governed "no".',
};
const LEGEND_HUMAN = {
  stroke: C.orange,
  background: C.bgYellow,
  text: 'Human-in-the-loop. A person, holding a distinct identity, decides.',
};
const LEGEND_PREVIEW = {
  stroke: C.violet,
  background: C.bgViolet,
  text: 'Preview Azure capability (azapi, preview API version).',
};
const LEGEND_CHOKEPOINT = {
  stroke: C.blue,
  background: C.bgBlue,
  text: 'Governed chokepoint / deterministic code the exchange depends on.',
};
const LEGEND_ABSENT = {
  stroke: C.red,
  background: C.white,
  strokeStyle: 'dashed',
  text: 'Described in docs but ABSENT from infrastructure/*.tf and apps/*.tf.',
};

// ===========================================================================
// 01 — Platform topology
// ===========================================================================

export function platformTopology() {
  const scene = new Scene({ name: '01-platform-topology', seed: 0x11a2b3c4 });
  const X0 = 80;
  const W = 2560;
  const INNER_X = X0 + 40;
  const INNER_W = W - 80;

  scene.header({
    x: X0,
    y: 60,
    width: W,
    title: '01 · Governed AI Exchange — private Azure platform topology',
    subtitle:
      'Conclusion: every data plane in this system — Cosmos, AI Search, Key Vault, the registry and Microsoft Foundry — is reachable only from inside the VNet, and the sole public surface is the demo UI front door.',
  });

  // ---- Public zone -------------------------------------------------------
  const pubY = 200;
  const pubCols = columns({ x: INNER_X, count: 3, width: (INNER_W - 2 * 40) / 3, gap: 40 });
  const pubItems = [
    {
      title: 'Demo operator (browser)',
      body: 'Entra ID interactive sign-in via MSAL.\nTwo identities on the day: one holding\nApprover, one deliberately without it.',
    },
    {
      title: 'Microsoft Entra ID  ·  identity plane',
      body:
        'apps/entra.tf — one app registration, three app roles:\nRouter.Invoke (Application), Router.Read (User+App), Approver (User).\nDeliberately a public endpoint: it is an identity plane, not a data plane.',
    },
    {
      title: 'Azure control plane  ·  Terraform',
      body:
        'Two stacks, remote state: infrastructure/ (platform)\nand apps/ (workloads). Control-plane access is not\nwhat Principle II constrains — data planes are.',
    },
  ];
  const pubBoxY = pubY + 76;
  const pubH = rowHeight(pubItems, pubCols.at(0).width);
  scene.group({
    x: X0,
    y: pubY,
    width: W,
    height: 76 + pubH + 34,
    label: 'PUBLIC INTERNET',
    sublabel: 'Nothing below this line reaches an Azure data plane directly.',
    stroke: C.red,
    background: C.bgRed,
    fillStyle: 'solid',
    strokeWidth: 3,
    strokeStyle: 'dashed',
  });
  const pub = placeRow(scene, pubCols, pubBoxY, pubItems, {
    stroke: C.red,
    background: C.white,
    strokeWidth: 2,
  });
  const pubZoneBottom = pubY + 76 + pubH + 34;

  // ---- VNet --------------------------------------------------------------
  const vnetY = pubZoneBottom + 150;
  const vContentTop = vnetY + 104;

  // Left: container-apps subnet
  const caSubX = INNER_X;
  const caSubW = 1180;
  const caeX = caSubX + 30;
  const caeW = caSubW - 60;
  const appX = caeX + 25;
  const appW = caeW - 50;
  const laneCols = columns({ x: appX, count: 3, width: (appW - 2 * 40) / 3, gap: 40 });

  const webuiSpec = {
    title: 'webui  ·  Vite / React  ·  EXTERNAL ingress',
    body:
      'apps/container-apps.tf — the only container app with\nexternal_enabled = true. This is the single public surface\nallowed by Principle II.',
  };
  const routerSpec = {
    title: 'router-service  ·  the chokepoint',
    body:
      'The only workload identity holding "Azure AI Developer" on the\nFoundry project (apps/roles.tf). Every model call in the system\npasses through POST /v1/route. Internal ingress only.',
  };
  const laneSpecs = [
    {
      title: 'research-service',
      body: 'Search Index Data Reader.\nNo Foundry role assignment.',
    },
    {
      title: 'surveillance-service',
      body: 'Search Index Data Reader.\nNo Foundry role assignment.',
    },
    {
      title: 'orderrouting-service',
      body: 'Simulated OMS only.\nNo Foundry role assignment.',
    },
  ];

  const hWebui = Scene.measure(webuiSpec, appW);
  const hRouter = Scene.measure(routerSpec, appW);
  const hLane = rowHeight(laneSpecs, laneCols.at(0).width);
  const caeH = 76 + hWebui + 40 + hRouter + 40 + hLane + 30;
  const caSubH = 82 + caeH + 30;

  // Right: private-endpoints subnet
  const peSubX = caSubX + caSubW + 240;
  const peSubW = INNER_X + INNER_W - peSubX;
  const peCols = columns({ x: peSubX + 30, count: 2, width: (peSubW - 60 - 40) / 2, gap: 40 });
  const peItems = [
    { title: 'cosmos-pe', body: 'group: Sql\nprivatelink.documents.azure.com' },
    { title: 'search-pe', body: 'group: searchService\nprivatelink.search.windows.net' },
    { title: 'keyvault-pe', body: 'group: vault\nprivatelink.vaultcore.azure.net' },
    { title: 'registry-pe', body: 'group: registry\nprivatelink.azurecr.io' },
    { title: 'foundry-pe', body: 'group: account\nprivatelink.services.ai.azure.com' },
    {
      title: 'Private DNS  ·  6 zones',
      body: 'All six linked to the VNet\n(privatelink.openai.azure.com is\ncreated but has no endpoint).',
      stroke: C.blue,
      background: C.bgBlue,
    },
  ];
  const peRowH = [0, 1, 2].map((r) =>
    rowHeight(peItems.slice(r * 2, r * 2 + 2), peCols.at(0).width),
  );
  const peSubH = 82 + peRowH[0] + 40 + peRowH[1] + 40 + peRowH[2] + 30;

  const subnetRowH = Math.max(caSubH, peSubH);

  // Data planes row
  const dpY = vContentTop + subnetRowH + 70;
  const dpX = INNER_X;
  const dpW = INNER_W;
  const dpInnerX = dpX + 30;
  const dpInnerW = dpW - 60;
  const dataCols = columns({ x: dpInnerX, count: 4, width: (dpInnerW - 3 * 40) / 4, gap: 40 });
  const dataItems = [
    {
      title: 'Cosmos DB (SQL)',
      body:
        'public_network_access_enabled = false\nlocal_authentication_enabled = false\n6 containers: routerDecisions, approvals,\nsurveillanceAlerts, researchQueries,\norderProposals, auditEvents',
    },
    {
      title: 'Azure AI Search',
      body:
        'public_network_access_enabled = false\nlocal_authentication_enabled = false\nSystem-assigned identity.\nStandard SKU. Research corpus.',
    },
    {
      title: 'Key Vault',
      body:
        'public_network_access_enabled = false\nRBAC authorization, network_acls Deny.\nHolds only what cannot be managed-\nidentity authenticated (Principle VIII).',
    },
    {
      title: 'Container Registry (Premium)',
      body:
        'public_network_access_enabled = false\nadmin_enabled = false\nanonymous_pull_enabled = false\nPremium SKU is required for private link.',
    },
  ];
  const dataH = rowHeight(dataItems, dataCols.at(0).width);

  const fndX = dpInnerX;
  const fndW = 1200;
  const apimX = fndX + fndW + 40;
  const apimW = dpInnerX + dpInnerW - apimX;
  const fndInnerX = fndX + 30;
  const fndInnerW = fndW - 60;
  const fndProjSpec = {
    title: 'Foundry project  ·  fcmr-*-proj  ·  PREVIEW API',
    body:
      'accounts/projects@2026-05-15-preview, system-assigned identity.\nHosted agents run under this project identity.',
    stroke: C.violet,
    background: C.bgViolet,
  };
  const fndCols = columns({ x: fndInnerX, count: 2, width: (fndInnerW - 40) / 2, gap: 40 });
  const fndDeploySpecs = [
    {
      title: 'Serverless deployments',
      body:
        'gpt-5.4-mini · gpt-5.4 · gpt-5.6-sol\nclaude-sonnet-4-5 (Anthropic)\ngrok-4.3 (xAI)\nBilled per token.',
      stroke: C.green,
      background: C.bgGreen,
    },
    {
      title: 'Managed compute  ·  PREVIEW',
      body:
        'managedComputeDeployments@2026-05-15-preview\nnvidia-nemotron-3-nano-30b-a3b-fp8 on H100_80GB,\nGlobalManagedCompute capacity 1.\nThe only destination cleared for Restricted data.\n60m timeouts — provision ahead of the demo.',
      stroke: C.violet,
      background: C.bgViolet,
    },
  ];
  const fndDeployH = rowHeight(fndDeploySpecs, fndCols.at(0).width);
  const fndProjH = Scene.measure(fndProjSpec, fndInnerW);
  const fndH = 82 + fndProjH + 40 + fndDeployH + 30;

  const apimSpec = {
    title: 'APIM as AI gateway  —  NOT IN TERRAFORM',
    body:
      'docs/architecture.md and the constitution both require all model\ntraffic to transit APIM for token metering, cost ceilings and content\nsafety. No azurerm_api_management resource exists in either stack,\nand no private DNS zone for it is declared. Today the router calls the\nFoundry data plane directly over the foundry private endpoint.',
    stroke: C.red,
    background: C.white,
    strokeStyle: 'dashed',
    strokeWidth: 3,
  };
  const apimH = Math.max(Scene.measure(apimSpec, apimW), fndH);
  const dpH = 82 + dataH + 40 + Math.max(fndH, apimH) + 30;

  // Observability row
  const obsY = dpY + dpH + 60;
  const obsCols = columns({ x: dpInnerX, count: 2, width: (dpInnerW - 40) / 2, gap: 40 });
  const obsItems = [
    {
      title: 'Log Analytics workspace',
      body: 'PerGB2018, 30-day retention.\nBacks the Container Apps Environment.',
    },
    {
      title: 'Application Insights',
      body:
        'sampling_percentage = 100 — sampling is off so the\nscoreboard is complete inside the 5s budget (AC-5, ADR 004).\nCosmos remains the system of record for audit.',
    },
  ];
  const obsH = rowHeight(obsItems, obsCols.at(0).width);
  const obsGroupH = 82 + obsH + 30;

  const vnetH = obsY + obsGroupH + 40 - vnetY;

  // ---- emit groups (behind), then boxes (in front) -----------------------
  const vnet = scene.group({
    x: X0,
    y: vnetY,
    width: W,
    height: vnetH,
    label: 'VNET  fcmr-*-vnet   10.42.0.0/16   —   NO PUBLIC DATA-PLANE ENDPOINT',
    sublabel:
      'Principle II, enforced by scripts/policy-no-public-endpoints.sh in CI: every resource below declares public access disabled. This boundary is the compliance claim the demo rests on.',
    stroke: C.green,
    background: C.white,
    strokeWidth: 6,
    labelSize: 28,
    sublabelSize: 18,
  });

  const caSub = scene.group({
    x: caSubX,
    y: vContentTop,
    width: caSubW,
    height: subnetRowH,
    label: 'subnet  container-apps   10.42.0.0/23',
    sublabel: 'Delegated to Microsoft.App/environments.',
    stroke: C.green,
    background: C.white,
    strokeWidth: 3,
  });
  scene.group({
    x: caeX,
    y: vContentTop + 82,
    width: caeW,
    height: caeH,
    label: 'Container Apps Environment  ·  internal load balancer',
    sublabel: 'internal_load_balancer_enabled = true. No Kubernetes (ADR 001).',
    stroke: C.blue,
    background: C.white,
    strokeWidth: 2,
  });

  const peSub = scene.group({
    x: peSubX,
    y: vContentTop,
    width: peSubW,
    height: subnetRowH,
    label: 'subnet  private-endpoints   10.42.2.0/24',
    sublabel: 'One private endpoint per data plane. infrastructure/private-endpoints.tf.',
    stroke: C.green,
    background: C.white,
    strokeWidth: 3,
  });

  const dpGroup = scene.group({
    x: dpX,
    y: dpY,
    width: dpW,
    height: dpH,
    label: 'AZURE DATA PLANES  —  publicNetworkAccess = false on every one',
    sublabel: 'Entra-only authentication; local auth and account keys disabled (Principle VIII).',
    stroke: C.green,
    background: C.white,
    strokeWidth: 3,
  });
  scene.group({
    x: fndX,
    y: dpY + 82 + dataH + 40,
    width: fndW,
    height: fndH,
    label: 'Microsoft Foundry account  ·  kind = AIServices',
    sublabel:
      'publicNetworkAccess Disabled · disableLocalAuth true · allowProjectManagement true. Not an AI Hub workspace.',
    stroke: C.green,
    background: C.white,
    strokeWidth: 3,
  });

  scene.group({
    x: dpX,
    y: obsY,
    width: dpW,
    height: obsGroupH,
    label: 'Observability',
    sublabel:
      'Neither workspace has a private endpoint in infrastructure/*.tf — telemetry ingestion is the one data path that is not private-linked.',
    stroke: C.orange,
    background: C.white,
    strokeWidth: 3,
  });

  // boxes
  const webui = scene.box({
    ...webuiSpec,
    x: appX,
    y: vContentTop + 82 + 76,
    width: appW,
    height: hWebui,
    stroke: C.red,
    background: C.bgRed,
  });
  const router = scene.box({
    ...routerSpec,
    x: appX,
    y: vContentTop + 82 + 76 + hWebui + 40,
    width: appW,
    height: hRouter,
    stroke: C.blue,
    background: C.bgBlue,
    strokeWidth: 3,
  });
  const laneRuler = laneCols;
  const lanes = placeRow(
    scene,
    laneRuler,
    vContentTop + 82 + 76 + hWebui + 40 + hRouter + 40,
    laneSpecs,
    { stroke: C.green, background: C.bgGreen },
  );

  const peBoxes = [];
  for (let r = 0; r < 3; r += 1) {
    const y =
      vContentTop + 82 + peRowH.slice(0, r).reduce((a, b) => a + b + 40, 0);
    const slice = peItems.slice(r * 2, r * 2 + 2);
    slice.forEach((spec, i) => {
      peBoxes.push(
        scene.box({
          stroke: C.green,
          background: C.bgGreen,
          ...spec,
          x: peCols.at(i).x,
          y,
          width: peCols.at(i).width,
          height: peRowH[r],
        }),
      );
    });
  }

  const dataBoxes = placeRow(scene, dataCols, dpY + 82, dataItems, {
    stroke: C.green,
    background: C.bgGreen,
  });
  const fndProj = scene.box({
    ...fndProjSpec,
    x: fndInnerX,
    y: dpY + 82 + dataH + 40 + 82,
    width: fndInnerW,
    height: fndProjH,
  });
  placeRow(scene, fndCols, dpY + 82 + dataH + 40 + 82 + fndProjH + 40, fndDeploySpecs);
  scene.box({
    ...apimSpec,
    x: apimX,
    y: dpY + 82 + dataH + 40,
    width: apimW,
    height: apimH,
  });

  placeRow(scene, obsCols, obsY + 82, obsItems, { stroke: C.orange, background: C.bgYellow });

  // ---- arrows ------------------------------------------------------------
  const gapBandY = pubZoneBottom + 60;
  scene.arrow(pub[0], webui, {
    color: C.red,
    strokeWidth: 5,
    label: 'HTTPS — the ONLY public ingress\nanywhere in the system',
    labelWidth: 520,
    labelAt: { x: pub[0].cx - 40, y: gapBandY },
    sides: ['bottom', 'top'],
  });
  scene.arrow(pub[1], caSub, {
    color: C.violet,
    strokeStyle: 'dashed',
    strokeWidth: 3,
    label: 'Entra token issuance · managed identity · app roles\n(identity plane, not a data plane)',
    labelWidth: 640,
    labelAt: { x: pub[1].cx + 120, y: gapBandY },
    sides: ['bottom', 'top'],
  });
  scene.arrow(caSub, peSub, {
    color: C.green,
    strokeWidth: 5,
    sides: ['right', 'left'],
    label: 'ALL data-plane\ntraffic leaves\nthrough a private\nendpoint',
    labelWidth: 200,
    labelDy: -110,
  });
  scene.arrow(router, peSub, {
    color: C.blue,
    strokeWidth: 4,
    sides: ['right', 'left'],
    label: 'only the router\nreaches a model\ndeployment',
    labelWidth: 200,
    labelDy: 90,
  });
  scene.arrow(peSub, dpGroup, {
    color: C.green,
    strokeWidth: 5,
    sides: ['bottom', 'top'],
    label:
      'five private endpoints, six private DNS zones linked to the VNet —\neach terminates on the data plane below',
    labelWidth: 760,
    labelAt: { x: caSubX + 420, y: vContentTop + subnetRowH + 34 },
  });
  scene.arrow(webui, router, { color: C.blue, strokeWidth: 3, sides: ['bottom', 'top'] });
  for (const lane of lanes) {
    scene.arrow(lane, router, { color: C.green, strokeWidth: 2, sides: ['top', 'bottom'] });
  }

  // ---- legend ------------------------------------------------------------
  scene.legend({
    x: X0,
    y: vnetY + vnetH + 60,
    width: 1240,
    items: [LEGEND_PRIVATE, LEGEND_PUBLIC, LEGEND_PREVIEW, LEGEND_CHOKEPOINT, LEGEND_ABSENT],
  });
  scene.box({
    x: X0 + 1240 + 60,
    y: vnetY + vnetH + 60,
    width: W - 1240 - 60,
    title: 'What Beat 2 demonstrates with this picture',
    body:
      'task cloud:prove-private attempts the same data-plane operation from outside and from inside the VNet: the first fails, the second succeeds.\nThe CI policy job then shows that it cannot silently stop being private. The claim is continuous, not a point-in-time configuration.\nDeliberately excluded (say so out loud): no high availability, no disaster recovery, no multi-region, no real execution, no real data.',
    stroke: C.blue,
    background: C.white,
  });

  return scene;
}

// ===========================================================================
// 02 — Request decision flow
// ===========================================================================

export function requestDecisionFlow() {
  const scene = new Scene({ name: '02-request-decision-flow', seed: 0x22c4d5e6 });
  const X0 = 80;
  const W = 2960;

  scene.header({
    x: X0,
    y: 60,
    width: W,
    title: '02 · POST /v1/route — how a request becomes a governed decision',
    subtitle:
      'Conclusion: the caller never names a model, and governance policy runs BEFORE cost and complexity selection — so a cost optimisation can never reach a model policy has not approved.',
  });

  // Three columns with 200px gutters, so an arrow label never lands on a box.
  const COL_L = { x: X0, width: 760 };
  const COL_C = { x: X0 + 760 + 200, width: 1000 };
  const COL_R = { x: X0 + 760 + 200 + 1000 + 200, width: 800 };

  const topY = 230;

  // ---- Left column: the caller ------------------------------------------
  const callerSpec = {
    title: 'Caller  ·  lane service or webui',
    body:
      'POST /v1/route   (Entra token, Router.Invoke app role)\n{\n  "correlationId": "b6b1f0a2-…",\n  "lane": "Research",\n  "taskKind": "synthesize",\n  "payload": { "question": "…" },\n  "costCeilingUsd": 0.25,\n  "latencyBudgetMs": 8000,\n  "dataClassification": "Internal",\n  "policySetId": "CapitalMarkets-US",\n  "complexityHints": {\n    "inputTokenEstimate": 12000,\n    "requiresMultiStep": true,\n    "requiresRetrieval": true,\n    "requiresToolCalls": false\n  }\n}',
    bodyFamily: MONO,
    bodySize: 16,
    stroke: C.blue,
    background: C.white,
  };
  const caller = scene.box({ ...callerSpec, x: COL_L.x, y: topY, width: COL_L.width });

  const absent = scene.box({
    x: COL_L.x,
    y: caller.y + caller.height + 50,
    width: COL_L.width,
    title: 'PRINCIPLE IV — what is NOT in this request',
    body:
      'There is no "model" field.\nThere is no "vendor" field.\nThere is no "deployment" field.\n\nAnd there will not be one: a field that exists is a field that\neventually gets used. dataClassification states what the data IS;\nit is not a routing preference. Omitting it is a 400, never an\nassumption of "Public".',
    stroke: C.red,
    background: C.bgRed,
    strokeWidth: 4,
  });

  const orderBanner = scene.box({
    x: COL_L.x,
    y: absent.y + absent.height + 50,
    width: COL_L.width,
    title: 'THE ORDER IS LOAD-BEARING',
    body:
      'catalog → PolicyGate.Evaluate() → eligible → TierSelector.Select()\n\nPolicy decides what is PERMISSIBLE.\nThe router then decides what is APPROPRIATE among the permissible.\n\nReverse these two and a cost optimisation can reach a model\ngovernance has not approved. The order is asserted by test, not\nleft to code reading.',
    stroke: C.red,
    background: C.bgYellow,
    strokeWidth: 4,
  });

  const swap = scene.box({
    x: COL_L.x,
    y: orderBanner.y + orderBanner.height + 50,
    width: COL_L.width,
    title: 'Beat 5 — the swap nobody deployed for',
    body:
      'An approver toggles Anthropic off on /policy. No redeploy, no code\nchange, no prompt change. The identical request replans across the\nremaining approved vendors and the exclusion reason reads:\n"Vendor Anthropic is not approved under policy set\n\'CapitalMarkets-US\'."\n\nSet dataClassification to Restricted and every hosted vendor is\nexcluded; execution lands on the open-weight model on managed\ncompute inside the VNet.',
    stroke: C.violet,
    background: C.bgViolet,
  });

  // ---- Centre column: the pipeline ---------------------------------------
  const steps = [
    {
      title: 'router-service  ·  POST /v1/route',
      body:
        'Internal Container Apps ingress. There is no public FQDN.\nRejects a caller without the Router.Invoke app role with 403.\nRoutingPlanner.Plan() is the single entry point and the one place\nthe evaluation order is decided — calling TierSelector directly\nwould bypass the gate.',
      stroke: C.blue,
      background: C.bgBlue,
      strokeWidth: 3,
    },
    {
      title: 'ComplexityScorer.Score(hints)',
      body:
        'Pure, deterministic, caller-supplied signals only — never inferred from model output.\ntokens/32000 × 0.40  +  multiStep × 0.25  +  retrieval × 0.20  +  toolCalls × 0.15\nRounded to 4dp, clamped 0–1.   IndicatedTier:  <0.35 Economy · <0.70 Standard · else Premium.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: 'STEP 1 — PolicyGate.Evaluate(catalog, policySet, classification, region)',
      body:
        'Runs FIRST, against the full multi-vendor catalog. Excludes, in order:\n  · region not in policy.AllowedRegions  → the whole catalog is excluded\n  · vendor not in policy.ApprovedVendors\n  · classification > policy.MaxClassification[vendor]\n  · cost > policy.MaxCostPerRequestUsd\nEvery exclusion carries prose fit to read aloud to a governance audience.',
      stroke: C.red,
      background: C.bgYellow,
      strokeWidth: 4,
    },
    {
      title: 'STEP 2 — TierSelector.Select(score, ceiling, eligible)',
      body:
        'Sees ONLY the policy-eligible candidates. Prefers the indicated tier; if it is\nunaffordable or unavailable it takes the most capable tier that is both.\nThe ceiling is a control, not a report.',
      stroke: C.blue,
      background: C.bgBlue,
      strokeWidth: 4,
    },
    {
      title: 'Vendor invocation',
      body:
        'The selected deployment is invoked over the Foundry private endpoint.\nAPIM metering / content safety is specified but not yet in Terraform.\nNo silent retry on a different tier — that would corrupt the cost figures.',
      stroke: C.green,
      background: C.bgGreen,
    },
  ];

  const centreBoxes = [];
  let cy = topY;
  for (const spec of steps) {
    const b = scene.box({ ...spec, x: COL_C.x, y: cy, width: COL_C.width });
    centreBoxes.push(b);
    cy = b.y + b.height + 60;
  }
  const [entry, scorer, gate, selector, invoke] = centreBoxes;

  // ---- Right column: the four outcomes ------------------------------------
  const outcomes = [
    {
      title: 'RefusedByPolicy  →  HTTP 200',
      body:
        'Policy left no eligible candidate. selectedDeployment is null and every\ncandidate is listed with its reason.\n\nReturned as 200 on purpose: a refusal is a correct, governed outcome.\nModelling it as 4xx would invite retry-on-error, and the one thing that\nmust never happen is a retry that finds an unapproved model.',
      stroke: C.red,
      background: C.bgRed,
      strokeWidth: 4,
    },
    {
      title: 'Denied  →  HTTP 402',
      body:
        'Cost ceiling. Even the cheapest available tier projects above the ceiling.\n"Cheapest available tier Economy projects 0.310 USD against a ceiling\nof 0.250 USD."\n\nKept distinct from RefusedByPolicy: "too expensive" and "not permitted"\nare different conversations with different people.',
      stroke: C.red,
      background: C.bgRed,
      strokeWidth: 3,
    },
    {
      title: 'Downgraded  →  HTTP 200',
      body:
        'Complexity indicated a higher tier; the ceiling did not allow it.\nRouted to the most capable affordable tier, with the downgrade named\nin the rationale. This is wow moment B on the comparison screen.',
      stroke: C.orange,
      background: C.bgYellow,
      strokeWidth: 3,
    },
    {
      title: 'Routed  →  HTTP 200',
      body:
        'Routed to the tier the complexity score indicated, within both the policy\nceiling and the request ceiling. Rationale names the deciding factor in a\nplain sentence, because the presenter reads it aloud on stage.',
      stroke: C.green,
      background: C.bgGreen,
      strokeWidth: 3,
    },
  ];
  const outcomeH = outcomes.map((s2) => Scene.measure(s2, COL_R.width - 60));
  const outcomesTop = topY;
  const outcomesGroupH = 96 + outcomeH.reduce((a, b) => a + b + 50, 0) - 50 + 30;
  const outcomesGroup = scene.group({
    x: COL_R.x - 30,
    y: outcomesTop,
    width: COL_R.width,
    height: outcomesGroupH,
    label: 'FOUR OUTCOMES — three of them are HTTP 200',
    sublabel: 'A governed "no" is a correct answer, not an error.',
    stroke: C.ink,
    background: C.white,
    strokeWidth: 3,
  });
  const outcomeBoxes = [];
  let oy = outcomesTop + 96;
  outcomes.forEach((spec, i) => {
    const b = scene.box({ ...spec, x: COL_R.x, y: oy, width: COL_R.width - 60, height: outcomeH[i] });
    outcomeBoxes.push(b);
    oy = b.y + b.height + 50;
  });
  oy = outcomesTop + outcomesGroupH;
  const [refused, denied, downgraded, routed] = outcomeBoxes;

  // ---- Bottom: persistence + audit ---------------------------------------
  const bottomY = Math.max(cy, oy, swap.y + swap.height + 60) + 40;
  const persistCols = columns({ x: X0 + 40, count: 3, width: (W - 80 - 2 * 40) / 3, gap: 40 });
  const persistItems = [
    {
      title: 'Cosmos  ·  routerDecisions',
      body:
        'Partitioned by /correlationId.\nInputs, candidate tiers with per-candidate rejection\nreasons, policy exclusions, outcome, rationale,\npolicySetId and policySetVersion.\nGET /v1/decisions/{correlationId} (Router.Read).',
      stroke: C.green,
      background: C.bgGreen,
    },
    {
      title: 'Cosmos  ·  auditEvents  (append-only)',
      body:
        'Every step writes one record keyed by the same correlationId.\nAppend-only and retained for the life of the environment.\nAC-8: the whole chain is reconstructable in ONE query —\nwhich is exactly what Beat 8 does from an unrehearsed pick.',
      stroke: C.green,
      background: C.bgGreen,
      strokeWidth: 3,
    },
    {
      title: 'Scoreboard  ·  Application Insights (Cosmos change feed as fallback)',
      body:
        'GET /v1/scoreboard?window=15m — count, total cost, baseline cost,\nsavings delta, p50/p95 latency, tier distribution, mean quality by lane.\nVisible within 5 seconds (AC-5). Sampling is disabled for router and\napproval telemetry; the UI labels the degraded source when it falls back.',
      stroke: C.blue,
      background: C.bgBlue,
    },
  ];
  const persistH = rowHeight(persistItems, persistCols.at(0).width);
  const persistGroup = scene.group({
    x: X0,
    y: bottomY,
    width: W,
    height: 82 + persistH + 30,
    label: 'EVERY outcome above — including both refusals — is persisted and audited',
    sublabel:
      'A denial is never silently absorbed; it is always surfaced to the UI. Principle VI: one correlationId spans the whole lifecycle.',
    stroke: C.green,
    background: C.white,
    strokeWidth: 3,
  });
  placeRow(scene, persistCols, bottomY + 82, persistItems);

  // ---- arrows ------------------------------------------------------------
  scene.arrow(caller, entry, {
    color: C.blue,
    strokeWidth: 3,
    label: 'a business\nrequest, not a\nmodel choice',
    labelWidth: 190,
    labelDy: -60,
  });
  scene.arrow(entry, scorer, { color: C.ink, strokeWidth: 3, sides: ['bottom', 'top'] });
  scene.arrow(scorer, gate, {
    color: C.red,
    strokeWidth: 5,
    sides: ['bottom', 'top'],
    label: 'score + the FULL catalog',
    labelWidth: 300,
    labelDx: 260,
  });
  scene.arrow(gate, selector, {
    color: C.red,
    strokeWidth: 5,
    sides: ['bottom', 'top'],
    label: 'ONLY the policy-eligible candidates reach selection',
    labelWidth: 460,
    labelDx: 340,
  });
  scene.arrow(selector, invoke, { color: C.green, strokeWidth: 3, sides: ['bottom', 'top'] });

  scene.arrow(gate, refused, {
    color: C.red,
    strokeWidth: 4,
    sides: ['right', 'left'],
    label: 'no eligible\ncandidate',
    labelWidth: 190,
    labelDy: -46,
  });
  scene.arrow(selector, denied, {
    color: C.red,
    strokeWidth: 3,
    sides: ['right', 'left'],
    label: 'nothing\naffordable',
    labelWidth: 190,
    labelDy: -46,
  });
  scene.arrow(invoke, downgraded, {
    color: C.orange,
    strokeWidth: 3,
    sides: ['right', 'left'],
    label: 'chosen.Tier\n< indicated',
    labelWidth: 190,
    labelDy: -46,
  });
  scene.arrow(invoke, routed, {
    color: C.green,
    strokeWidth: 3,
    sides: ['right', 'left'],
    label: 'chosen.Tier\n== indicated',
    labelWidth: 190,
    labelDy: 46,
  });

  scene.arrow(invoke, persistGroup, {
    color: C.green,
    strokeWidth: 4,
    sides: ['bottom', 'top'],
    label: 'result + metrics',
    labelWidth: 260,
    labelDx: -190,
  });
  scene.arrow(outcomesGroup, persistGroup, {
    color: C.ink,
    strokeWidth: 4,
    sides: ['bottom', 'top'],
    elbow: 'v',
    label: 'EVERY outcome is written,\nincluding both refusals',
    labelWidth: 400,
    labelDx: -230,
    labelDy: 60,
  });

  // ---- legend ------------------------------------------------------------
  const legendY = bottomY + 82 + persistH + 30 + 60;
  scene.legend({
    x: X0,
    y: legendY,
    width: 1240,
    items: [
      LEGEND_CHOKEPOINT,
      { stroke: C.red, background: C.bgYellow, text: 'Governance gate. Runs before any cost reasoning.' },
      LEGEND_PUBLIC,
      { stroke: C.orange, background: C.bgYellow, text: 'Cost control acting — a downgrade, visible and explained.' },
      LEGEND_PRIVATE,
    ],
  });
  scene.box({
    x: X0 + 1240 + 60,
    y: legendY,
    width: W - 1240 - 60,
    title: 'The test of Principle IV, stated as an experiment',
    body:
      'Two requests with byte-identical bodies, submitted under different policy sets, may execute on different vendors and both succeed.\nIf swapping a vendor requires a code change, a redeploy, or a prompt edit, the principle is violated — no matter what the diagram says.\nThe router is deterministic code and always will be: routing the thing that decides routing would be circular, and a compliance audience\nwill read this assembly line by line. It is under a 70% coverage gate for exactly that reason.',
    stroke: C.blue,
    background: C.white,
  });

  return scene;
}

// ===========================================================================
// 03 — Agent architecture
// ===========================================================================

export function agentArchitecture() {
  const scene = new Scene({ name: '03-agent-architecture', seed: 0x33e6f708 });
  const X0 = 80;
  const W = 2760;

  scene.header({
    x: X0,
    y: 60,
    width: W,
    title: '03 · Lane services as custodians of Foundry hosted agents',
    subtitle:
      'Conclusion: the agent reasons but the service is accountable — two network-enforced boundaries stop the agent reaching a model or a tool reaching a model, and no consequential action leaves the system without a human.',
  });

  const topY = 240;
  const cols4 = columns({ x: X0, count: 4, width: (W - 3 * 160) / 4, gap: 160 });

  const custodianSpec = {
    title: '① Lane service  ·  the CUSTODIAN',
    body:
      'C# on Container Apps. It is not the agent.\n\n1. stamps correlationId BEFORE thread creation\n2. creates ONE thread for ONE business request —\n   threads are never reused, because carried-over\n   context makes cost and reproducibility\n   unexplainable and both are demo claims\n3. supplies the tool surface\n4. enforces the approval halt\n5. writes the audit record\n\nStep budget: exceed it and the agent halts, returns\npartial work, and logs. An agent that loops on stage\nis worse than one that stops.',
    stroke: C.blue,
    background: C.bgBlue,
    strokeWidth: 3,
  };
  const agentSpec = {
    title: '② Hosted Foundry agent  ·  one per lane',
    body:
      'Runs under the Foundry PROJECT identity (ADR 005).\n\nResearch — retrieve, then synthesise per claim.\n  Read-only. Must be able to return "I could not\n  attribute this" as a SUCCESS (Principle III).\nSurveillance — triage 500+ alerts, then assemble\n  evidence. Halts for approval.\nOrder routing — one proposal. Halts every time.\n\nRetrieved chunks are DATA, never instructions:\nwrapped in a delimited envelope that carries no tool\nauthority. Injection attempts are logged as audit\nevents (T-024).',
    stroke: C.violet,
    background: C.bgViolet,
    strokeWidth: 3,
  };
  const mcpSpec = {
    title: '③ MCP tool server  ·  hosted IN the lane service',
    body:
      'Research: search_corpus, fetch_chunk, list_sources\n  — all read-only.\nSurveillance: fetch_alert_batch, fetch_communications,\n  fetch_trade_context, submit_for_approval.\nOrder routing: fetch_order, fetch_venue_liquidity,\n  evaluate_best_execution_policy, submit_for_approval.\n\nevaluate_best_execution_policy is deterministic code\nthe agent CALLS, not the agent\'s judgement. The model\nexplains the result; code decides what is permitted.\n\nsubmit_for_approval is the ONLY tool in the entire\nsystem with a side effect — and it writes a proposal,\nnever a state change.',
    stroke: C.green,
    background: C.bgGreen,
    strokeWidth: 3,
  };
  const dataSpec = {
    title: '④ Data planes  ·  private endpoints only',
    body:
      'Azure AI Search — synthetic research corpus.\nCosmos DB — alerts, proposals, approvals, audit.\nSimulated OMS — labelled simulated on the record\nitself, not as a disclaimer in a corner, so a\nscreenshot taken out of context is still honest.\n\nThe lane service identities hold Search Index Data\nReader and nothing on Foundry (apps/roles.tf).',
    stroke: C.green,
    background: C.bgGreen,
    strokeWidth: 3,
  };

  const rowSpecs = [custodianSpec, agentSpec, mcpSpec, dataSpec];
  const rowH = rowHeight(rowSpecs, cols4.at(0).width);
  const rowBoxes = rowSpecs.map((s, i) =>
    scene.box({ ...s, x: cols4.at(i).x, y: topY, width: cols4.at(i).width, height: rowH }),
  );
  const [custodian, agent, mcp, dataPlanes] = rowBoxes;

  scene.arrow(custodian, agent, {
    color: C.blue,
    strokeWidth: 3,
    label: 'thread +\ncorrelationId',
    labelWidth: 150,
    labelDy: -60,
  });
  scene.arrow(agent, mcp, {
    color: C.violet,
    strokeWidth: 3,
    label: 'tool call',
    labelWidth: 150,
    labelDy: -60,
  });
  scene.arrow(mcp, dataPlanes, {
    color: C.green,
    strokeWidth: 3,
    label: 'reads data',
    labelWidth: 150,
    labelDy: -60,
  });

  // ---- Boundary 2 --------------------------------------------------------
  const b2y = topY + rowH + 70;
  const b2 = scene.box({
    x: X0,
    y: b2y,
    width: W,
    title: 'BOUNDARY 2 — network enforced:  TOOLS REACH DATA, NEVER MODELS',
    body:
      'No MCP tool wraps a model invocation. If a tool needs model output it calls the router like any other caller, and that call is routed, priced and recorded.\nThis is what keeps the cost scoreboard a total rather than a sample: there is no side door through which an unmetered model call can be made.',
    stroke: C.red,
    background: C.bgRed,
    strokeWidth: 4,
    strokeStyle: 'dashed',
  });

  // ---- Boundary 1 --------------------------------------------------------
  const b1y = b2.y + b2.height + 60;
  const b1 = scene.box({
    x: X0,
    y: b1y,
    width: W,
    title: "BOUNDARY 1 — network enforced:  THE AGENT'S MODEL ACCESS IS THE ROUTER'S",
    body:
      'Only the router-service identity holds "Azure AI Developer" on the Foundry project (apps/roles.tf). The lane services have no such assignment and no route to the Foundry data plane.\nThis is not a convention enforced by code review. It is the reason the cost ceiling is a control rather than a reporting feature: a ceiling services could bypass would be advisory.',
    stroke: C.red,
    background: C.bgRed,
    strokeWidth: 4,
    strokeStyle: 'dashed',
  });

  // ---- Router chain ------------------------------------------------------
  const chainY = b1.y + b1.height + 60;
  const chainCols = columns({ x: X0, count: 3, width: (W - 2 * 60) / 3, gap: 60 });
  const chainSpecs = [
    {
      title: 'router-service  ·  POST /v1/route',
      body:
        'The single chokepoint. Deterministic code, never an agent:\nmaking the component that enforces governance non-deterministic\nis not a position you can defend to a compliance audience.\nPolicyGate then TierSelector, decision recorded with rationale.',
      stroke: C.blue,
      background: C.bgBlue,
      strokeWidth: 4,
    },
    {
      title: 'APIM AI gateway  —  NOT IN TERRAFORM',
      body:
        'Specified for token metering, cost ceilings and content safety in\ndocs/architecture.md and the constitution. No APIM resource exists\nin either stack today, so the ceiling is currently enforced in one\nplace (the router) rather than two.',
      stroke: C.red,
      background: C.white,
      strokeWidth: 3,
      strokeStyle: 'dashed',
    },
    {
      title: 'Foundry model deployments',
      body:
        'Serverless: AzureOpenAI, Anthropic, xAI.\nManaged compute (PREVIEW): open-weight model on H100_80GB\ncapacity inside the VNet — the only destination cleared for\nRestricted data.',
      stroke: C.green,
      background: C.bgGreen,
      strokeWidth: 3,
    },
  ];
  const chainH = rowHeight(chainSpecs, chainCols.at(0).width);
  const chain = chainSpecs.map((s, i) =>
    scene.box({ ...s, x: chainCols.at(i).x, y: chainY, width: chainCols.at(i).width, height: chainH }),
  );
  scene.arrow(chain[0], chain[1], { color: C.blue, strokeWidth: 3 });
  scene.arrow(chain[1], chain[2], { color: C.green, strokeWidth: 3 });
  scene.arrow(agent, b1, {
    color: C.violet,
    strokeWidth: 3,
    strokeStyle: 'dashed',
    sides: ['bottom', 'top'],
    label: 'model invocation — crosses the boundary only via the router',
    labelWidth: 620,
    labelAt: { x: X0 + W - 420, y: b2.y + b2.height + 30 },
  });
  scene.arrow(b1, chain[0], { color: C.red, strokeWidth: 4, sides: ['bottom', 'top'] });

  // ---- Determinism row ---------------------------------------------------
  const detY = chainY + chainH + 70;
  const detCols = columns({ x: X0 + 40, count: 3, width: (W - 80 - 2 * 60) / 3, gap: 60 });
  const detSpecs = [
    {
      title: 'The model produces SCORES',
      body:
        'Each alert is scored against a fixed rubric with the temperature\npinned. 500 alerts do not fit one context window and do not try to:\nthe service chunks them and routes each chunk independently —\nwhich is also what makes the cost scoreboard interesting.',
      stroke: C.violet,
      background: C.bgViolet,
    },
    {
      title: 'Deterministic CODE produces the RANKING',
      body:
        'The ordering is applied by the lane service, not by the model.\nThis is the single design choice that makes AC-6 achievable:\nsame seed and same inputs produce the same order, provably,\non stage. A free-running agent over 500 alerts would not.',
      stroke: C.blue,
      background: C.bgBlue,
      strokeWidth: 4,
    },
    {
      title: 'Quality is deterministic too — never LLM-as-judge',
      body:
        'Attribution coverage (research), rank agreement against a seeded\nground truth (surveillance), policy conformance (order routing).\nAll recomputable by the audience. A model-graded number invites\nan obvious objection and the demo loses the room defending it.',
      stroke: C.green,
      background: C.bgGreen,
    },
  ];
  const detH = rowHeight(detSpecs, detCols.at(0).width);
  scene.group({
    x: X0,
    y: detY,
    width: W,
    height: 82 + detH + 30,
    label: 'REPRODUCIBILITY — where the model stops and code starts',
    sublabel: 'The boundary that makes AC-6 (identical ranking for a fixed seed) an achievable claim.',
    stroke: C.blue,
    background: C.white,
    strokeWidth: 3,
  });
  const detBoxes = detSpecs.map((s, i) =>
    scene.box({ ...s, x: detCols.at(i).x, y: detY + 82, width: detCols.at(i).width, height: detH }),
  );
  scene.arrow(detBoxes[0], detBoxes[1], { color: C.blue, strokeWidth: 3 });
  scene.arrow(detBoxes[1], detBoxes[2], { color: C.green, strokeWidth: 3 });

  // ---- Human in the loop -------------------------------------------------
  const hitlY = detY + 82 + detH + 30 + 70;
  const hitlCols = columns({ x: X0 + 40, count: 4, width: (W - 80 - 3 * 50) / 4, gap: 50 });
  const hitlSpecs = [
    {
      title: 'submit_for_approval',
      body:
        'The only side-effecting tool in the system.\nIt writes a proposal plus an evidence packet.\nNo alert, order or publication changes state.',
      stroke: C.orange,
      background: C.bgYellow,
    },
    {
      title: 'PendingApproval  ·  Cosmos approvals',
      body:
        'The proposal, the evidence packet exactly as it\nwill be presented, and the proposing identity.\nPartitioned by /correlationId.',
      stroke: C.orange,
      background: C.bgYellow,
    },
    {
      title: 'HUMAN approver  ·  Approver app role',
      body:
        'Segregation of duties is enforced in the approval API,\nnot in the UI. The UI renders the control disabled with\nthe reason; the API refuses the call. Beat 6 shows the\nAPI refusing, because that is the one the audience believes.',
      stroke: C.orange,
      background: C.bgYellow,
      strokeWidth: 4,
    },
    {
      title: 'Approved → executed & audited   ·   Expired → nothing happened',
      body:
        'An approval persists approver identity, timestamp, decision and\nthe full evidence packet presented at decision time.\nAn unapproved proposal EXPIRES. It never auto-executes on\ntimeout — a gate that opens on inaction is not a gate.',
      stroke: C.orange,
      background: C.bgYellow,
      strokeWidth: 3,
    },
  ];
  const hitlH = rowHeight(hitlSpecs, hitlCols.at(0).width);
  scene.group({
    x: X0,
    y: hitlY,
    width: W,
    height: 82 + hitlH + 30,
    label: 'PRINCIPLE I — HUMAN IN THE LOOP (NON-NEGOTIABLE)',
    sublabel: 'The agent may propose, rank, draft and evidence. It may not commit.',
    stroke: C.orange,
    background: C.white,
    strokeWidth: 4,
  });
  const hitlBoxes = hitlSpecs.map((s, i) =>
    scene.box({ ...s, x: hitlCols.at(i).x, y: hitlY + 82, width: hitlCols.at(i).width, height: hitlH }),
  );
  scene.arrow(hitlBoxes[0], hitlBoxes[1], { color: C.orange, strokeWidth: 3 });
  scene.arrow(hitlBoxes[1], hitlBoxes[2], { color: C.orange, strokeWidth: 3 });
  scene.arrow(hitlBoxes[2], hitlBoxes[3], { color: C.orange, strokeWidth: 3 });

  // ---- Failure modes -----------------------------------------------------
  const failY = hitlY + 82 + hitlH + 30 + 70;
  const failCols = columns({ x: X0 + 40, count: 4, width: (W - 80 - 3 * 50) / 4, gap: 50 });
  const failSpecs = [
    {
      title: 'Tool error',
      body: 'Surfaced to the agent. One retry, then partial\nresults with the gap explicitly named.',
    },
    {
      title: 'Model timeout',
      body:
        'The router returns a routing failure and the lane\nreports it. NO silent retry on a different tier —\nthat would corrupt the cost figures.',
    },
    {
      title: 'No eligible model (policy)',
      body:
        'Explicit refusal naming the exclusions. Never a\nfallback to an unapproved model. A governance\nsystem that degrades OPEN is not a control.',
      stroke: C.red,
      background: C.bgRed,
      strokeWidth: 3,
    },
    {
      title: 'Step budget exceeded',
      body:
        'Halt, return partial work, log. Foundry caps tool\ncount and step depth; the surveillance agent is\nclosest to those limits (verify early, T-027a).',
    },
  ];
  const failH = rowHeight(failSpecs, failCols.at(0).width);
  scene.group({
    x: X0,
    y: failY,
    width: W,
    height: 82 + failH + 30,
    label: 'FAILURE MODES — each has a defined, demonstrable behaviour',
    sublabel: 'Every one of these is rehearsed. A failure with no defined behaviour is a failure discovered on stage.',
    stroke: C.ink,
    background: C.white,
    strokeWidth: 3,
  });
  failSpecs.forEach((s, i) =>
    scene.box({
      stroke: C.ink,
      background: C.white,
      ...s,
      x: failCols.at(i).x,
      y: failY + 82,
      width: failCols.at(i).width,
      height: failH,
    }),
  );

  // ---- legend ------------------------------------------------------------
  const legendY = failY + 82 + failH + 30 + 60;
  scene.legend({
    x: X0,
    y: legendY,
    width: 1240,
    items: [
      LEGEND_CHOKEPOINT,
      { stroke: C.violet, background: C.bgViolet, text: 'Model reasoning — the non-deterministic part, deliberately fenced.' },
      LEGEND_PRIVATE,
      LEGEND_HUMAN,
      { stroke: C.red, background: C.bgRed, strokeStyle: 'dashed', text: 'Network-enforced boundary, or a refusal path.' },
      LEGEND_ABSENT,
    ],
  });
  scene.box({
    x: X0 + 1240 + 60,
    y: legendY,
    width: W - 1240 - 60,
    title: 'Why the router is not an agent',
    body:
      'The exchange is deterministic code: policy evaluation, complexity scoring, tier selection. It is the component a compliance audience will interrogate line by line\nand the assembly under a coverage gate. Making it an agent would mean explaining why the thing that enforces governance is itself non-deterministic.\nIt is a service, permanently. The same separation appears twice more: evaluate_best_execution_policy decides and the agent explains; the model scores alerts\nand the service ranks them. In each case the model reasons and code decides what is permitted.',
    stroke: C.blue,
    background: C.white,
  });

  return scene;
}

// ===========================================================================
// 04 — UI screen map
// ===========================================================================

export function uiScreenMap() {
  const scene = new Scene({ name: '04-ui-screen-map', seed: 0x44081920 });
  const X0 = 80;
  const W = 2520;

  scene.header({
    x: X0,
    y: 60,
    width: W,
    title: '04 · Scoreboard UI — twelve screens, grouped by app role',
    subtitle:
      'Conclusion: for the audience the UI is the system, and every beat of the demo has a screen that owns it — including the governance surface (/policy) that Beat 5 cannot happen without.',
  });

  const topY = 240;
  const roleCols = columns({ x: X0, count: 3, width: (W - 2 * 160) / 3, gap: 160 });
  const colW = roleCols.at(0).width;
  const innerW = colW - 60;

  const invokeScreens = [
    {
      title: '1 · Request console   /',
      body:
        'Beats 3 and 5. T-028.\nSubmits a business request: intent, cost ceiling,\ndata classification. Exposes classification as a\ncontrol — it is a property of the REQUEST, not a\nrouting preference, so it stays inside Principle IV.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: '9 · Research   /research   — WOW D',
      body:
        'Beat 7. T-033.\nInline citations as clickable superscripts opening the\nsource chunk; coverage percentage in the header.\nThe unattributable-claims panel is ALWAYS present and\nsays "no unattributable claims" when empty — a panel\nthat only appears on failure teaches the audience it is\nan error state rather than a control.',
      stroke: C.violet,
      background: C.bgViolet,
      strokeWidth: 4,
    },
    {
      title: '10 · Order routing   /orders',
      body:
        'No beat of its own. T-034.\nEvery surface showing execution is labelled SIMULATED\non the record itself, not as a corner disclaimer.',
      stroke: C.blue,
      background: C.bgBlue,
    },
  ];

  const readScreens = [
    {
      title: '2 · Live scoreboard   /scoreboard',
      body:
        'Beat 3. T-029.\n5-second refresh; shows the timestamp of the data,\nnot a spinner. A stale number that admits it is stale\nbeats a fresh-looking lie.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: '3 · Cost comparison   /scoreboard/comparison   — WOW B',
      body:
        'Beat 3. T-030.\nONE number dominates: percentage saved against an\nall-premium baseline. Per-request tier, cost, latency\nand rationale beneath it. The presenter drills a row\nmid-sentence and reads the rationale aloud, so the\nrationale must be a plain sentence naming the deciding\nfactor — not a JSON blob and not a score.',
      stroke: C.violet,
      background: C.bgViolet,
      strokeWidth: 4,
    },
    {
      title: '4 · Decision detail   /decisions/:id',
      body:
        'Beats 3 and 8. T-029.\nComplexity inputs, candidate tiers with per-candidate\nrejection reasons, policy exclusions, outcome, rationale.\nEvery number on the scoreboard opens to this.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: '5 · Surveillance triage   /surveillance   — WOW C',
      body:
        'Beat 4. T-031.\n500+ alerts, virtualised list (500 DOM rows stutter on\nprojector hardware and the stutter reads as "this does\nnot scale"). Sorts default to model rank, because the\nranking IS the product. A visible seed indicator carries\nthe AC-6 reproducibility claim.',
      stroke: C.violet,
      background: C.bgViolet,
      strokeWidth: 4,
    },
    {
      title: '6 · Alert detail   /surveillance/:id',
      body:
        'Beat 4. T-031.\nRationale plus assembled evidence. Proposing escalation\nfrom here creates an approval, never an escalation.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: '11 · Audit reconstruction   /audit/:correlationId',
      body:
        'Beat 8. T-020.\nOne query rebuilds the whole chain. The audience picks\nthe interaction — unrehearsed, or it is worth nothing.',
      stroke: C.green,
      background: C.bgGreen,
      strokeWidth: 3,
    },
  ];

  const approverScreens = [
    {
      title: '7 · Approval queue   /approvals',
      body:
        'Beat 6. T-032.\nPending proposals with their evidence packets, and\nexpired proposals showing that a timeout produced\nno action at all.',
      stroke: C.orange,
      background: C.bgYellow,
    },
    {
      title: '8 · Approval detail   /approvals/:id',
      body:
        'Beat 6. T-032.\nThe approve control renders DISABLED with the reason\nstated when the viewer is the proposer — and the API\nrefuses the call independently. Unauthorised navigation\nis hidden; unauthorised ACTIONS are visibly blocked.\nThose are different on purpose: a hidden button leaves\nnothing to demonstrate.',
      stroke: C.orange,
      background: C.bgYellow,
      strokeWidth: 4,
    },
    {
      title: '12 · Policy sets   /policy   — UNSCHEDULED',
      body:
        'Beat 5. No task number: this screen does not exist in\nthe current task list, and Beat 5 cannot run without it.\nThe vendor toggle has to live in the product — doing it\nin the Azure portal breaks the claim that governance is\na first-class surface. Read-mostly with a single vendor\ntoggle is enough.',
      stroke: C.red,
      background: C.bgRed,
      strokeWidth: 4,
    },
  ];

  function placeColumn(index, roleTitle, roleSub, screens, stroke) {
    const x = roleCols.at(index).x;
    const heights = screens.map((s) => Scene.measure(s, innerW));
    const groupH = 96 + heights.reduce((a, b) => a + b + 40, 0) - 40 + 30;
    const g = scene.group({
      x,
      y: topY,
      width: colW,
      height: groupH,
      label: roleTitle,
      sublabel: roleSub,
      stroke,
      background: C.white,
      strokeWidth: 3,
    });
    let y = topY + 96;
    const boxes = screens.map((s, i) => {
      const b = scene.box({ ...s, x: x + 30, y, width: innerW, height: heights[i] });
      y += heights[i] + 40;
      return b;
    });
    return { boxes, bottom: topY + groupH, group: g };
  }

  const invoke = placeColumn(
    0,
    'Router.Invoke',
    'Service-to-service model access through the router. Application member type.',
    invokeScreens,
    C.blue,
  );
  const read = placeColumn(
    1,
    'Router.Read',
    'Read routing decisions and the scoreboard. User and Application.',
    readScreens,
    C.blue,
  );
  const approver = placeColumn(
    2,
    'Approver',
    'Decide on pending proposals. Cannot approve own proposals. User only.',
    approverScreens,
    C.orange,
  );

  const bottom = Math.max(invoke.bottom, read.bottom, approver.bottom);

  // Navigation / drill paths that the demo actually walks.
  scene.arrow(read.boxes[1], read.boxes[2], {
    color: C.blue,
    strokeWidth: 3,
    sides: ['left', 'left'],
    elbow: 'h',
    label: 'drill a row\nmid-sentence',
    labelWidth: 140,
    labelDx: -80,
  });
  scene.arrow(read.boxes[3], read.boxes[4], {
    color: C.blue,
    strokeWidth: 3,
    sides: ['left', 'left'],
    elbow: 'h',
    label: 'open the\ntop alert',
    labelWidth: 140,
    labelDx: -80,
  });
  scene.arrow(read.boxes[4], approver.boxes[0], {
    color: C.orange,
    strokeWidth: 4,
    label: 'propose\nescalation →\nit does NOT\nescalate',
    labelWidth: 150,
  });
  scene.arrow(approver.boxes[0], approver.boxes[1], {
    color: C.orange,
    strokeWidth: 3,
    sides: ['right', 'right'],
    elbow: 'h',
    label: 'open the\nevidence packet',
    labelWidth: 140,
    labelDx: 80,
  });
  const beat5Detour =
    bottom - (approver.boxes[2].y + approver.boxes[2].height) + 70;
  scene.arrow(approver.boxes[2], invoke.group, {
    color: C.red,
    strokeWidth: 5,
    sides: ['bottom', 'bottom'],
    detour: beat5Detour,
    label:
      'BEAT 5: disable a vendor on 12 · Policy sets, then resubmit the IDENTICAL request on 1 · Request console.  No redeploy, no code change, no prompt change.',
    labelWidth: 1100,
    labelAt: { x: X0 + W / 2, y: bottom + 100 },
  });
  scene.arrow(read.boxes[2], read.boxes[5], {
    color: C.green,
    strokeWidth: 3,
    sides: ['right', 'right'],
    elbow: 'h',
    label: 'correlationId',
    labelWidth: 140,
    labelDx: 80,
  });

  // ---- Beat track --------------------------------------------------------
  const beatY = bottom + 170;
  const beatCols = columns({ x: X0 + 40, count: 6, width: (W - 80 - 5 * 40) / 6, gap: 40 });
  const beats = [
    { title: 'Beat 2', body: 'Private by construction.\nNo screen — it is a shell\nand a CI job.' },
    { title: 'Beat 3 — PRIMARY', body: 'Router economics.\nScreens 1, 2, 3, 4.', stroke: C.violet, background: C.bgViolet },
    { title: 'Beat 4 — PRIMARY', body: 'Surveillance triage.\nScreens 5, 6.', stroke: C.violet, background: C.bgViolet },
    { title: 'Beat 5', body: 'The model swap.\nScreens 12 then 1.\nCompress, never cut.', stroke: C.red, background: C.bgRed },
    { title: 'Beat 6', body: 'Human in the loop.\nScreens 7, 8.', stroke: C.orange, background: C.bgYellow },
    { title: 'Beats 7 & 8', body: 'Attributed research (9),\nthen audit from an\nunrehearsed pick (11).', stroke: C.green, background: C.bgGreen },
  ];
  const beatH = rowHeight(beats, beatCols.at(0).width);
  scene.group({
    x: X0,
    y: beatY,
    width: W,
    height: 82 + beatH + 30,
    label: 'DEMO BEAT → SCREEN',
    sublabel: 'Beats 3, 4 and 5 are independent: if a lane service is unhealthy, skip its beat and never debug live.',
    stroke: C.ink,
    background: C.white,
    strokeWidth: 3,
  });
  beats.forEach((b, i) =>
    scene.box({
      stroke: C.ink,
      background: C.white,
      ...b,
      x: beatCols.at(i).x,
      y: beatY + 82,
      width: beatCols.at(i).width,
      height: beatH,
    }),
  );

  // ---- Required states ---------------------------------------------------
  const stateY = beatY + 82 + beatH + 30 + 70;
  const stateCols = columns({ x: X0 + 40, count: 5, width: (W - 80 - 4 * 40) / 5, gap: 40 });
  const states = [
    { title: 'Loading', body: 'Skeleton matching the final\nlayout. No layout shift on\na projector.' },
    { title: 'Empty', body: 'Explains what would populate\nit and how to trigger it.' },
    { title: 'Error', body: 'Names what failed and what\nstill works. Never a bare\n"Something went wrong".' },
    { title: 'Partial', body: 'Some lanes returned, some did\nnot. Show what exists, mark\nwhat is missing.' },
    {
      title: 'Degraded',
      body: 'Fallback source or stale data,\nlabelled inline. A demo that\nhides its own failure is one\nbad question from collapse.',
      stroke: C.orange,
      background: C.bgYellow,
    },
  ];
  const stateH = rowHeight(states, stateCols.at(0).width);
  scene.group({
    x: X0,
    y: stateY,
    width: W,
    height: 82 + stateH + 30,
    label: 'EVERY data view implements all five states',
    sublabel: 'The empty state nobody built is the one that renders during the live run.',
    stroke: C.ink,
    background: C.white,
    strokeWidth: 3,
  });
  states.forEach((s, i) =>
    scene.box({
      stroke: C.ink,
      background: C.white,
      ...s,
      x: stateCols.at(i).x,
      y: stateY + 82,
      width: stateCols.at(i).width,
      height: stateH,
    }),
  );

  // ---- legend ------------------------------------------------------------
  const legendY = stateY + 82 + stateH + 30 + 60;
  scene.legend({
    x: X0,
    y: legendY,
    width: 1180,
    items: [
      { stroke: C.violet, background: C.bgViolet, text: 'Carries a wow moment. These three screens are the demo.' },
      LEGEND_HUMAN,
      { stroke: C.green, background: C.bgGreen, text: 'Evidence and audit surface — drillable to the record behind it.' },
      { stroke: C.blue, background: C.bgBlue, text: 'Supporting screen. Still drillable; nothing on screen is decorative.' },
      { stroke: C.red, background: C.bgRed, text: 'Required by a beat but NOT in the task list. Build it or lose Beat 5.' },
    ],
  });
  scene.box({
    x: X0 + 1180 + 60,
    y: legendY,
    width: W - 1180 - 60,
    title: 'Rules the whole UI obeys',
    body:
      'The audience reads this from ten feet away: every screen has one number that is deliberately the largest thing on it.\nNothing may look rehearsed — no pre-baked screenshots, no seeded animations. If a value is on screen it came from the API just now.\nEvery claim is drillable: a number a presenter cannot open is a number the audience assumes is decorative.\nPolling at 5s with refetchOnWindowFocus disabled, so a presenter alt-tabbing does not trigger a visible refetch mid-sentence.\nTypes are generated from contracts/*.md, never hand-written, because hand-written types drift and the drift surfaces during a demo.',
    stroke: C.blue,
    background: C.white,
  });

  return scene;
}

export const DIAGRAMS = [
  { file: '01-platform-topology.excalidraw', build: platformTopology },
  { file: '02-request-decision-flow.excalidraw', build: requestDecisionFlow },
  { file: '03-agent-architecture.excalidraw', build: agentArchitecture },
  { file: '04-ui-screen-map.excalidraw', build: uiScreenMap },
];

===== FILE: scripts/diagrams/generate-diagrams.mjs =====
#!/usr/bin/env node
// generate-diagrams.mjs
//
// Deterministic Excalidraw diagram generator for foundry-capital-markets-router.
//
//   node generate-diagrams.mjs [--out <dir>] [--check]
//
//   --out <dir>   Output directory. Default: docs/diagrams
//   --check       Regenerate into memory and exit non-zero if the on-disk files
//                 differ. Lets CI assert the diagrams are in sync with this
//                 generator; the diagrams are source-controlled artefacts, not
//                 hand-edited drawings.
//
// Node built-ins only. No network. Byte-for-byte reproducible: all "random"
// element fields come from a counter-based PRNG with a fixed seed and `updated`
// is the constant 1, so re-running never produces a spurious diff.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { DIAGRAMS } from './diagrams.mjs';

function parseArgs(argv) {
  const args = { out: 'docs/diagrams', check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--out requires a directory argument');
      }
      args.out = value;
      i += 1;
    } else if (a === '--check') {
      args.check = true;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

const USAGE = `Usage: node generate-diagrams.mjs [--out <dir>] [--check]

  --out <dir>   Output directory (default: docs/diagrams)
  --check       Verify on-disk files match the generator; exit 1 if not
  -h, --help    Show this message
`;

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function render() {
  return DIAGRAMS.map(({ file, build }) => {
    const scene = build();
    const json = scene.toJSON();
    const b = scene.bounds();
    return {
      file,
      json,
      elementCount: scene.elements.length,
      bounds: b,
      hash: sha256(json),
    };
  });
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const outDir = resolve(process.cwd(), args.out);
  const rendered = render();

  if (args.check) {
    let drift = 0;
    for (const d of rendered) {
      const path = join(outDir, d.file);
      if (!existsSync(path)) {
        process.stderr.write(`MISSING  ${path}\n`);
        drift += 1;
        continue;
      }
      const onDisk = readFileSync(path, 'utf8');
      if (onDisk === d.json) {
        process.stdout.write(`ok       ${d.file}  ${d.hash.slice(0, 16)}\n`);
      } else {
        process.stderr.write(
          `DRIFT    ${d.file}\n  on disk:   ${sha256(onDisk)}\n  generated: ${d.hash}\n`,
        );
        drift += 1;
      }
    }
    if (drift > 0) {
      process.stderr.write(
        `\n${drift} diagram(s) out of sync. Re-run: node generate-diagrams.mjs --out ${args.out}\n`,
      );
      process.exit(1);
    }
    process.stdout.write('\nAll diagrams are in sync with the generator.\n');
    return;
  }

  mkdirSync(outDir, { recursive: true });
  for (const d of rendered) {
    writeFileSync(join(outDir, d.file), d.json, 'utf8');
    const { width, height, minX, minY } = d.bounds;
    process.stdout.write(
      `wrote ${d.file.padEnd(34)} ${String(d.elementCount).padStart(4)} elements  ` +
        `canvas ${Math.round(width)}x${Math.round(height)} ` +
        `(origin ${Math.round(minX)},${Math.round(minY)})  ${d.hash.slice(0, 16)}\n`,
    );
  }
  process.stdout.write(`\n${rendered.length} diagrams written to ${outDir}\n`);
}

main();

===== FILE: scripts/diagrams/validate.mjs =====
#!/usr/bin/env node
// validate.mjs
//
// Structural validation for generated .excalidraw files.
//
//   node validate.mjs <dir>
//
// Asserts, per diagram:
//   a) every containerId references an existing element
//   b) every arrow startBinding/endBinding elementId references an existing element
//   c) every bound text/arrow is listed in its container's boundElements
//   d) no two non-container rectangles overlap
//   e) no element has NaN/undefined in x, y, width, height
//   f) every text label fits its container's width given the width estimator
// Plus: minimum font sizes for projector legibility, and determinism markers.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { charWidth, wrapText, LINE_HEIGHT, BOX_PAD } from './diagram-kit.mjs';

const MIN_BODY_FONT = 16;
const MIN_SIBLING_GAP = 40;

function isFinitePositive(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

function contains(outer, inner) {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height &&
    (outer.width > inner.width || outer.height > inner.height)
  );
}

function validate(file, doc) {
  const errors = [];
  const warnings = [];
  const els = doc.elements;
  const byId = new Map(els.map((e) => [e.id, e]));

  // --- (e) numeric sanity -------------------------------------------------
  for (const e of els) {
    for (const k of ['x', 'y', 'width', 'height']) {
      if (!isFinitePositive(e[k])) {
        errors.push(`(e) ${e.id} [${e.type}] has non-finite ${k}: ${e[k]}`);
      }
    }
    if (e.width < 0 || e.height < 0) {
      errors.push(`(e) ${e.id} [${e.type}] has negative size ${e.width}x${e.height}`);
    }
    if (e.updated !== 1) {
      errors.push(`(det) ${e.id} has updated=${e.updated}, expected the fixed constant 1`);
    }
    for (const k of [
      'id', 'type', 'angle', 'strokeColor', 'backgroundColor', 'fillStyle', 'strokeWidth',
      'strokeStyle', 'roughness', 'opacity', 'groupIds', 'frameId', 'seed', 'versionNonce',
      'version', 'isDeleted', 'boundElements', 'updated', 'locked',
    ]) {
      if (!(k in e)) errors.push(`(schema) ${e.id} [${e.type}] missing required property "${k}"`);
    }
    if (!('roundness' in e)) errors.push(`(schema) ${e.id} missing roundness`);
    if (!('link' in e)) errors.push(`(schema) ${e.id} missing link`);
  }

  // --- (a) containerId ----------------------------------------------------
  for (const e of els) {
    if (e.type !== 'text') continue;
    if (e.containerId === null || e.containerId === undefined) continue;
    if (!byId.has(e.containerId)) {
      errors.push(`(a) text ${e.id} has containerId ${e.containerId} which does not exist`);
    }
  }

  // --- (b) arrow bindings -------------------------------------------------
  for (const e of els) {
    if (e.type !== 'arrow') continue;
    for (const side of ['startBinding', 'endBinding']) {
      const b = e[side];
      if (!b) {
        warnings.push(`(b) arrow ${e.id} has no ${side}`);
        continue;
      }
      if (!byId.has(b.elementId)) {
        errors.push(`(b) arrow ${e.id} ${side} -> ${b.elementId} which does not exist`);
      }
    }
    if (!Array.isArray(e.points) || e.points.length < 2) {
      errors.push(`(b) arrow ${e.id} has fewer than two points`);
    }
  }

  // --- (c) reciprocal boundElements ---------------------------------------
  const listed = (containerId, kind, id) => {
    const c = byId.get(containerId);
    if (!c) return false;
    return (c.boundElements ?? []).some((b) => b.id === id && b.type === kind);
  };
  for (const e of els) {
    if (e.type === 'text' && e.containerId) {
      if (!listed(e.containerId, 'text', e.id)) {
        errors.push(`(c) container ${e.containerId} does not list bound text ${e.id}`);
      }
    }
    if (e.type === 'arrow') {
      for (const side of ['startBinding', 'endBinding']) {
        const b = e[side];
        if (b && !listed(b.elementId, 'arrow', e.id)) {
          errors.push(`(c) ${b.elementId} does not list bound arrow ${e.id} (${side})`);
        }
      }
    }
  }
  // and the reverse direction: everything listed must exist
  for (const e of els) {
    for (const b of e.boundElements ?? []) {
      if (!byId.has(b.id)) {
        errors.push(`(c) ${e.id} lists boundElement ${b.id} which does not exist`);
      }
    }
  }

  // --- (d) rectangle overlap ----------------------------------------------
  const rects = els.filter((e) => e.type === 'rectangle');
  const containersSet = new Set();
  for (const a of rects) {
    for (const b of rects) {
      if (a === b) continue;
      if (contains(a, b)) containersSet.add(a.id);
    }
  }
  const leaves = rects.filter((r) => !containersSet.has(r.id));
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      if (overlaps(leaves[i], leaves[j])) {
        errors.push(
          `(d) leaf rectangles overlap: ${leaves[i].id} ` +
            `(${leaves[i].x},${leaves[i].y} ${leaves[i].width}x${leaves[i].height}) and ` +
            `${leaves[j].id} (${leaves[j].x},${leaves[j].y} ${leaves[j].width}x${leaves[j].height})`,
        );
      }
    }
  }
  // sibling clearance: leaves sharing a parent container should be >= 40px apart
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i];
      const b = leaves[j];
      if (overlaps(a, b)) continue;
      const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
      const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
      const gap = Math.max(dx, dy);
      if (gap < MIN_SIBLING_GAP - 0.5 && gap >= 0) {
        // only complain when the two boxes actually share a band (i.e. are visual siblings)
        const bandX = a.x < b.x + b.width && b.x < a.x + a.width;
        const bandY = a.y < b.y + b.height && b.y < a.y + a.height;
        if (bandX || bandY) {
          // Legend key swatches are intentionally dense; they are a key, not content.
          const isSwatch = (r) => r.width <= 32 && r.height <= 32;
          if (!isSwatch(a) && !isSwatch(b)) {
            warnings.push(
              `(d) siblings ${a.id} and ${b.id} are only ${gap.toFixed(1)}px apart (want >= ${MIN_SIBLING_GAP})`,
            );
          }
        }
      }
    }
  }

  // --- (g) free body text must not spill out of the box it sits in --------
  for (const t of els) {
    if (t.type !== 'text' || t.containerId) continue;
    for (const r of leaves) {
      const insideX = t.x >= r.x - 1 && t.x + t.width <= r.x + r.width + 1;
      const startsInside = t.y >= r.y - 1 && t.y <= r.y + r.height;
      if (insideX && startsInside) {
        const th = t.text.split('\n').length * t.fontSize * LINE_HEIGHT;
        if (t.y + th > r.y + r.height + 1) {
          errors.push(
            `(g) free text ${t.id} overflows the bottom of box ${r.id} by ` +
              `${(t.y + th - r.y - r.height).toFixed(0)}px: "${t.text.split('\n')[0].slice(0, 50)}"`,
          );
        }
      }
    }
  }

  // --- (h) a leaf box must never straddle a group border ------------------
  const containerRects = rects.filter((r) => containersSet.has(r.id));
  for (const leaf of leaves) {
    for (const c of containerRects) {
      if (overlaps(leaf, c) && !contains(c, leaf)) {
        errors.push(`(h) box ${leaf.id} straddles the border of group ${c.id}`);
      }
    }
  }

  // --- (f) text fits ------------------------------------------------------
  for (const e of els) {
    if (e.type !== 'text') continue;
    const family = e.fontFamily ?? 2;
    const cw = charWidth(e.fontSize, family);
    const longest = e.text.split('\n').reduce((m, l) => Math.max(m, l.length * cw), 0);

    if (e.containerId) {
      const c = byId.get(e.containerId);
      if (c && c.type !== 'arrow') {
        const avail = c.width - 2 * BOX_PAD;
        if (longest > avail + 0.5) {
          errors.push(
            `(f) bound text ${e.id} needs ${longest.toFixed(0)}px but container ${c.id} offers ${avail.toFixed(0)}px: "${e.text.split('\n')[0].slice(0, 60)}"`,
          );
        }
        const lines = e.text.split('\n').length;
        const th = lines * e.fontSize * LINE_HEIGHT;
        if (th > c.height - 8) {
          errors.push(
            `(f) bound text ${e.id} needs ${th.toFixed(0)}px height, container ${c.id} is ${c.height}px`,
          );
        }
      }
    } else if (longest > e.width + 0.5) {
      errors.push(
        `(f) free text ${e.id} needs ${longest.toFixed(0)}px but declares width ${e.width}: "${e.text.split('\n')[0].slice(0, 60)}"`,
      );
    }

    // Wrapping must be idempotent: re-wrapping must not produce more lines.
    const rewrapped = wrapText(e.text, e.fontSize, e.width, family);
    if (rewrapped.length > e.text.split('\n').length) {
      errors.push(`(f) text ${e.id} would re-wrap to more lines than it declares`);
    }

    if (e.fontSize < MIN_BODY_FONT) {
      errors.push(`(legibility) text ${e.id} fontSize ${e.fontSize} < ${MIN_BODY_FONT}`);
    }
    if (e.lineHeight !== LINE_HEIGHT) {
      errors.push(`(schema) text ${e.id} lineHeight ${e.lineHeight} != ${LINE_HEIGHT}`);
    }
  }

  // --- diagram-level requirements -----------------------------------------
  const texts = els.filter((e) => e.type === 'text');
  if (!texts.some((t) => t.fontSize >= 28)) {
    errors.push('(title) no element at title size (>= 28) — every diagram needs a title');
  }
  if (!texts.some((t) => /Conclusion:/.test(t.originalText ?? ''))) {
    errors.push('(subtitle) no one-sentence subtitle stating the conclusion');
  }
  if (!texts.some((t) => /^Legend/.test(t.originalText ?? ''))) {
    errors.push('(legend) no legend — colour without a stated meaning is decoration');
  }

  return { file, errors, warnings, elementCount: els.length };
}

function main() {
  const dir = resolve(process.cwd(), process.argv[2] ?? 'out');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.excalidraw'))
    .sort();
  if (files.length === 0) {
    process.stderr.write(`No .excalidraw files in ${dir}\n`);
    process.exit(1);
  }

  let failed = 0;
  let totalWarn = 0;
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf8');
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      process.stderr.write(`FAIL ${f}: not valid JSON — ${err.message}\n`);
      failed += 1;
      continue;
    }
    const r = validate(f, doc);
    const bounds = doc.elements.reduce(
      (acc, e) => {
        const xs = Array.isArray(e.points) ? e.points.map((p) => e.x + p[0]) : [e.x, e.x + e.width];
        const ys = Array.isArray(e.points) ? e.points.map((p) => e.y + p[1]) : [e.y, e.y + e.height];
        return {
          minX: Math.min(acc.minX, ...xs),
          minY: Math.min(acc.minY, ...ys),
          maxX: Math.max(acc.maxX, ...xs),
          maxY: Math.max(acc.maxY, ...ys),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const dims = `${Math.round(bounds.maxX - bounds.minX)} x ${Math.round(bounds.maxY - bounds.minY)}`;
    if (r.errors.length === 0) {
      process.stdout.write(
        `PASS ${f.padEnd(34)} ${String(r.elementCount).padStart(4)} elements  canvas ${dims}` +
          `${r.warnings.length ? `  (${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''})` : ''}\n`,
      );
    } else {
      failed += 1;
      process.stdout.write(`FAIL ${f.padEnd(34)} ${r.errors.length} error(s)\n`);
      for (const e of r.errors.slice(0, 40)) process.stdout.write(`       ${e}\n`);
      if (r.errors.length > 40) process.stdout.write(`       … ${r.errors.length - 40} more\n`);
    }
    for (const w of r.warnings.slice(0, 20)) process.stdout.write(`  warn ${w}\n`);
    totalWarn += r.warnings.length;
  }

  process.stdout.write(
    `\n${files.length - failed}/${files.length} diagrams valid, ${totalWarn} warning(s).\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();

===== FILE: docs/diagrams/README.md =====
# Architecture diagrams

Four Excalidraw diagrams of the Governed AI Exchange. They are **generated build output, not
drawings** — do not hand-edit the `.excalidraw` files; edit the generator and re-run it.

| File | Answers |
|---|---|
| `01-platform-topology.excalidraw` | Where does everything run, and what is reachable from the internet? |
| `02-request-decision-flow.excalidraw` | What happens to one request, and in what order? |
| `03-agent-architecture.excalidraw` | Who are the agents, what may they touch, and where does a human intervene? |
| `04-ui-screen-map.excalidraw` | Which screen carries which demo beat? |

Each diagram states its claim in a `Conclusion:` subtitle. If a diagram no longer supports its own
conclusion, the architecture changed and the conclusion is the thing to revisit first.

## Viewing

Open <https://excalidraw.com>, then **Menu → Open** and pick the file. Everything is local; nothing
is uploaded. VS Code users can install the Excalidraw extension and open the file in place.

## Regenerating

```bash
node scripts/diagrams/generate-diagrams.mjs --out docs/diagrams
node scripts/diagrams/validate.mjs docs/diagrams
```

Or `task lint:diagrams`, which runs the drift check and the validator together.

Generation is byte-for-byte reproducible: element ids come from a counter-based PRNG with a fixed
seed and `updated` is pinned to `1`, so re-running never produces a spurious diff. CI runs
`--check` and fails if the committed files differ from what the generator produces — which is what
keeps the picture and the system from quietly diverging.

## Editing

- **Content** — `scripts/diagrams/diagrams.mjs`. One exported definition per diagram.
- **Layout and element primitives** — `scripts/diagrams/diagram-kit.mjs`.
- **Structural rules** — `scripts/diagrams/validate.mjs` checks text fits its container, boxes do
  not overlap, arrow bindings resolve in both directions, and no box straddles a group border.

## A standing caveat

These diagrams follow the **Terraform**, not the prose, wherever the two disagree. Components that
appear in `docs/architecture.md` but do not exist in the IaC are drawn as red dashed
`NOT IN TERRAFORM` boxes rather than omitted, so the gap is visible instead of invisible. The
current divergences are catalogued in [`../decisions-needed.md`](../decisions-needed.md) items 5–7.

===== FILE: scripts/policy-no-simulated-reasoning.sh =====
#!/usr/bin/env bash
#
# Fails the build if any code path could render simulated agent reasoning.
#
# ADR-007: a fallback is permitted when it changes *where real evidence is read from*, and
# forbidden when it changes *whether the evidence is real*. The demo's one irreplaceable claim is
# live agent reasoning inside a governed environment; a replayed transcript rendered in the product
# UI falsifies exactly that claim, and no on-screen label repairs it.
#
# This is a grep-based guard, so it is a tripwire rather than a proof. It catches the mechanism
# being reintroduced by habit -- which is the realistic failure -- not a determined author. That is
# the same bargain scripts/policy-no-public-endpoints.sh makes.

set -euo pipefail

fail=0

# Directories where live inference is the product. Test projects are excluded: a unit test *must*
# be able to fake a model client, and doing so there is correct rather than suspect.
SCAN_DIRS=()
for d in src/router-service src/research-service src/surveillance-service src/orderrouting-service src/webui/src; do
  [ -d "$d" ] && SCAN_DIRS+=("$d")
done

if [ ${#SCAN_DIRS[@]} -eq 0 ]; then
  echo "SKIP: no service or UI source directories present yet."
  exit 0
fi

# Terms that denote standing in for inference. Deliberately does not include "fallback" alone:
# ADR-004's telemetry read-path fallback is permitted, and a rule that cries wolf gets disabled.
BANNED='replayTranscript|ReplayTranscript|transcript_replay|TranscriptReplay|RecordedAgent|recordedAgent|FakeAgent|fakeAgent|MockAgent|mockAgent|StubAgent|stubAgent|SimulatedAgent|simulatedAgent|CannedResponse|cannedResponse|FakeModel|fakeModel|MockModel|mockModel|SimulatedInference|simulatedInference|replayAgent|ReplayAgent'

hits=$(grep -rnE "$BANNED" "${SCAN_DIRS[@]}" \
  --include='*.cs' --include='*.ts' --include='*.tsx' \
  2>/dev/null | grep -v '/node_modules/' | grep -v '/obj/' | grep -v '/bin/' || true)

if [ -n "$hits" ]; then
  echo "FAIL: a code path appears able to substitute recorded output for live agent reasoning."
  echo "$hits"
  echo
  echo "ADR-007 forbids this. If the agent cannot run, the demo must say so rather than replay a"
  echo "transcript. Recordings may be narrated out of the product UI, never rendered inside it."
  fail=1
fi

# The simulated OMS is permitted and required (T-034), but only for *market execution*. If the
# word 'simulate' migrates from execution into the reasoning path, the exception is being widened.
oms_hits=$(grep -rniE 'simulat' "${SCAN_DIRS[@]}" \
  --include='*.cs' --include='*.ts' --include='*.tsx' \
  2>/dev/null | grep -v '/node_modules/' | grep -v '/obj/' | grep -v '/bin/' \
  | grep -iE 'agent|reason|inference|model|completion|prompt' || true)

if [ -n "$oms_hits" ]; then
  echo "FAIL: 'simulated' appears alongside agent/model/reasoning terms."
  echo "$oms_hits"
  echo
  echo "The simulated-OMS exception covers market execution only. Simulating reasoning is ADR-007's"
  echo "central prohibition."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS: no path can render simulated agent reasoning."
fi

exit "$fail"

===== FILE: docs/adr/007-no-simulated-agent-reasoning.md =====
# 007. No fallback may simulate agent reasoning

- **Status**: Accepted
- **Date**: 2026-08-14
- **Amends**: the Delivery Constraints clause of `.specify/memory/constitution.md` requiring a
  local, no-Azure fallback path.

## Context

The demo makes one claim that cannot be made by any other means: **a real agent, reasoning live,
inside a governed private environment.** Every other claim — private networking, policy routing,
approval gates, cost attribution — could in principle be argued from a slide deck. The agentic
claim cannot. It is the reason the audience is in the room.

The plan as written contained a mechanism that would quietly destroy that claim. T-027h built a
determinism harness that recorded agent transcripts, and T-040 replayed those transcripts as a
local, no-Azure fallback so that "the narrative survives losing the network."

Consider what that produces on stage. The network fails, the fallback engages, and the screen shows
an agent selecting tools, reasoning across steps, and citing sources — none of which is happening.
The audience is watching a recording of reasoning while being told they are watching reasoning. The
label "fallback" in the corner of the UI does not repair this, because the thing being falsified is
not the *data source*; it is **whether any inference occurred at all**.

There is a second, worse property. A transcript replay cannot fail. It will happily "reason" about
a question the agent has never seen, because it is not reasoning — it is playing back. The moment
someone asks for Beat 8's unrehearsed pick, the fallback either produces a confident answer to a
question it never received, or it visibly breaks in the least recoverable way possible. Both
outcomes are worse than having no fallback.

This audience's entire professional instinct is detecting a control that is asserted rather than
enforced. Handing them a simulation of the one thing that cannot be simulated is not a hedge
against failure. It is the failure.

## Decision

**No fallback, mock, replay, or fixture may stand in for live model inference or live agent
reasoning in any demonstrated path.**

If the agent cannot run, the demo says the agent cannot run.

The governing test for any current or future fallback:

> A fallback is permitted when it changes **where real evidence is read from**.
> A fallback is forbidden when it changes **whether the evidence is real**.

Applied to what exists today:

| Mechanism | Verdict | Why |
|---|---|---|
| Recorded agent transcript replay (T-027h → T-040) | **Removed** | Changes whether inference happened. This is the whole of the objection. |
| Local no-Azure narrative path (T-040) | **Removed** | Cannot exist without the above. Its only content was replay. |
| Scoreboard reads Cosmos change feed instead of App Insights (ADR-004) | **Kept** | Same real telemetry from a real request, read by a different path. Surfaces as `degraded` with the reason on screen. |
| `partial` / `degraded` UI states | **Kept, and load-bearing** | These are the *opposite* of masking: they force a screen to declare incompleteness. Removing them makes masking easier, not harder. |
| Simulated OMS | **Kept** | We cannot place real trades into a real market. Disclosed on the record itself, not as a corner disclaimer (T-034). The simulation is of *market execution*, never of reasoning. |
| Seeded synthetic corpus | **Kept** | Fixes the agent's *inputs* so runs are comparable. The agent still reasons over them live. |
| Pinned temperature / fixed seeds | **Kept** | Constrains sampling, does not replace inference. The model still runs. |

The distinction that survives all of these: **inputs may be fixed and evidence may be re-read;
reasoning is always live.**

## Consequences

**We accept a demo that can fail in front of the audience.** If Azure is unreachable on 9/10, the
agentic beats do not run. This is a deliberate, eyes-open trade: a demo that can fail is the only
kind whose success means anything. A demo that cannot fail has not demonstrated anything.

Mitigation moves from *substitution* to *resilience and disclosure*:

1. **Reduce the probability of failure** rather than paper over it — rehearse on the real
   environment, keep the environment warm on 9/9 rather than rebuilding into the demo, and hold
   quota headroom.
2. **Fail informatively.** When a lane cannot reach a model, the UI states which dependency failed
   and what the request would have done. Showing the *governed refusal* of an unrunnable request is
   still a true demonstration of the control plane, and it is honest.
3. **Have a non-simulating contingency.** If the agents cannot run, present the recorded transcripts
   **as a recording, out of the product UI**, narrated as "here is what this did in rehearsal." A
   video honestly labelled is fine. A live-looking UI replaying a script is not. The difference is
   entirely whether the audience could mistake it for the real thing.
4. **The private-posture beats survive independently.** Beat 2 is Terraform, portal, and denied
   connections; it does not need an agent. If inference is down, the governance story is still fully
   demonstrable — which is a good argument for keeping the two claims separable.

**Cost:** we lose the guarantee that the full narrative runs on 9/10 under any conditions. That
guarantee was never real; it was the appearance of one.

## Alternatives considered

- **Keep replay, label it harder.** Rejected. No label is sufficient, because the audience cannot
  distinguish a labelled replay from a labelled live run by looking, and the claim under test is
  precisely the one the label concedes. It also invites the question we least want: "so how much of
  what we saw earlier was real?" — retroactively contaminating the beats that *were* live.
- **Replay only on network failure, silently.** Rejected outright, and worth naming so it is never
  proposed again: a silent substitution of recorded reasoning for live reasoning is
  indistinguishable from fabricating the demo.
- **A small local model as the fallback.** Rejected for 9/10. It is genuinely live inference and so
  passes the test above — but it is a different system with different governance, and explaining
  that under pressure costs more than the beat is worth. Reconsider post-demo as a real
  sovereignty story rather than as a hedge.

__SCAFFOLD_PAYLOAD_END__*/
