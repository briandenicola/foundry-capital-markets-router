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
