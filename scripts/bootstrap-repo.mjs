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

import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
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
  const restored = text.split(GLOBSTAR_TOKEN).join('**');
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

===== FILE: .dockerignore =====
@@GLOBSTAR@@/bin
@@GLOBSTAR@@/obj
@@GLOBSTAR@@/node_modules
@@GLOBSTAR@@/dist
@@GLOBSTAR@@/.terraform
@@GLOBSTAR@@/.git
@@GLOBSTAR@@/.github
@@GLOBSTAR@@/TestResults
@@GLOBSTAR@@/coverage
@@GLOBSTAR@@/test-results
@@GLOBSTAR@@/playwright-report
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
    desc: Run unit, contract, and integration tests
    cmds:
      - task: unit
      - task: contract

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
      - task: preview-sdk-pins
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
    <Project Path="src/Fcmr.Router.Decisions/Fcmr.Router.Decisions.csproj" />
    <Project Path="src/router-service/router-service.csproj" />
  </Folder>
  <Folder Name="/tests/">
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

## Delivery Constraints

- Build complete by 2026-09-05. Demo delivered 2026-09-10. Feature work stops on 9/5; the period
  from 9/5 to 9/10 is rehearsal, hardening, and fallback preparation only.
- The full environment must stand up from zero via `task cloud:up` and tear down via
  `task cloud:down`, unattended, in under 45 minutes.
- A local, no-Azure fallback path must exist and be rehearsed, in case cloud access fails on the
  day. The fallback is explicitly labelled as such in the UI and never presented as the
  private-posture proof.

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
- Local fallback path runs the full narrative without Azure.

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
- **T-012** Complexity scoring: pure, deterministic, exhaustively unit-tested. This is the
  coverage-gated assembly.
- **T-013** Tier selection and cost ceiling enforcement, including the downgrade-versus-deny
  branch.
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

- **T-021** Synthetic data generators: research corpus, e-comms, order flow, blotters. Seeded and
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
  - **T-027h** Determinism harness: fixed seeds, pinned temperature, recorded transcripts. Feeds the
    no-Azure fallback in T-040.

## Phase 5 — Scoreboard UI (day 12 to 17)

Twelve screens; see `docs/ui-design.md` for the inventory, component layout, and required states.
Three of the four wow moments are screens in this phase.

- **T-028** Vite, React, and TypeScript shell; Entra authentication; role-aware navigation.
  - **T-028a** App shell, routing, error boundary, and the projector-grade type scale. Every screen
    has one number that is deliberately the largest thing on it.
  - **T-028b** MSAL auth, `Router.Invoke` / `Router.Read` / `Approver` role guards. Unauthorised
    navigation is hidden; unauthorised *actions* render disabled with a stated reason — Beat 6
    needs something visible to refuse.
  - **T-028c** API client, token acquisition, and **types generated from `contracts/`**. Not
    hand-written; hand-written types drift and the drift surfaces on stage.
  - **T-028d** The five required states as shared primitives: loading, empty, error, partial,
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
- **T-040** Local no-Azure fallback path, rehearsed end to end.
- **T-041** Demo runbook: narrative beats, timings, failure recovery, seeded fixtures.

## 9/5 to 9/10 — Freeze

No feature work. Rehearsal, fallback drills, and bug fixes only.

===== FILE: specs/002-governed-exchange/spec.md =====
# Feature 002 — Governed AI Exchange

- Status: Draft
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

## Open questions

1. Where do policy sets live — Cosmos, App Configuration, or a Terraform-managed file? Cosmos
   gives the fastest hot-swap and an audit trail via change feed; Terraform gives review-gated
   change. The demo wants the former; a bank would want the latter. Possibly both, with Cosmos as
   the runtime cache.
2. Does intent classification use a model, and if so, which one routes *it*? There is an obvious
   recursion here. The pragmatic answer is a fixed cheap deployment outside the exchange, declared
   explicitly as infrastructure rather than pretending it is routed.
