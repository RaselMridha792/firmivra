# Deploy prod's three images, built in parallel by one `docker buildx bake` (deploy-prod.yml), the
# same way deploy-dev.docker-bake.hcl builds dev's, into the firmivra-prod-* repositories.
# GitHub reads only .yml files here as workflows; this file is the build definition next to it.
# CONTEXT is the absolute checkout path, so no relative path depends on where Bake runs.
# One plain image per tag (no provenance or SBOM): the workflow turns both off, because ECR keeps
# the last 10 images and attestations would count too. Layers come from the same GitHub Actions
# caches as dev's builds (read and written per image), since both build the same Dockerfiles.

variable "CONTEXT" {}
variable "REGISTRY" {}
variable "TAG" {}

group "default" {
  targets = ["api", "web", "migrate"]
}

# Base images (node) come from the account's ECR pull-through cache (dev's CI stack owns the rule),
# not anonymous public.ecr.aws; the workflow's ECR login covers the cache too.
target "_common" {
  context = CONTEXT
  args = {
    BASE_REGISTRY = "${REGISTRY}/ecr-public"
  }
}

target "api" {
  inherits   = ["_common"]
  dockerfile = "apps/api/Dockerfile"
  tags       = ["${REGISTRY}/firmivra-prod-api:${TAG}"]
  cache-from = ["type=gha,scope=api"]
  cache-to   = ["type=gha,scope=api,mode=max"]
}

target "web" {
  inherits   = ["_common"]
  dockerfile = "apps/web/Dockerfile"
  tags       = ["${REGISTRY}/firmivra-prod-web:${TAG}"]
  cache-from = ["type=gha,scope=web"]
  cache-to   = ["type=gha,scope=web,mode=max"]
}

target "migrate" {
  inherits   = ["_common"]
  dockerfile = "packages/db/Dockerfile"
  tags       = ["${REGISTRY}/firmivra-prod-migrate:${TAG}"]
  cache-from = ["type=gha,scope=migrate"]
  cache-to   = ["type=gha,scope=migrate,mode=max"]
}
