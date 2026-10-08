BEGIN;
SELECT pg_advisory_xact_lock(74182026);
ALTER TABLE requests ADD COLUMN request_version integer;
ALTER TABLE requests ADD COLUMN category text;
ALTER TABLE requests ADD COLUMN crop text;
ALTER TABLE requests ADD COLUMN application_mode text;
ALTER TABLE requests ADD COLUMN container_count numeric(20,6);
ALTER TABLE requests ADD COLUMN operation_id uuid;
ALTER TABLE requests ADD COLUMN payload_hash text;
CREATE UNIQUE INDEX requests_operation_id_idx ON requests(operation_id) WHERE operation_id IS NOT NULL;
ALTER TABLE requests DROP CONSTRAINT requests_status_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_check CHECK(status IN ('REGISTRADA','APROBADA','RECHAZADA','PARCIAL','DESPACHADA','CANCELADA','PENDIENTE','PARCIALMENTE_DESPACHADA'));
ALTER TABLE requests ALTER COLUMN status SET DEFAULT 'PENDIENTE';
ALTER TABLE requests ADD CONSTRAINT requests_v2_check CHECK (
 request_version IS NULL OR (request_version=2 AND category IS NOT NULL AND category IN ('AGROQUIMICOS','HERRAMIENTAS','OTROS') AND operation_id IS NOT NULL AND payload_hash IS NOT NULL AND
 ((category='AGROQUIMICOS' AND crop IS NOT NULL AND length(trim(crop))>0 AND application_mode IS NOT NULL AND application_mode IN ('CILINDROS','TANQUES') AND container_count IS NOT NULL AND container_count>0 AND container_count<=1000000)
 OR (category IN ('HERRAMIENTAS','OTROS') AND crop IS NULL AND application_mode IS NULL AND container_count IS NULL)))
);
ALTER TABLE request_items ADD COLUMN line_number integer;
ALTER TABLE request_items ADD COLUMN dose_quantity numeric(20,6);
ALTER TABLE request_items ADD COLUMN base_quantity numeric(20,6);
ALTER TABLE request_items ADD COLUMN base_unit text;
ALTER TABLE request_items ADD COLUMN dimension text;
ALTER TABLE request_items ADD CONSTRAINT request_items_v2_check CHECK (
 line_number IS NULL OR (line_number>0 AND base_quantity IS NOT NULL AND base_quantity>0 AND base_unit IS NOT NULL AND dimension IS NOT NULL AND (dose_quantity IS NULL OR dose_quantity>0))
);
CREATE UNIQUE INDEX request_items_line_idx ON request_items(request_id,line_number) WHERE line_number IS NOT NULL;
CREATE INDEX requests_status_created_idx ON requests(status,created_at);
COMMIT;
