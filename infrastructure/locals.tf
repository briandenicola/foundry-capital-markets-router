locals {
  application   = "Foundry Capital Markets Router"
  workload      = "fcmr"
  resource_name = "${local.workload}-${random_string.this.result}"

  tags = {
    Application = local.application
    Workload    = local.workload
    ManagedBy   = "terraform"
    DataClass   = "synthetic-only"
    Demo        = "2026-09-10"
  }

  vnet_cidr = "10.42.0.0/16"

  subnets = {
    container_apps    = "10.42.0.0/23"
    private_endpoints = "10.42.2.0/24"
  }

  private_dns_zones = [
    "privatelink.documents.azure.com",
    "privatelink.search.windows.net",
    "privatelink.vaultcore.azure.net",
    "privatelink.azurecr.io",
    "privatelink.services.ai.azure.com",
    "privatelink.openai.azure.com",
  ]
}
