# Local state, deliberately. This is a demo estate that one person stands up and tears down;
# a storage account holding state adds a resource to provision, a name to configure, and a
# prompt at init, and buys nothing a single operator needs.
terraform {
  backend "local" {}
}
