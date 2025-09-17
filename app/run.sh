#!/bin/sh
set -e

# This script just starts the node server.
# The depends_on configuration in the service.yaml will ensure that the
# litestream container is healthy before this container starts.

exec node server.js
