#!/usr/bin/env bash
#
# Creates the fcmr database and containers in the local Cosmos emulator.
#
# A thin wrapper over tools/Fcmr.CosmosProvision. The provisioning itself is C# because it needs
# the Cosmos SDK -- the REST API requires HMAC request signing, and hand-rolling that in bash to
# avoid a project would be a worse trade than the project.

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${1:-8081}"
DATABASE="${2:-fcmr}"
KEY_FILE="${3:-.local/cosmos-emulator.key}"

if [ -z "${COSMOS_EMULATOR_KEY:-}" ]; then
  if [ -s "$KEY_FILE" ]; then
    COSMOS_EMULATOR_KEY="$(cat "$KEY_FILE")"
    export COSMOS_EMULATOR_KEY
  else
    echo "FAIL: no emulator key. Run 'task cosmos:up', which generates one into $KEY_FILE." >&2
    exit 1
  fi
fi

exec dotnet run --project tools/Fcmr.CosmosProvision -- "https://localhost:${PORT}/" "$DATABASE"
