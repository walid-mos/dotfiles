# R2 buckets and public domains

Extends the R2 reference in `SKILL.md`. Declaration fields live in [config.md](config.md), binding selection in [cloudflare-workers.md](cloudflare-workers.md).

Read `packages/infrastructure/src/domain/cloudflare/workers/terraform-config.ts`, `terraform-resources.ts`, `terraform-outputs.ts` and `domain/cloudflare/r2/custom-domain.ts` before changing bucket provisioning.

## Access

Terraform creates the declared buckets. A Worker with `needs = ["r2"]` receives an `R2_<ALIAS>` binding for each one. Use the native binding rather than creating S3 credentials or an additional storage adapter.

Public vars include `R2_ENDPOINT` and `R2_BUCKET_<ALIAS>`. A bucket with `cdn = true` additionally contributes `R2_BUCKET_<ALIAS>_URL`. This environment contains no access key or secret key.

## Public domains

A CDN-enabled bucket gets a Terraform-managed custom domain at `<alias>.cdn.<resolved-project-domain>`. Development resolves the project domain with its development prefix before deriving the CDN hostname. Consume the generated URL rather than rebuilding it in application code.

CDN-enabled buckets are public. A private bucket has no public-domain resource or URL variable. Do not use a CDN URL as proof of authorization or place private content behind a public bucket domain.

## Destruction

Teardown removes Terraform-managed buckets and domains. The data-deletion guard lives in [multi-service.md](multi-service.md). There is no R2-backed infrastructure state file, token rotation or automatic final backup in this flow. HCP Terraform owns deployment state.
