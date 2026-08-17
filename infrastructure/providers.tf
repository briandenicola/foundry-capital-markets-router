terraform {
  required_version = ">= 1.7.0"

  required_providers {
    # Held on 4.x deliberately, not incidentally. azurerm 5.0 is a breaking change -- it
    # replaced resource_group_name + private_dns_zone_name on
    # azurerm_private_dns_zone_virtual_network_link with private_dns_zone_id. The estate is
    # applied and demonstrated on 4.x; the provider major has no bearing on what the demo
    # shows, so the upgrade buys nothing and risks the one apply that matters. See ADR-010.
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.14"
    }
    # Foundry accounts, projects, and managedComputeDeployments use preview API versions the
    # azurerm provider does not model yet.
    azapi = {
      source  = "Azure/azapi"
      version = "~> 2"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = true
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}
