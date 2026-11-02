# Vendored package audits

Extends the vendored package checks in `SKILL.md`. Read before adding a package under `~/.pi/agent/packages/` or changing a package's Pi integration or deferred runtime behavior.

## Contract

Every immediate package directory must contain a named `package.json` with a `piAudit` field pointing to a `./relative` file inside that package. Discovery reads the directory, not a maintained package list or only the enabled settings. Missing manifests, missing entries, entries outside their package, thrown errors, empty evidence, process failures and timeouts fail the gate.

The entry exports `audit(context)`, returning a promise of non-empty evidence strings. Import `PackageAuditContext` as a type from `~/.pi/agent/skills/pi-updated/scripts/lib-package-audit.ts`. The context supplies `hostRoot`, the installed Pi package, and `temporaryDirectory`, the audit's disposable working directory.

Keep the audit inside the package that owns the behavior. Adding a package never requires changing the central runner. Adding a deferred runtime path requires extending that package's audit in the same change.

## What to execute

Exercise real production entry points, including delayed imports, subprocess loaders, SDK session creation, tool adapters and shutdown paths relevant to the package. Extension registration alone is insufficient. Reuse production dependency resolution and configuration rather than copying their rules into the audit.

Return evidence only after the operation and its cleanup succeed. Do not replace Pi with mocks, inject a fake child-session factory, call paid model providers, read login vaults, use personal browser profiles, or change live settings. If a required path cannot run without external access, fail with the missing prerequisite instead of returning a skipped or successful result. Keep unrelated external integrations out of the local compatibility check and identify them as unverified in the upgrade report.

Use only the supplied temporary directory for state. Close browsers, sessions, servers and watchers in `finally`. Do not let a package audit terminate successfully while its work continues in another process.

## Installed host, not development dependencies

The runner starts a fresh Node process per package. Its loader resolves package-authored Pi and TypeBox imports from `hostRoot` and refuses resolution failures instead of using a package's development copy. Imports inside the installed dependency tree keep that tree's native resolution. The Pi AI root uses the host extension compatibility export, matching Pi extensions. A package with its own subprocess loader must audit that production loader as well.

The child receives an environment allowlist, a temporary home and agent directory, and no inherited provider credentials. No model prompt is sent by the supplied audits. This is state separation for trusted, reviewed vendored code, not an operating-system sandbox. The processes retain the current user's filesystem permissions.

The runtime bound and output bound are enforced by the central runner. Full process output and exit information belong in its evidence directory. Failures must name that directory. Scratch state is removed when the operation settles.

## Review coverage

For each relevant changelog removal or API change, trace the changed name through `extensions/` and every vendored package's source, including dynamic imports and dependency alias tables. Record the affected path, the package audit that exercised it, and the observed outcome. An unexercised affected path blocks declaring that path compatible.

The generic gate proves discovery and execution, not the completeness of an author's chosen checks. Review the package's delayed paths whenever its behavior or Pi's dependency graph changes.
