# Deploy dev's three images, built in parallel by one `docker buildx bake` (deploy-dev.yml).
# GitHub reads only .yml files here as workflows; this file is the build definition next to it.
# CONTEXT is the absolute checkout path, so no relative path depends on where Bake runs.
# One plain image per tag (no provenance or SBOM): the workflow turns both off, because ECR keeps
# the last 10 images and attestations would count too. Layers are cached in GitHub Actions per image.

variable "CONTEXT" {}
variable "REGISTRY" {}
variable "TAG" {}

group "default" {
  targets = ["api", "web", "migrate"]
}

# Base images (node) come from our ECR pull-through cache, not anonymous public.ecr.aws (its
# download limit failed builds); the workflow's ECR login covers the cache too.
target "_common" {
  context = CONTEXT
  args = {
    BASE_REGISTRY = "${REGISTRY}/ecr-public"
  }
}

target "api" {
  inherits   = ["_common"]
  dockerfile = "apps/api/Dockerfile"
  tags       = ["${REGISTRY}/firmivra-dev-api:${TAG}"]
  cache-from = ["type=gha,scope=api"]
  cache-to   = ["type=gha,scope=api,mode=max"]
}

target "web" {
  inherits   = ["_common"]
  dockerfile = "apps/web/Dockerfile"
  tags       = ["${REGISTRY}/firmivra-dev-web:${TAG}"]
  cache-from = ["type=gha,scope=web"]
  cache-to   = ["type=gha,scope=web,mode=max"]
}

target "migrate" {
  inherits   = ["_common"]
  dockerfile = "packages/db/Dockerfile"
  tags       = ["${REGISTRY}/firmivra-dev-migrate:${TAG}"]
  cache-from = ["type=gha,scope=migrate"]
  cache-to   = ["type=gha,scope=migrate,mode=max"]
}
