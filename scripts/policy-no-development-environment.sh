#!/usr/bin/env bash
#
# Fails the build if any deployment artefact declares the ASP.NET Core Development environment.
#
# router-service honours Router:Authorization:Enabled=false only when the host reports the
# Development environment, which switches off UseAuthentication, UseAuthorization and the
# Router.Invoke endpoint filter in one move. That affordance is legitimate on a developer's
# machine and is a full authentication bypass anywhere else.
#
# The affordance was justified by analogy to enable_private_networking. That analogy only holds
# if it is enforced the way enable_private_networking is enforced -- by a job that fails the
# build -- rather than merely asserted in a code comment. This is that job.
#
# It is one of two controls. The other is a startup-time guard in Security/RouterAuthorization.cs
# which refuses to start unauthenticated on a host that is demonstrably not a workstation. This
# script gives the PR-time signal; the guard closes the portal and CLI paths that never see a PR.
#
# Grep-based, so it is a tripwire rather than a proof, on the same terms as
# scripts/policy-no-public-endpoints.sh.

set -euo pipefail

FAILED=0

# Deployment artefacts only. Local development files are the point of the affordance:
# src/router-service/appsettings.Development.json is loaded solely when a developer selects that
# environment, and banning it there would ban the thing being permitted.
SCAN_TARGETS=()
for path in apps infrastructure .github/workflows; do
  [ -e "$path" ] && SCAN_TARGETS+=("$path")
done
[ -d src ] && SCAN_TARGETS+=("src")

if [ ${#SCAN_TARGETS[@]} -eq 0 ]; then
  echo "SKIP: no deployment stacks present yet."
  exit 0
fi

# Candidate artefacts. src/ is included only for container definitions -- appsettings.Development.json
# is the affordance being permitted, so scanning application config there would ban the thing the
# exception exists for.
FILES=$(find "${SCAN_TARGETS[@]}" \
  \( -path '*/node_modules' -o -path '*/.terraform' -o -path '*/bin' -o -path '*/obj' \) -prune -o \
  -type f \( -name '*.tf' -o -name '*.tfvars' -o -name '*.yml' -o -name '*.yaml' \
             -o -name 'Dockerfile*' -o -name '*.env' -o -name 'compose*.y*ml' \) -print \
  | grep -v '^src/' || true)
DOCKERFILES=$(find src -type f -name 'Dockerfile*' 2>/dev/null || true)
FILES=$(printf '%s\n%s\n' "$FILES" "$DOCKERFILES" | grep -v '^$' | sort -u || true)

# A Terraform env block spells the name and the value on separate lines:
#
#   env {
#     name  = "ASPNETCORE_ENVIRONMENT"
#     value = "Development"
#   }
#
# A line-at-a-time grep cannot see that, and that block is precisely the one-line-of-HCL bypass
# this script exists to catch. So the scan is windowed: a trigger match arms a short lookahead,
# and a value match anywhere inside the window is a hit. The window also covers the same line, so
# single-line spellings (Dockerfile ENV, workflow env:, .env, -e flags) are caught by the same pass.
WINDOW=4

scan() {
  local label="$1" trigger="$2" value="$3" found=0 out
  [ -z "$FILES" ] && return 0

  out=$(printf '%s\n' "$FILES" | while IFS= read -r file; do
    [ -f "$file" ] || continue
    awk -v file="$file" -v trigger="$trigger" -v value="$value" -v window="$WINDOW" '
      {
        line = tolower($0)
        if (line ~ trigger) { armed = window; armed_line = NR; armed_text = $0 }
        if (armed > 0) {
          if (line ~ value) {
            printf "%s:%d: %s\n", file, armed_line, trim(armed_text)
            if (NR != armed_line) printf "%s:%d: %s\n", file, NR, trim($0)
            armed = 0
            next
          }
          armed--
        }
      }
      function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    ' "$file"
  done)

  if [ -n "$out" ]; then
    echo "FAIL: $label"
    echo "$out"
    found=1
  fi
  return $found
}

# Regexes are matched against a lowercased line, so they are written lowercase.
if ! scan "a deployment artefact sets the ASP.NET environment to Development." \
  '(aspnetcore|dotnet)_environment' \
  'development'; then
  FAILED=1
fi

# The same bypass reached by the other lever: pinning the flag off in deployed configuration.
# Harmless while the environment is not Development, and exactly half of a two-step bypass.
if ! scan "a deployment artefact disables Router.Invoke app-role enforcement." \
  'router(__|:)authorization(__|:)enabled' \
  'false'; then
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "The Development environment disables Router.Invoke enforcement in router-service."
  echo "Principle IV makes the router the sole path to a model; an unauthenticated router is that"
  echo "path standing open. Realism Checklist item 2 requires app roles to gate the action, and"
  echo "requires an unprivileged identity to be shown being denied, live."
  echo "See .specify/memory/constitution.md and src/router-service/Security/RouterAuthorization.cs."
  exit 1
fi

echo "PASS: no deployment artefact selects the Development environment or disables app-role enforcement."
