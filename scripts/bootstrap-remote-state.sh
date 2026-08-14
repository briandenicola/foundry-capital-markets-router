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
