#!/usr/bin/env bash
#
# Fails if the emulator provisioner and Terraform disagree about the Cosmos containers.
#
# tools/Fcmr.CosmosProvision creates containers locally because Terraform cannot reach the
# emulator. That duplication is unavoidable, and duplicated truth drifts: a container added to
# infrastructure/cosmos.tf and forgotten here would let the persistence suite pass green against a
# database shape that does not exist in Azure, and the failure would first appear on the deployed
# environment.
#
# So the duplication is allowed and checked. Name and partition key path must match exactly.

set -euo pipefail

cd "$(dirname "$0")/.."

TF_FILE=infrastructure/cosmos.tf
PROVISIONER=tools/Fcmr.CosmosProvision/Program.cs

for f in "$TF_FILE" "$PROVISIONER"; do
  if [ ! -f "$f" ]; then
    echo "FAIL: $f not found." >&2
    exit 1
  fi
done

# Terraform: the cosmos_containers map, "name = /partitionKey" pairs.
terraform_pairs=$(
  sed -n '/cosmos_containers = {/,/^  }/p' "$TF_FILE" \
    | grep -oE '[A-Za-z]+[[:space:]]*=[[:space:]]*"/[A-Za-z]+"' \
    | tr -d ' "' \
    | tr '=' ' ' \
    | sort
)

# Provisioner: the Containers tuple array, ("name", "/partitionKey").
provisioner_pairs=$(
  sed -n '/Containers =$/,/\];/p' "$PROVISIONER" \
    | grep -oE '\("[A-Za-z]+",[[:space:]]*"/[A-Za-z]+"\)' \
    | tr -d '() "' \
    | tr ',' ' ' \
    | sort
)

if [ -z "$terraform_pairs" ] || [ -z "$provisioner_pairs" ]; then
  echo "FAIL: could not extract container definitions from one or both sources." >&2
  echo "      This guard is worthless if it silently matches two empty lists, so it fails instead." >&2
  exit 1
fi

if [ "$terraform_pairs" != "$provisioner_pairs" ]; then
  echo "FAIL: Cosmos container definitions differ between Terraform and the emulator provisioner." >&2
  echo >&2
  echo "  $TF_FILE:" >&2
  echo "$terraform_pairs" | sed 's/^/    /' >&2
  echo >&2
  echo "  $PROVISIONER:" >&2
  echo "$provisioner_pairs" | sed 's/^/    /' >&2
  echo >&2
  echo "Local tests would run against a database shape that does not exist in Azure." >&2
  exit 1
fi

count=$(echo "$terraform_pairs" | wc -l | tr -d ' ')
echo "PASS: all $count Cosmos containers match between Terraform and the emulator provisioner."
