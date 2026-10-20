BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(74182026);
-- Extend the existing contract without changing any historical row or PDF.
ALTER TABLE public.requests ADD CONSTRAINT requests_v10_check CHECK (
 request_version IS NULL OR (request_version=2 AND category IS NOT NULL AND category IN ('AGROQUIMICOS','HERRAMIENTAS','OTROS') AND operation_id IS NOT NULL AND payload_hash IS NOT NULL AND
 ((category='AGROQUIMICOS' AND crop IS NOT NULL AND length(trim(crop))>0 AND application_mode IS NOT NULL AND
  ((application_mode IN ('CILINDROS','TANQUES') AND container_count IS NOT NULL AND container_count>0 AND container_count<=1000000)
   OR (application_mode='FERTILIZACION' AND container_count IS NULL)))
  OR (category IN ('HERRAMIENTAS','OTROS') AND crop IS NULL AND application_mode IS NULL AND container_count IS NULL)))
) NOT VALID;
ALTER TABLE public.requests VALIDATE CONSTRAINT requests_v10_check;
ALTER TABLE public.requests DROP CONSTRAINT requests_v2_check;
COMMIT;
