# Removed golden-image builder

Extends the removed-builder reference in `SKILL.md`.

Use the current command registry in [infrastructure.md](infrastructure.md). It has no golden-image builder. Worker builds and deployment order are defined in [pipeline.md](pipeline.md).

Do not provision a temporary VPS or rebuild a server snapshot for a Worker deployment.
