#!/bin/sh
set -eu
sid=$(cat /control/sid)
owner=$(cat /control/owner)
case "$sid" in ''|*[!0-9]*) exit 1;; esac
case "$owner" in ''|*[!0-9a-f]*) exit 1;; esac
test "${#owner}" -eq 32
export FLYWAY_PASSWORD="$(cat /control/password)"
# initSql verifies every actual Flyway connection before migration.
export FLYWAY_INIT_SQL="SET lock_timeout='5s'; SET statement_timeout='10min'; DO \$\$ BEGIN IF current_database()<>'recycleyoungs_team_dev' OR current_user<>'ry_team_owner' OR session_user<>'ry_team_owner' OR current_setting('data_directory')<>'/var/lib/postgresql/data/team' OR current_setting('recycleyoungs.owner',true) IS DISTINCT FROM '$owner' OR (SELECT system_identifier::text FROM pg_control_system())<>'$sid' THEN RAISE EXCEPTION 'team DB connection identity rejected'; END IF; END \$\$;"
exec /flyway/flyway migrate
