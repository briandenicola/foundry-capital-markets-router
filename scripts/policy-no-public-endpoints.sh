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

for stack in "${STACKS[@]}"; do
  [ -d "$stack" ] || continue

  for pattern in "$banned_pattern" "$banned_pattern3" "$banned_pattern4"; do
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
