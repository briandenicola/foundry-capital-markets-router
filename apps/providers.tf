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
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}
