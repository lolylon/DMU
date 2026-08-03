-- Dev bootstrap roles for evidence immutability and admin separation.
-- Production hardening is applied via migrations + ops runbooks.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'miru_app') THEN
    CREATE ROLE miru_app LOGIN PASSWORD 'miru_app_dev_only';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'miru_admin') THEN
    CREATE ROLE miru_admin LOGIN PASSWORD 'miru_admin_dev_only';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE miru TO miru_app, miru_admin;
GRANT USAGE ON SCHEMA public TO miru_app, miru_admin;
