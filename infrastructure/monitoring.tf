resource "azurerm_log_analytics_workspace" "this" {
  name                = "${local.resource_name}-law"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_application_insights" "this" {
  name                = "${local.resource_name}-appi"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "web"
  tags                = local.tags

  # Sampling is disabled deliberately. The scoreboard reads from Application Insights and
  # AC-5 requires completeness within a five-second budget. See ADR 004.
  sampling_percentage = 100
}
