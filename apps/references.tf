# The apps stack reads platform values from remote state. Values are never duplicated.
# See docs/adr/002-two-stack-terraform.md.

data "terraform_remote_state" "platform" {
  backend = "azurerm"

  config = {
    resource_group_name  = var.tf_state_resource_group
    storage_account_name = var.tf_state_storage_account
    container_name       = var.tf_state_container
    key                  = "infrastructure.tfstate"
  }
}

locals {
  platform = data.terraform_remote_state.platform.outputs

  services = {
    "router-service"       = { external = false, cpu = 1.0, memory = "2Gi" }
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
