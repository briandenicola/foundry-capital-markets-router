resource "azurerm_cosmosdb_account" "this" {
  name                = "${local.resource_name}-cosmos"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  public_network_access_enabled     = false
  is_virtual_network_filter_enabled = true
  local_authentication_disabled     = true

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
