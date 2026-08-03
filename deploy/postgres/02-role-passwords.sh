#!/bin/sh
# Set app/admin role passwords from env (pilot / prod). Runs once on first Postgres init.
set -eu

APP_PW="${MIRU_APP_PASSWORD:-miru_app_dev_only}"
ADMIN_PW="${MIRU_ADMIN_PASSWORD:-miru_admin_dev_only}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
ALTER ROLE miru_app WITH PASSWORD '${APP_PW}';
ALTER ROLE miru_admin WITH PASSWORD '${ADMIN_PW}';
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO miru_app, miru_admin;
GRANT USAGE ON SCHEMA public TO miru_app, miru_admin;
EOSQL
