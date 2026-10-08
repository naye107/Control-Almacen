BEGIN;
SELECT pg_advisory_xact_lock(74182026);
-- Reject the historical full-JSON UPSERT even when it retains a live connection.
-- The marker is a protocol discriminator, not a replacement for restricted DB roles.
CREATE FUNCTION require_versioned_inventory_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'INVENTORY_DESTRUCTIVE_WRITE_FORBIDDEN' USING ERRCODE='23514'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.version <> OLD.version + 1
    OR current_setting('japurima.writer_protocol',true) IS DISTINCT FROM 'phase5a'
 THEN RAISE EXCEPTION 'VERSIONED_INVENTORY_WRITER_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_00_writer_protocol_guard BEFORE UPDATE OR DELETE ON inventory_state FOR EACH ROW EXECUTE FUNCTION require_versioned_inventory_writer();
CREATE TRIGGER inventory_truncate_guard BEFORE TRUNCATE ON inventory_state FOR EACH STATEMENT EXECUTE FUNCTION require_versioned_inventory_writer();
-- Preserve existing rows: enforce new cross-request references without rewriting history.
CREATE FUNCTION enforce_dispatch_item_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dispatch_request uuid; item_request uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id
    AND EXISTS(SELECT 1 FROM dispatches WHERE id=NEW.dispatch_id AND status='CONFIRMADO')
 THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT request_id INTO dispatch_request FROM dispatches WHERE id=NEW.dispatch_id FOR SHARE;
 SELECT request_id INTO item_request FROM request_items WHERE id=NEW.request_item_id FOR SHARE;
 IF dispatch_request IS DISTINCT FROM item_request THEN RAISE EXCEPTION 'DISPATCH_REQUEST_ITEM_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dispatch_item_request_guard BEFORE INSERT OR UPDATE ON dispatch_items FOR EACH ROW EXECUTE FUNCTION enforce_dispatch_item_request();
CREATE FUNCTION protect_dispatch_request_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request_id IS DISTINCT FROM OLD.request_id AND EXISTS(SELECT 1 FROM dispatch_items WHERE dispatch_id=OLD.id)
 THEN RAISE EXCEPTION 'DISPATCH_REQUEST_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dispatch_request_guard BEFORE UPDATE OF request_id ON dispatches FOR EACH ROW EXECUTE FUNCTION protect_dispatch_request_reference();
CREATE FUNCTION protect_request_item_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.request_id,NEW.product_id) IS DISTINCT FROM (OLD.request_id,OLD.product_id)
    AND EXISTS(SELECT 1 FROM dispatch_items WHERE request_item_id=OLD.id)
 THEN RAISE EXCEPTION 'DISPATCH_REQUEST_ITEM_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER request_item_reference_guard BEFORE UPDATE OF request_id,product_id ON request_items FOR EACH ROW EXECUTE FUNCTION protect_request_item_reference();
-- Extract JSONB once per inventory UPDATE, rather than scanning it per link.
CREATE OR REPLACE FUNCTION protect_dispatch_output() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (
  WITH old_outputs AS (SELECT value, value->>'id' AS id FROM jsonb_array_elements(OLD.data->'outputs')),
       new_outputs AS (SELECT value, value->>'id' AS id FROM jsonb_array_elements(NEW.data->'outputs'))
  SELECT 1 FROM dispatch_inventory_links l JOIN old_outputs o ON o.id=l.output_id
  LEFT JOIN new_outputs n ON n.id=o.id WHERE o.value IS DISTINCT FROM n.value
 ) THEN RAISE EXCEPTION 'DISPATCH_OUTPUT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- A future confirmation must have movements linked to every delivered line.
CREATE FUNCTION require_dispatch_movements() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inventory jsonb;
BEGIN
 IF NEW.status <> 'CONFIRMADO' THEN RETURN NEW; END IF;
 SELECT data INTO inventory FROM inventory_state WHERE id=1 FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM dispatch_items WHERE dispatch_id=NEW.id)
 OR EXISTS(
  SELECT 1 FROM dispatch_items i JOIN request_items ri ON ri.id=i.request_item_id
  LEFT JOIN dispatch_inventory_links l ON l.dispatch_item_id=i.id
  WHERE i.dispatch_id=NEW.id AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(inventory->'outputs') o
   WHERE o->>'id'=l.output_id AND o->>'dispatchId'=NEW.id::text
     AND o->>'dispatchItemId'=i.id::text AND o->>'productId'=ri.product_id
  )
 ) THEN RAISE EXCEPTION 'DISPATCH_MOVEMENTS_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dispatch_confirmation_integrity_guard BEFORE INSERT OR UPDATE OF status ON dispatches FOR EACH ROW EXECUTE FUNCTION require_dispatch_movements();
CREATE INDEX dispatches_user_idx ON dispatches(user_id);
COMMIT;
