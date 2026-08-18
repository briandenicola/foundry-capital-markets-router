#!/usr/bin/env bash
#
# Fails if any role assignment is granted at subscription, resource-group, or management-group
# scope.
#
# Principle VII (Least Privilege) is easy to satisfy on the day it is written and easy to lose
# afterwards, because the quickest way to fix a 403 is to widen the scope one level. A grant that
# names one registry is a statement about what a service may do; the same grant at resource-group
# scope silently covers every resource that group ever acquires, including ones that do not exist
# yet. Nothing about the deployment looks different, and the difference only surfaces in an audit.
#
# So the narrow scope is checked rather than remembered. Every role assignment must name a
# specific resource. New assignments that this script does not recognise fail closed and require
# either a narrower scope or an explicit, argued exception here.

set -euo pipefail

cd "$(dirname "$0")/.."

STACKS=("infrastructure" "apps")
FAILED=0
FOUND=0

# Scope expressions that grant across a container of resources rather than one resource.
broad_scopes='azurerm_subscription|data\.azurerm_subscription|azurerm_resource_group|azurerm_management_group|local\.subscription|var\.subscription|"/subscriptions/[^/]*"'

for stack in "${STACKS[@]}"; do
  [ -d "$stack" ] || continue

  while IFS= read -r file; do
    # Emit "file:line:scope-expression" for every role assignment block in the file. Blocks are
    # delimited by a closing brace in column zero, which is how terraform fmt writes them.
    while IFS= read -r entry; do
      FOUND=$((FOUND + 1))
      location="${entry%%|*}"
      scope="${entry#*|}"

      if [ "$scope" = "__MISSING__" ]; then
        echo "FAIL: role assignment at ${location} declares no scope"
        FAILED=1
        continue
      fi

      if echo "$scope" | grep -qE "$broad_scopes"; then
        echo "FAIL: role assignment at ${location} is scoped above a single resource"
        echo "      scope = ${scope}"
        FAILED=1
        continue
      fi

      # Fail closed. A scope that names neither a resource id nor a Cosmos sub-resource path is
      # something this check has not seen before, and unreviewed breadth is the failure mode.
      # A resource id reference (.id or a *_id output carrying one) or a Cosmos sub-resource path.
      # Ids that name a subscription or resource group are already rejected above.
      if ! echo "$scope" | grep -qE '\.id$|_id$|/colls/|/dbs/'; then
        echo "FAIL: role assignment at ${location} has an unrecognised scope expression"
        echo "      scope = ${scope}"
        echo "      Narrow it to a specific resource, or extend this check with the reason."
        FAILED=1
      fi
    done < <(awk '
      /^resource[[:space:]]+"[a-z_]*role_assignment"/ {
        inblock = 1; start = FNR; scope = "__MISSING__"; next
      }
      inblock && /^[[:space:]]*scope[[:space:]]*=/ {
        line = $0
        sub(/^[[:space:]]*scope[[:space:]]*=[[:space:]]*/, "", line)
        scope = line
      }
      inblock && /^}/ {
        printf "%s:%d|%s\n", FILENAME, start, scope
        inblock = 0
      }
    ' "$file")
  done < <(find "$stack" -name '*.tf' -type f | sort)
done

if [ "$FOUND" -eq 0 ]; then
  echo "FAIL: no role assignments found at all."
  echo "Either the stacks stopped granting access, or this check stopped being able to see them."
  echo "A policy script that passes because it matches nothing is worse than no script."
  exit 1
fi

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "Principle VII (Least Privilege): grants name one resource, never a container of them."
  echo "See .specify/memory/constitution.md and docs/threat-model.md."
  exit 1
fi

echo "PASS: all ${FOUND} role assignments are scoped to a single resource."
