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
