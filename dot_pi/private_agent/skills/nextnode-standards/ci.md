# Common pull-request CI

Extends the pull-request CI section in `SKILL.md`; the convention applies to every NextNode project, independently of the author or coding agent. This is a repository workflow convention, not an npm runtime export or a deployment pipeline.

## Names and ownership

- Use `.github/workflows/ci.yml`, workflow name `CI`, and required check name `CI`.
- Run gates as parallel jobs, one job per gate, so each check is individually visible, restartable and timed in GitHub Actions.
- Use concurrency group `ci-pr-${{ github.event.pull_request.number }}` and cancel older runs of the same PR; never share the deployment concurrency group.
- Never name CI after Factory, Hermes, Pi or another agent. Agents consume the repository's results; they do not own its CI.
- Green checks are technical evidence, not human acceptance. Keep review and merge under human control.

## Implementation

1. Read the repository's `AGENTS.md`, `package.json`, existing workflows and integration branch. Reuse an equivalent PR workflow instead of adding duplicate gates.
2. Trigger on `pull_request` targeting the actual integration branch. Never execute untrusted PR code through `pull_request_target` with privileged tokens or secrets.
3. Grant `permissions: contents: read`; inherit no deployment secrets and do not deploy, publish or enable automatic merge. Use the project's supported Node version and its exact `packageManager` pin through `pnpm/action-setup`.
4. Install with `pnpm install --frozen-lockfile`, then run existing lint, formatting, type-check, test and build scripts as applicable. Discover their actual names. Syneva's gates are `pnpm lint`, `pnpm lint:types`, `pnpm format:check`, `pnpm check`, `pnpm build`; other repositories use their own type-check command and existing test suite. Never hide a missing required gate with `--if-present` or author a new test suite solely to add CI.
5. Before scaffolding action versions, check https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs and the official releases of `actions/checkout`, `actions/setup-node` and `pnpm/action-setup`. A naming-only change preserves working pins; upgrades are a separate change. Read the runtime/package-manager contract before changing pnpm setup major versions.
6. Never chain gates sequentially inside one job; a single-job workflow hides progress and wastes wall-clock time. Expose a final required job named `CI` with `needs` on every gate and `if: always()`. Guard it by checking `needs.*.result` for all three of `failure`, `cancelled` and `skipped` — a `contains(..., 'failure')`-only test silently passes when a gate is skipped or cancelled, because `contains` matches only the literals you list. Never hardcode gate names in the guard; the gate set is repo-specific. Copy [templates/parallel-ci.yml](templates/parallel-ci.yml) and replace its gates with the repo's discovered scripts. Do not couple protection to changing job names or matrix labels; only the final `CI` job is the required check.

## Verification and required-check renaming

- Run the project's formatting check and `git diff --check`; parse the YAML and verify its trigger, permissions, check name and scripts.
- When updating a PR is authorized, push its branch and verify the `CI` check succeeds on the exact current head SHA.
- Keep the previous required-check name until the new one is green. Then replace only that context, preserving strictness, application binding and all other branch protections; read the exact protection back. Requiring a removed check name can prevent every merge.
- Before pushing to a PR branch, read the PR's `state` and `headRefOid` and compare with local HEAD. If the PR merged or the base moved mid-session, re-branch from the updated default branch and open a fresh PR — pushes to a merged branch's head never reach a review, and its required check cannot go green again.
- Do not alter historical audit records or roll out the workflow to other repositories without a fleet-wide request. This skill defines the convention for subsequent setup work; it does not prove every repository already has it.
