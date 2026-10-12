BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SELECT pg_advisory_xact_lock(74182026);
-- Expand roles only. Never changes users, passwords, inventory or movements.
-- Keep the old check until the new constraint has validated every existing row.
ALTER TABLE public.users ADD CONSTRAINT users_roles_three_check
 CHECK(role IN ('ADMINISTRADOR','ALMACENERO','SUPERVISOR')) NOT VALID;
ALTER TABLE public.users VALIDATE CONSTRAINT users_roles_three_check;
-- The original unnamed role CHECK in 001 is named users_role_check by PostgreSQL.
-- Fail and roll back if the expected schema differs; do not drop unknown checks.
ALTER TABLE public.users DROP CONSTRAINT users_role_check;
COMMIT;
