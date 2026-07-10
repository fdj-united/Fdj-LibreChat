# patches

Holds `patch-package` patches applied via the root `postinstall` script.

The Dockerfile copies this directory (`COPY patches ./patches`) so dependency
patches are available during image builds.
