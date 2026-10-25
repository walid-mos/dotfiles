# Package publishing setup

Extends the package-starting reference in `SKILL.md`. Tooling belongs to `~/.pi/agent/skills/nextnode-standards/SKILL.md` and its setup references. Read those before creating package configs instead of copying versions or build/test templates from an old deployment guide.

## Package layout

Use `packages/<name>` with a matching `project.name`. The publishing workflow invokes semantic-release from that directory. Compare a current sibling package's manifest and release configuration before adding a package.

This path is a workflow constraint, not a requirement imposed on every app. `packages/infrastructure` itself is consumed from a checkout and is not a publishable-package template.

## nextnode.toml

```toml
[project]
name = "my-package"
type = "package"
filter = "@nextnode-solutions/my-package"

[package]
access = "public"
```

The package table enables the plan's publish output. A package has no deploy section or backing resources. It resolves the pipeline environment to `none`, so no deployment environment input is needed.

Configure `[scripts]` from scripts that actually exist. Disable the test task with `test = false` when no suite exists. Package setup does not authorize creating a test suite.

## Caller workflow

Create the package's caller under core's `.github/workflows/`:

```yaml
name: My package

on:
  workflow_dispatch:
  push:
    branches: [main]
    paths: ["packages/my-package/**"]
  pull_request:
    paths: ["packages/my-package/**"]

permissions:
  contents: write
  id-token: write

jobs:
  pipeline:
    uses: ./.github/workflows/publish-package.yml
    with:
      config_file: packages/my-package/nextnode.toml
```

The publish job needs `contents: write` and `id-token: write`, and a called workflow cannot exceed its caller's permissions. Core's older package callers omit this block and still run because the organization's default token is permissive. Declare it anyway so a restricted default does not break publishing. Pass no `secrets: inherit`: the job reads `NPM_TOKEN` and the GitHub App key from the vault.

`publish-package.yml` publishes only from `NextNodeSolutions/core`. Another repository calling it gets plan and quality, and its publish job is skipped. A package outside core needs its own publishing design, not this workflow.

## Release configuration and verification

Use the shared semantic-release configuration. Give each package its own tag format and match the manifest's name, exports, published files and public access to the intended package. For npm provenance, the manifest's repository URL must identify the actual publishing repository.

Read [pipeline.md](pipeline.md) for publication order and [github-org.md](github-org.md) for the vault. The credentials live in the CI project, not in the package.

Before publication, run the package's existing build, lint and type-check scripts as applicable. Run an existing suite only when present. Confirm that the manifest exports resolve to produced files. A successful build alone does not prove npm publish authorization.

Publication runs only on main after quality passes. Do not invoke local tag deletion or semantic-release merely to validate package setup.
