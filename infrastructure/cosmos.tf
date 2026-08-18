resource "azurerm_cosmosdb_account" "this" {
  name                = "${local.resource_name}-cosmos"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  public_network_access_enabled     = false
  is_virtual_network_filter_enabled = true

  # Keys are off. This is the control that makes "managed identity only" true from the account's
  # side rather than only in client code: a key presented to this account is rejected regardless of
  # what any service believes it is doing.
  local_authentication_enabled = false

  # CKV_AZURE_132. Blocks writes to key metadata, including regeneration. With local authentication
  # already off the keys are inert, but a management-plane path that can rotate them is a path that
  # can be used to notice they exist. Closing it costs nothing.
  access_key_metadata_writes_enabled = false

  #checkov:skip=CKV_AZURE_140:False positive. The check reads local_authentication_disabled, which the azurerm provider deprecated in favour of local_authentication_enabled; both appear in the schema and only the latter is current. Local authentication is disabled above, and the emulator-only key path in CosmosClientFactory refuses to run outside Development. Suppressed because the finding is wrong, not because the control is missing.
  #checkov:skip=CKV_AZURE_100:Customer-managed keys are not used. Data at rest is encrypted with platform-managed keys; the difference is key custody, not whether encryption happens. This account holds synthetic data only (Principle VI) and the demo makes no claim about customer key custody, so adding a CMK would mean a Key Vault key, an account-creation-time irreversible setting, and a Key Vault reachable from a private-network-only account -- complexity in service of a claim nobody is making. Revisit if the demo ever asserts BYOK.

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
