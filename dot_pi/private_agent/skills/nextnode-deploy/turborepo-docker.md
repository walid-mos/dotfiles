# Worker builds in a monorepo

Extends the former image-build reference in `SKILL.md`.

Read [pipeline.md](pipeline.md) for the actual build command and [config.md](config.md) for bundle entries. A Worker deployment uploads a bundle or assets, not a Docker image.

`project.filter` filters quality commands, while the current deploy workflow builds from the caller workspace root. Inspect the root build script and workspace dependencies before changing which packages build.

The former image-build recipe is not part of this workflow. A separate container-delivery request needs its own deployment contract.
