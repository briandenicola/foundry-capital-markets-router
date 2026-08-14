resource "random_string" "this" {
  length  = 6
  special = false
  upper   = false
  numeric = true
}