3. Is Feature 002 in scope for 9/10, or does the demo show the policy gate (already implemented in
   `PolicyGate`) without full task decomposition? See `docs/decisions-needed.md` item 3.
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
| 9/9 | Rehearse the fallback path. Rebuild the environment fresh. Seed data. |
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

Now open the policy set and **disable Anthropic**. Change nothing else. No redeploy, no code
change, no prompt change. Resubmit the identical request.

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
| Foundry throttling | Fall back to the seeded pre-recorded batch. Say plainly that it is pre-recorded. |
| Azure access fails entirely | Run the local fallback. Label it as the fallback. Do not present Beat 2 from it — the private-posture claim cannot be made from a local environment. |
| A question you cannot answer | Say so and write it down. This audience trusts an admission far more than a confident guess. |

## Do not

- Do not present the local fallback as evidence of the private posture.
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

**Determinism for rehearsal.** Fixed seeds, pinned temperature, recorded fixtures. T-040's
no-Azure fallback replays recorded agent transcripts, so the narrative survives losing the network.

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

REPORT=$(find "$RESULTS_DIR" -name 'coverage.cobertura.xml' -print -quit 2>/dev/null || true)

if [ -z "$REPORT" ]; then
  echo "FAIL: no coverage report found under ${RESULTS_DIR}."
  echo "Run: dotnet test --collect:\"XPlat Code Coverage\" --results-directory ${RESULTS_DIR}"
  exit 1
fi

