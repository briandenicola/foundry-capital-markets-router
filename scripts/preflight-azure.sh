#!/usr/bin/env bash
set -euo pipefail

# Pre-flight for `terraform apply` on infrastructure/.
#
# Everything here answers one question: will the apply fail, and can we know that in ten seconds
# instead of forty minutes? Model deployments fail on region-specific facts -- a format string, a
# version, a quota ceiling -- and they fail late, after the account and network already exist.
# Managed compute is worse: it can run for the better part of an hour before telling you the
# accelerator was never available.
#
# This reads the catalog from infrastructure/variables.tf rather than restating it. A pre-flight
# that carries its own copy of the thing it validates will pass on the day the two disagree,
# which is the only day it matters.
#
# Read-only. Creates nothing, changes nothing, and needs no Terraform state or backend.
#
# Usage: scripts/preflight-azure.sh [region]

REGION="${1:-eastus2}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILURES=0
WARNINGS=0

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }
head2() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

fail() { red "  FAIL  $*"; FAILURES=$((FAILURES + 1)); }
warn() { yellow "  WARN  $*"; WARNINGS=$((WARNINGS + 1)); }
ok()   { green "  ok    $*"; }

for tool in az terraform jq; do
  command -v "$tool" >/dev/null 2>&1 || { red "$tool is required and was not found on PATH."; exit 2; }
done

head2 "Subscription"
if ! ACCOUNT=$(az account show -o json 2>/dev/null); then
  red "  Not logged in. Run: az login"
  exit 2
fi
echo "  $(jq -r '.name' <<<"$ACCOUNT")  ($(jq -r '.id' <<<"$ACCOUNT"))"
echo "  $(jq -r '.user.name' <<<"$ACCOUNT")"
echo "  region under test: ${REGION}"

# ---------------------------------------------------------------------------
# Resource providers. An unregistered provider fails the apply well after the
# resource group exists, and the message names an API, not a fix.
# ---------------------------------------------------------------------------
head2 "Resource providers"
REQUIRED_PROVIDERS=(
  Microsoft.CognitiveServices
  Microsoft.DocumentDB
  Microsoft.Search
  Microsoft.App
  Microsoft.KeyVault
  Microsoft.ContainerRegistry
  Microsoft.OperationalInsights
  Microsoft.Network
  Microsoft.ManagedIdentity
)
REGISTERED=$(az provider list --query "[].{ns:namespace, state:registrationState}" -o json)
for ns in "${REQUIRED_PROVIDERS[@]}"; do
  state=$(jq -r --arg ns "$ns" '.[] | select(.ns==$ns) | .state' <<<"$REGISTERED")
  case "$state" in
    Registered) ok "$ns" ;;
    "")         fail "$ns not visible on this subscription" ;;
    *)          fail "$ns is '$state'. Fix: az provider register --namespace $ns --wait" ;;
  esac
done

# ---------------------------------------------------------------------------
# The model catalog, read from the Terraform that will actually be applied.
# ---------------------------------------------------------------------------
head2 "Model catalog"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "${REPO_ROOT}/infrastructure/variables.tf" "$WORK/"
if ! (cd "$WORK" && terraform init -backend=false -input=false >/dev/null 2>&1); then
  red "  Could not read the catalog: terraform init failed in an isolated copy of variables.tf."
  exit 2
fi
CATALOG=$(cd "$WORK" && echo 'jsonencode(var.model_catalog)' | terraform console 2>/dev/null | head -1 | jq -r 'fromjson? // .' | jq -c '.' 2>/dev/null || true)
if [[ -z "$CATALOG" || "$CATALOG" == "null" ]]; then
  red "  Could not parse var.model_catalog from infrastructure/variables.tf."
  exit 2
fi
echo "  $(jq -r 'length' <<<"$CATALOG") entries declared"

DEPLOY_CAPACITY=$(cd "$WORK" && echo 'var.model_deployment_capacity' | terraform console 2>/dev/null | head -1 | tr -d '"' || echo 1)
[[ "$DEPLOY_CAPACITY" =~ ^[0-9]+$ ]] || DEPLOY_CAPACITY=1

AVAILABLE=$(az cognitiveservices model list -l "$REGION" -o json 2>/dev/null || echo '[]')
if [[ "$(jq -r 'length' <<<"$AVAILABLE")" == "0" ]]; then
  fail "No models returned for region '${REGION}'. Is the region name right, and does the subscription have Foundry access there?"
fi

