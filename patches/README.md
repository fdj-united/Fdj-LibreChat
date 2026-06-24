# patches

Holds `patch-package` patches applied via the root `postinstall` script.

This directory is currently empty of patches but is kept under version control
because the Dockerfile copies it (`COPY patches ./patches`) and `.dockerignore`
excludes hidden files (so a `.gitkeep` would not survive the Docker build).
Remove this file once a real `*.patch` is added.