RATE=$(python3 - "$REPORT" "$ASSEMBLY" <<'PY'
import sys, xml.etree.ElementTree as ET
report, assembly = sys.argv[1], sys.argv[2]
root = ET.parse(report).getroot()
covered = valid = 0
for pkg in root.iter('package'):
    if assembly.lower() not in (pkg.get('name') or '').lower():
        continue
    for line in pkg.iter('line'):
        valid += 1
        if int(line.get('hits', '0')) > 0:
            covered += 1
print(round(100.0 * covered / valid, 2) if valid else -1.0)
PY
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
/// Selects a model tier from a complexity score and an enforced cost ceiling.
///
/// The ceiling is a control, not a report. When the indicated tier exceeds it, the selector
/// downgrades to the most capable affordable tier, and denies only when nothing is affordable.
/// A denial is returned to the caller and surfaced in the UI; it is never silently absorbed.
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
        var available = pricing.Where(p => p.Available).OrderBy(p => p.Tier).ToList();

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
                $"Cheapest available tier {cheapest.Tier} projects {cheapest.CostPerRequestUsd:0.###} USD " +
                $"against a ceiling of {costCeilingUsd:0.###} USD.");
        }

        // Prefer the indicated tier. If it is unaffordable or unavailable, take the most capable
        // tier that is both.
        var chosen = affordable.FirstOrDefault(p => p.Tier == indicated)
                     ?? affordable.MaxBy(p => p.Tier)!;

        var downgraded = chosen.Tier < indicated;

        var rationale = downgraded
            ? $"Complexity {complexityScore:0.##} indicated {indicated}, but its projected cost exceeds the " +
              $"{costCeilingUsd:0.###} USD ceiling. Downgraded to {chosen.Tier} at " +
              $"{chosen.CostPerRequestUsd:0.###} USD."
            : $"Complexity {complexityScore:0.##} indicated {chosen.Tier}, projected at " +
              $"{chosen.CostPerRequestUsd:0.###} USD within the {costCeilingUsd:0.###} USD ceiling.";

        return new RoutingDecision
        {
            ComplexityScore = complexityScore,
            CostCeilingUsd = costCeilingUsd,
            Outcome = downgraded ? RoutingOutcome.Downgraded : RoutingOutcome.Routed,
            SelectedTier = chosen.Tier,
            SelectedDeployment = chosen.Deployment,
            CandidateTiers = BuildCandidates(pricing, chosen, costCeilingUsd, indicated),
            Rationale = rationale,
        };
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

        foreach (var p in pricing.OrderBy(p => p.Tier))
        {
            var selected = chosen is not null && p.Tier == chosen.Tier;

            string? reason = null;
            if (!selected)
            {
                if (!p.Available)
                {
                    reason = "Tier unavailable.";
                }
                else if (p.CostPerRequestUsd > ceiling)
                {
                    reason = $"Projected {p.CostPerRequestUsd:0.###} USD exceeds the {ceiling:0.###} USD ceiling.";
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
/// </summary>
public sealed record PolicySet
{
    public required string Name { get; init; }

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
}

/// <summary>Why a candidate was excluded, in language safe to show a governance audience.</summary>
public sealed record PolicyExclusion
{
    public required string Deployment { get; init; }
    public required ModelVendor Vendor { get; init; }
    public required string Reason { get; init; }
}

public sealed record PolicyEvaluation
{
    public required IReadOnlyList<TierPricing> Eligible { get; init; }
    public required IReadOnlyList<PolicyExclusion> Excluded { get; init; }
    public required string PolicySetName { get; init; }

    /// <summary>True when policy left nothing to route to. The request is refused, not downgraded.</summary>
    public bool NoEligibleModels => Eligible.Count == 0;
}

/// <summary>
/// Filters the model catalog by governance policy, before cost and complexity selection runs.
///
/// Order matters and is deliberate: policy decides what is <em>permissible</em>, then the router
/// decides what is <em>appropriate</em> among the permissible. Running these the other way round
/// would let a cost optimisation reach for a model governance has not approved, which is exactly
/// the failure mode the exchange exists to prevent.
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
                    Reason = $"Execution region '{executionRegion}' is not permitted by policy set '{policy.Name}'.",
                });
            }

            return new PolicyEvaluation
            {
                Eligible = eligible,
                Excluded = excluded,
                PolicySetName = policy.Name,
            };
        }

        foreach (var candidate in catalog)
        {
            if (!policy.ApprovedVendors.Contains(candidate.Vendor))
            {
                excluded.Add(new PolicyExclusion
                {
                    Deployment = candidate.Deployment,
                    Vendor = candidate.Vendor,
                    Reason = $"Vendor {candidate.Vendor} is not approved under policy set '{policy.Name}'.",
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
                    Reason = $"Projected {candidate.CostPerRequestUsd:0.###} USD exceeds the policy ceiling of {policy.MaxCostPerRequestUsd:0.###} USD.",
                });
                continue;
            }

            eligible.Add(candidate);
        }

        return new PolicyEvaluation
        {
            Eligible = eligible,
            Excluded = excluded,
            PolicySetName = policy.Name,
        };
    }
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
    "test": "vitest run"
  },
  "dependencies": {
    "@azure/msal-browser": "^3.28.1",
    "@azure/msal-react": "^2.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "eslint": "^9.17.0",
    "typescript": "^5.7.2",
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
        Name = "CapitalMarkets-US",
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
    public void Evaluate_ComposesWithTierSelector_SoPolicyDecidesBeforeCost()
    {
        // Policy decides what is permissible; the router decides what is appropriate among the
        // permissible. Reversing the order would let a cost optimisation reach an unapproved model.
        var policy = CapitalMarkets(ModelVendor.AzureOpenAI, ModelVendor.OpenWeight);

        var evaluation = PolicyGate.Evaluate(Catalog(), policy, DataClassification.Internal);
        var decision = TierSelector.Select(0.50, 1.00m, evaluation.Eligible);

        decision.Outcome.Should().NotBe(RoutingOutcome.Denied);
        evaluation.Eligible.Should().OnlyContain(c =>
            c.Vendor == ModelVendor.AzureOpenAI || c.Vendor == ModelVendor.OpenWeight);
    }
}
__SCAFFOLD_PAYLOAD_END__*/