head2 "Serverless deployments (region: ${REGION})"
while IFS=$'\t' read -r key name fmt ver approved; do
  [[ -z "$key" ]] && continue
  if [[ "$approved" != "true" ]]; then
    ok "$key — not approved, deliberately not deployed"
    continue
  fi
  if [[ "$fmt" == "null" || "$ver" == "null" ]]; then
    fail "$key ($name) is missing format or model_version"
    continue
  fi

  match=$(jq -r --arg n "$name" '[.[] | select(.model.name==$n)]' <<<"$AVAILABLE")
  if [[ "$(jq -r 'length' <<<"$match")" == "0" ]]; then
    fail "$key — model '$name' is not offered in ${REGION}"
    continue
  fi

  actual_fmt=$(jq -r '.[0].model.format' <<<"$match")
  if [[ "$actual_fmt" != "$fmt" ]]; then
    fail "$key — format is '$fmt', region says '$actual_fmt'"
    continue
  fi

  if ! jq -e --arg v "$ver" '[.[] | select(.model.version==$v)] | length > 0' <<<"$match" >/dev/null; then
    offered=$(jq -r '[.[].model.version] | unique | join(", ")' <<<"$match")
    fail "$key — version '$ver' not offered. ${REGION} has: ${offered}"
    continue
  fi

  if ! jq -e --arg v "$ver" '[.[] | select(.model.version==$v) | .model.skus[]?.name] | index("GlobalStandard")' <<<"$match" >/dev/null; then
    skus=$(jq -r --arg v "$ver" '[.[] | select(.model.version==$v) | .model.skus[]?.name] | unique | join(", ")' <<<"$match")
    fail "$key — GlobalStandard not available for '$name' v$ver. Offered: ${skus:-none}"
    continue
  fi

  ok "$key — $name ($fmt, v$ver, GlobalStandard)"
done < <(jq -r 'to_entries[] | select(.value.serving=="serverless")
        | [.key, .value.model_name, (.value.format//"null"), (.value.model_version//"null"), (.value.approved|tostring)]
        | @tsv' <<<"$CATALOG")

# ---------------------------------------------------------------------------
# Vendor spread. A single-vendor estate cannot demonstrate the one thing this
# demo exists to demonstrate, and it fails silently -- everything still routes.
# ---------------------------------------------------------------------------
head2 "Vendor spread"
VENDORS=$(jq -r '[.[] | select(.serving=="serverless" and .approved) | .vendor] | unique' <<<"$CATALOG")
COUNT=$(jq -r 'length' <<<"$VENDORS")
if [[ "$COUNT" -lt 2 ]]; then
  fail "Only ${COUNT} approved vendor(s): $(jq -r 'join(", ")' <<<"$VENDORS"). 'Policy chooses the vendor' is unprovable with one."
else
  ok "${COUNT} vendors: $(jq -r 'join(", ")' <<<"$VENDORS")"
fi

# ---------------------------------------------------------------------------
# Managed compute. Preview, slow, and the most expensive thing to get wrong.
# ---------------------------------------------------------------------------
head2 "Managed compute (preview)"
MC=$(jq -c '[to_entries[] | select(.value.serving=="managed_compute")]' <<<"$CATALOG")
if [[ "$(jq -r 'length' <<<"$MC")" == "0" ]]; then
  ok "none declared"
else
  jq -r '.[] | "  declared: \(.key) — \(.value.model_name) on \(.value.accelerator // "?")"' <<<"$MC"
  warn "Accelerator capacity comes from Foundry's GlobalManagedCompute pool and is not visible"
  warn "to 'az vm list-usage'. It cannot be verified from here, provisioning takes up to an hour,"
  warn "and it fails late. Provision it first and on its own, or set enable_managed_compute=false"
  warn "to bring the estate up on the three serverless vendors while it is sorted out."
fi

# ---------------------------------------------------------------------------
head2 "Quota"
# Quota is per model, per SKU, and the entry is namespaced by service rather than by vendor --
# OpenAI models sit under OpenAI.*, Anthropic and xAI both under AIServices.*. Matching on the
# suffix avoids encoding that mapping here, where it would rot.
USAGE=$(az cognitiveservices usage list -l "$REGION" -o json 2>/dev/null || echo '[]')
if [[ "$(jq -r 'length' <<<"$USAGE")" == "0" ]]; then
  warn "No usage data returned for ${REGION}; quota could not be checked."
else
  NEEDED=$(jq -r 'to_entries[] | select(.value.serving=="serverless" and .value.approved) | .value.model_name' <<<"$CATALOG")
  while read -r m; do
    [[ -z "$m" ]] && continue
    row=$(jq -c --arg m "$m" '[.[] | select((.limit//0)>0) | select(.name.value|endswith("."+$m))] | .[0] // empty' <<<"$USAGE")
    if [[ -z "$row" ]]; then
      warn "$m — no quota entry in ${REGION}; the deployment may be refused"
      continue
    fi
    cur=$(jq -r '.currentValue // 0' <<<"$row")
    lim=$(jq -r '.limit' <<<"$row")
    nm=$(jq -r '.name.value' <<<"$row")
    if (( $(echo "$lim - $cur < $DEPLOY_CAPACITY" | bc -l) )); then
      fail "$m — ${cur}/${lim} used, needs ${DEPLOY_CAPACITY}. Raise quota or lower model_deployment_capacity."
    else
      ok "$m — ${cur}/${lim} (${nm})"
    fi
  done <<<"$NEEDED"
fi

# ---------------------------------------------------------------------------
head2 "Result"
if [[ "$FAILURES" -gt 0 ]]; then
  red "${FAILURES} blocking issue(s), ${WARNINGS} warning(s). Fix the failures before terraform apply."
  exit 1
fi
green "No blocking issues. ${WARNINGS} warning(s)."
echo
echo "Next:"
echo "  task cloud:up"
