BEGIN;
SELECT pg_advisory_xact_lock(74182026);
CREATE TABLE document_records (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('REQUEST','DISPATCH')),
 request_id uuid REFERENCES requests(id),
 dispatch_id uuid REFERENCES dispatches(id),
 source_id uuid NOT NULL,
 template_version text NOT NULL,
 snapshot jsonb NOT NULL,
 pdf bytea NOT NULL CHECK(octet_length(pdf)>0 AND octet_length(pdf)<=5242880),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 filename text NOT NULL CHECK(filename ~ '^[A-Za-z0-9_-]+\.pdf$'),
 generated_at timestamptz NOT NULL DEFAULT now(),
 generated_by uuid REFERENCES users(id),
 CHECK((kind='REQUEST' AND request_id=source_id AND request_id IS NOT NULL AND dispatch_id IS NULL)
    OR (kind='DISPATCH' AND dispatch_id=source_id AND dispatch_id IS NOT NULL AND request_id IS NULL)),
 UNIQUE(kind,source_id,template_version)
);
CREATE INDEX document_records_created_idx ON document_records(generated_at);
CREATE FUNCTION protect_document_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'DOCUMENT_IMMUTABLE' USING ERRCODE='23514'; END $$;
CREATE TRIGGER document_record_guard BEFORE UPDATE OR DELETE ON document_records FOR EACH ROW EXECUTE FUNCTION protect_document_record();
COMMIT;
