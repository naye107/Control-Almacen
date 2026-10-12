BEGIN;
SELECT pg_advisory_xact_lock(74182026);
ALTER TABLE requests ADD COLUMN dispatch_revision bigint NOT NULL DEFAULT 1 CHECK(dispatch_revision>0);
ALTER TABLE dispatches ADD COLUMN code text;
ALTER TABLE dispatches ADD COLUMN recipient text;
ALTER TABLE dispatches ADD COLUMN notes text NOT NULL DEFAULT '';
ALTER TABLE dispatches ADD COLUMN actor_snapshot jsonb;
ALTER TABLE dispatches ADD COLUMN request_snapshot jsonb;
ALTER TABLE dispatches ADD COLUMN result_snapshot jsonb;
ALTER TABLE dispatches ADD COLUMN inventory_version bigint;
ALTER TABLE dispatches ADD COLUMN compensates_dispatch_id uuid REFERENCES dispatches(id);
CREATE UNIQUE INDEX dispatches_code_idx ON dispatches(code) WHERE code IS NOT NULL;
CREATE INDEX dispatches_request_confirmed_idx ON dispatches(request_id,confirmed_at) WHERE status='CONFIRMADO';
CREATE INDEX dispatch_items_request_item_idx ON dispatch_items(request_item_id);
ALTER TABLE dispatch_items ADD COLUMN product_snapshot jsonb;
ALTER TABLE dispatch_items ADD COLUMN base_quantity numeric(20,6);
ALTER TABLE dispatch_items ADD COLUMN base_unit text;
ALTER TABLE dispatches ADD CONSTRAINT dispatches_v3_check CHECK(code IS NULL OR (recipient IS NOT NULL AND length(trim(recipient))>0 AND actor_snapshot IS NOT NULL AND request_snapshot IS NOT NULL AND result_snapshot IS NOT NULL AND inventory_version IS NOT NULL AND inventory_version>0 AND confirmed_at IS NOT NULL AND status IN ('BORRADOR','CONFIRMADO')));
ALTER TABLE dispatch_items ADD CONSTRAINT dispatch_items_v3_check CHECK(base_quantity IS NULL OR (base_quantity>0 AND base_unit IS NOT NULL AND product_snapshot IS NOT NULL));
CREATE FUNCTION protect_confirmed_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM dispatches WHERE id=NEW.dispatch_id AND status='CONFIRMADO') THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='dispatches' THEN
  IF OLD.status='CONFIRMADO' THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM dispatches WHERE id=OLD.dispatch_id AND status='CONFIRMADO') THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN RETURN NEW; END IF; RETURN OLD;
END $$;
CREATE TRIGGER confirmed_dispatch_guard BEFORE UPDATE OR DELETE ON dispatches FOR EACH ROW EXECUTE FUNCTION protect_confirmed_dispatch();
CREATE TRIGGER confirmed_dispatch_item_guard BEFORE INSERT OR UPDATE OR DELETE ON dispatch_items FOR EACH ROW EXECUTE FUNCTION protect_confirmed_dispatch();
CREATE FUNCTION protect_dispatch_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DISPATCH_LINK_IMMUTABLE' USING ERRCODE='23514'; END $$;
CREATE TRIGGER dispatch_link_guard BEFORE UPDATE OR DELETE ON dispatch_inventory_links FOR EACH ROW EXECUTE FUNCTION protect_dispatch_link();
CREATE FUNCTION protect_dispatch_output() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link record; before_output jsonb; after_output jsonb;
BEGIN
 FOR link IN SELECT output_id FROM dispatch_inventory_links LOOP
  SELECT value INTO before_output FROM jsonb_array_elements(OLD.data->'outputs') WHERE value->>'id'=link.output_id;
  IF before_output IS NOT NULL THEN
   SELECT value INTO after_output FROM jsonb_array_elements(NEW.data->'outputs') WHERE value->>'id'=link.output_id;
   IF before_output IS DISTINCT FROM after_output THEN RAISE EXCEPTION 'DISPATCH_OUTPUT_IMMUTABLE' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_dispatch_output_guard BEFORE UPDATE ON inventory_state FOR EACH ROW EXECUTE FUNCTION protect_dispatch_output();
COMMIT;