#!/bin/sh
set -eu
umask 077
if [ -f /api-control/ready.json ]; then
  echo 'MIGRATION_REUSED'
  exit 0
fi
if [ -e /api-control/migration.started ]; then
  echo 'INITIALIZATION_INTERRUPTED: migration was already attempted' >&2
  exit 2
fi
(set -C; : > /api-control/migration.started)
flyway -configFiles=/api-control/flyway.conf -outputType=json migrate > /api-control/migration-result.json
echo 'MIGRATION_COMPLETED'
