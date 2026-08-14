#!/usr/bin/env bash
set -Eeuo pipefail

required_variables=(
  POSTGRES_DB
  POSTGRES_SHADOW_DB
  POSTGRES_OWNER_USER
  POSTGRES_OWNER_PASSWORD
  POSTGRES_APP_USER
  POSTGRES_APP_PASSWORD
)

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Required environment variable ${variable_name} is missing." >&2
    exit 1
  fi
done

psql \
  --username postgres \
  --dbname postgres \
  --set=ON_ERROR_STOP=1 \
  --set=owner_user="${POSTGRES_OWNER_USER}" \
  --set=owner_password="${POSTGRES_OWNER_PASSWORD}" \
  --set=app_user="${POSTGRES_APP_USER}" \
  --set=app_password="${POSTGRES_APP_PASSWORD}" \
  <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER CREATEDB NOCREATEROLE INHERIT NOBYPASSRLS',
  :'owner_user',
  :'owner_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner_user') \gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS',
  :'app_user',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec

SELECT format(
  'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS',
  'qualyra_runtime'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qualyra_runtime') \gexec

SELECT format('GRANT qualyra_runtime TO %I', :'app_user') \gexec
SQL

psql \
  --username postgres \
  --dbname postgres \
  --set=ON_ERROR_STOP=1 \
  --set=database_name="${POSTGRES_DB}" \
  --set=owner_user="${POSTGRES_OWNER_USER}" \
  <<'SQL'
SELECT format('ALTER DATABASE %I OWNER TO %I', :'database_name', :'owner_user') \gexec
SQL

psql \
  --username postgres \
  --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 \
  --set=owner_user="${POSTGRES_OWNER_USER}" \
  <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('ALTER SCHEMA public OWNER TO %I', :'owner_user') \gexec
SQL

shadow_database_exists="$(
  psql \
    --username postgres \
    --dbname postgres \
    --tuples-only \
    --no-align \
    --set=database_name="${POSTGRES_SHADOW_DB}" \
    <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'database_name';
SQL
)"

if [[ "${shadow_database_exists}" != "1" ]]; then
  createdb \
    --username postgres \
    --owner "${POSTGRES_OWNER_USER}" \
    "${POSTGRES_SHADOW_DB}"
fi

psql \
  --username postgres \
  --dbname "${POSTGRES_SHADOW_DB}" \
  --set=ON_ERROR_STOP=1 \
  --set=owner_user="${POSTGRES_OWNER_USER}" \
  <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('ALTER SCHEMA public OWNER TO %I', :'owner_user') \gexec
SQL
