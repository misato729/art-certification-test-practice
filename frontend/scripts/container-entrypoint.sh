#!/bin/sh
set -eu
node scripts/ensure-dependencies.mjs
exec "$@"
