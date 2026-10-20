BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(74182026);
ALTER TABLE public.dispatches ADD CONSTRAINT dispatches_v8_check CHECK(code IS NULL OR (recipient IS NOT NULL AND length(trim(recipient))>0 AND actor_snapshot IS NOT NULL AND request_snapshot IS NOT NULL AND result_snapshot IS NOT NULL AND inventory_version IS NOT NULL AND inventory_version>0 AND confirmed_at IS NOT NULL AND status IN ('BORRADOR','CONFIRMADO','ANULADO'))) NOT VALID;
ALTER TABLE public.dispatches VALIDATE CONSTRAINT dispatches_v8_check;
ALTER TABLE public.dispatches DROP CONSTRAINT dispatches_v3_check;
CREATE TABLE public.dispatch_cancellations(
 dispatch_id uuid PRIMARY KEY REFERENCES public.dispatches(id),
 actor_id uuid NOT NULL REFERENCES public.users(id),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL,
 returns jsonb NOT NULL CHECK(jsonb_typeof(returns)='array' AND jsonb_array_length(returns)>0),
 inventory_version bigint NOT NULL,
 result jsonb NOT NULL
);
CREATE FUNCTION public.guard_dispatch_cancellation() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE state jsonb; ver bigint; movement jsonb; entry jsonb; restored numeric;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CANCELLATION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT data,version INTO state,ver FROM public.lock_inventory_for_write();
 PERFORM 1 FROM public.dispatches WHERE id=NEW.dispatch_id AND status='CONFIRMADO' FOR UPDATE;
 IF NOT FOUND OR NEW.inventory_version<>ver OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.actor_id AND role='ADMINISTRADOR' AND active)
 THEN RAISE EXCEPTION 'INVALID_CANCELLATION' USING ERRCODE='23514'; END IF;
 IF (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(NEW.returns) x)<>jsonb_array_length(NEW.returns)
 THEN RAISE EXCEPTION 'INVALID_CANCELLATION_RETURNS' USING ERRCODE='23514'; END IF;
 FOR entry IN SELECT x FROM jsonb_array_elements(NEW.returns) x LOOP
  SELECT o INTO movement FROM jsonb_array_elements(state->'outputs') o WHERE o->>'id'=entry->>'returnOfOutput' AND o->>'dispatchId'=NEW.dispatch_id::text;
  IF movement IS NULL OR entry->>'returnOfDispatch' IS DISTINCT FROM NEW.dispatch_id::text
  OR entry->>'productId' IS DISTINCT FROM movement->>'productId' OR entry->>'presentation' IS DISTINCT FROM movement->>'presentation'
  OR (SELECT count(*) FROM jsonb_array_elements(state->'purchases') p WHERE p=entry)<>1
  THEN RAISE EXCEPTION 'INVALID_CANCELLATION_RETURNS' USING ERRCODE='23514'; END IF;
  PERFORM public.inventory_number(entry->'quantity');
 END LOOP;
 FOR movement IN SELECT o FROM jsonb_array_elements(state->'outputs') o WHERE o->>'dispatchId'=NEW.dispatch_id::text LOOP
  SELECT sum(public.inventory_number(x->'quantity')) INTO restored FROM jsonb_array_elements(NEW.returns) x WHERE x->>'returnOfOutput'=movement->>'id';
  IF restored IS DISTINCT FROM public.inventory_number(movement->'quantity') THEN RAISE EXCEPTION 'CANCELLATION_QUANTITY_MISMATCH' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER cancellation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.dispatch_cancellations FOR EACH ROW EXECUTE FUNCTION public.guard_dispatch_cancellation();

-- Only the status may change, and only after a validated, complete return.
CREATE OR REPLACE FUNCTION public.protect_confirmed_dispatch() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE parent uuid; parent_new uuid;
BEGIN
 IF TG_TABLE_NAME='dispatches' THEN
  IF OLD.status IN ('CONFIRMADO','ANULADO') THEN
   IF TG_OP='UPDATE' AND OLD.status='CONFIRMADO' AND NEW.status='ANULADO'
   AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status')
   AND EXISTS(SELECT 1 FROM public.dispatch_cancellations WHERE dispatch_id=OLD.id) THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514';
  END IF;
 ELSE
  parent:=CASE WHEN TG_OP='INSERT' THEN NEW.dispatch_id ELSE OLD.dispatch_id END;
  PERFORM 1 FROM public.dispatches WHERE id=parent FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.dispatches WHERE id=parent AND status IN ('CONFIRMADO','ANULADO')) THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id THEN
   parent_new:=NEW.dispatch_id;PERFORM 1 FROM public.dispatches WHERE id=parent_new FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.dispatches WHERE id=parent_new AND status IN ('CONFIRMADO','ANULADO')) THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;

-- Preserve every reversal byte and reject forged/unregistered return records.
CREATE FUNCTION public.check_dispatch_returns() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE entry jsonb;
BEGIN
 FOR entry IN SELECT x FROM jsonb_array_elements(OLD.data->'purchases') x WHERE x ? 'returnOfOutput' LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(NEW.data->'purchases') p WHERE p=entry)<>1 THEN RAISE EXCEPTION 'DISPATCH_RETURN_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR entry IN SELECT x FROM jsonb_array_elements(NEW.data->'purchases') x WHERE x ? 'returnOfOutput' LOOP
  IF NOT EXISTS(SELECT 1 FROM public.dispatch_cancellations c WHERE c.dispatch_id::text=entry->>'returnOfDispatch' AND c.returns @> jsonb_build_array(entry))
  OR NOT EXISTS(SELECT 1 FROM public.dispatches d WHERE d.id::text=entry->>'returnOfDispatch' AND d.status='ANULADO')
  THEN RAISE EXCEPTION 'DISPATCH_RETURN_SERVER_ONLY' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER inventory_return_guard AFTER UPDATE ON public.inventory_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_dispatch_returns();
-- Cancelled children remain immutable too.
CREATE FUNCTION public.freeze_cancelled_child() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE item uuid; parent uuid;
BEGIN
 item:=CASE WHEN TG_OP='DELETE' THEN OLD.dispatch_item_id ELSE NEW.dispatch_item_id END;
 SELECT dispatch_id INTO parent FROM public.dispatch_items WHERE id=item;
 PERFORM 1 FROM public.dispatches WHERE id=parent FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.dispatches WHERE id=parent AND status='ANULADO') THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
CREATE TRIGGER cancelled_fact_guard BEFORE INSERT OR UPDATE OR DELETE ON public.dispatch_allocation_facts FOR EACH ROW EXECUTE FUNCTION public.freeze_cancelled_child();
CREATE TRIGGER cancelled_link_guard BEFORE INSERT OR UPDATE OR DELETE ON public.dispatch_inventory_links FOR EACH ROW EXECUTE FUNCTION public.freeze_cancelled_child();
REVOKE ALL ON public.dispatch_cancellations FROM PUBLIC;
GRANT SELECT,INSERT ON public.dispatch_cancellations TO japurima_app_v160;
COMMIT;
