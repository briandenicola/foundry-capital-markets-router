terraform {
  backend "azurerm" {
    # Values supplied via -backend-config or environment variables.
    # See scripts/bootstrap-remote-state.sh and .env.example.
    key = "infrastructure.tfstate"
  }
}
