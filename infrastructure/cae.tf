resource "azurerm_container_app_environment" "this" {
  name                       = "${local.resource_name}-cae"
  resource_group_name        = azurerm_resource_group.this.name
  location                   = azurerm_resource_group.this.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
  infrastructure_subnet_id   = var.enable_private_networking ? azurerm_subnet.container_apps[0].id : null

  # Internal load balancer only. The single public surface is the demo UI front door,
  # declared in the apps stack.
  internal_load_balancer_enabled = var.enable_private_networking

  tags = local.tags
}
