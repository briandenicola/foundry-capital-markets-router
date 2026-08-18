# The apps stack finds platform resources by name, not by reading the infrastructure stack's
# state. Every name derives from a single input, app_name, using the same convention the
# infrastructure stack applies in infrastructure/locals.tf. There is nothing to configure and
# no state to share. See docs/adr/002-two-stack-terraform.md.
#
# app_name comes from `terraform -chdir=./infrastructure output -raw app_name`, wired in
# tasks/Taskfile.app.yml. The two stacks meet in the orchestration layer, not in Terraform.

locals {
  resource_group_name = "rg-${var.app_name}"
  apps_rg_name        = "rg-${var.app_name}-apps"
  acr_name            = replace("${var.app_name}acr", "-", "")
  cae_name            = "${var.app_name}-cae"
  cosmos_name         = "${var.app_name}-cosmos"
  cosmos_database     = "fcmr"
  search_name         = "${var.app_name}-search"
  appinsights_name    = "${var.app_name}-appi"
  foundry_name        = "${var.app_name}-foundry"
  foundry_project     = "${var.app_name}-proj"

  services = {
    "router-service"       = { external = false, cpu = 1.0, memory = "2Gi" }
    "approvals-service"    = { external = false, cpu = 0.5, memory = "1Gi" }
    "research-service"     = { external = false, cpu = 0.5, memory = "1Gi" }
    "surveillance-service" = { external = false, cpu = 1.0, memory = "2Gi" }
    "orderrouting-service" = { external = false, cpu = 0.5, memory = "1Gi" }
    "webui"                = { external = true, cpu = 0.5, memory = "1Gi" }
  }

  tags = {
    Application = "Foundry Capital Markets Router"
    Workload    = "fcmr"
    ManagedBy   = "terraform"
    DataClass   = "synthetic-only"
  }
}

data "azurerm_container_registry" "this" {
  name                = local.acr_name
  resource_group_name = local.resource_group_name
}

data "azurerm_container_app_environment" "this" {
  name                = local.cae_name
  resource_group_name = local.resource_group_name
}

data "azurerm_cosmosdb_account" "this" {
  name                = local.cosmos_name
  resource_group_name = local.resource_group_name
}

data "azurerm_search_service" "this" {
  name                = local.search_name
  resource_group_name = local.resource_group_name
}

data "azurerm_application_insights" "this" {
  name                = local.appinsights_name
  resource_group_name = local.resource_group_name
}

data "azurerm_cognitive_account" "foundry" {
  name                = local.foundry_name
  resource_group_name = local.resource_group_name
}

data "azapi_resource" "foundry_project" {
  type      = "Microsoft.CognitiveServices/accounts/projects@2025-10-01-preview"
  name      = local.foundry_project
  parent_id = data.azurerm_cognitive_account.foundry.id
}

# A single indirection so the rest of the stack reads the same way it did when these values
# came from remote state.
locals {
  platform = {
    acr_name                               = data.azurerm_container_registry.this.name
    acr_login_server                       = data.azurerm_container_registry.this.login_server
    container_app_environment_id           = data.azurerm_container_app_environment.this.id
    cosmos_account_name                    = data.azurerm_cosmosdb_account.this.name
    cosmos_endpoint                        = data.azurerm_cosmosdb_account.this.endpoint
    cosmos_database_name                   = local.cosmos_database
    search_endpoint                        = "https://${data.azurerm_search_service.this.name}.search.windows.net"
    foundry_project_id                     = data.azapi_resource.foundry_project.id
    application_insights_connection_string = data.azurerm_application_insights.this.connection_string
  }
}
