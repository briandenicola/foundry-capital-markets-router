terraform {
  backend "azurerm" {
    # Values supplied via -backend-config or environment variables.
    key = "apps.tfstate"
  }
}
