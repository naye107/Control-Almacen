BEGIN;
SELECT pg_advisory_xact_lock(74182026);
-- Additive hardening: no historical JSONB or document bytes are rewritten.
CREATE FUNCTION public.quantity_is_finite(n numeric) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS
$$ SELECT n::text NOT IN ('NaN','Infinity','-Infinity') $$;
ALTER TABLE public.request_items ADD CONSTRAINT request_quantities_finite CHECK (
 public.quantity_is_finite(quantity) AND
 (approved_quantity IS NULL OR public.quantity_is_finite(approved_quantity)) AND
 (dose_quantity IS NULL OR public.quantity_is_finite(dose_quantity)) AND
 (base_quantity IS NULL OR public.quantity_is_finite(base_quantity))) NOT VALID;
ALTER TABLE public.requests ADD CONSTRAINT request_containers_finite CHECK
 (container_count IS NULL OR public.quantity_is_finite(container_count)) NOT VALID;
ALTER TABLE public.dispatch_items ADD CONSTRAINT dispatch_quantities_finite CHECK
 (public.quantity_is_finite(quantity) AND (base_quantity IS NULL OR public.quantity_is_finite(base_quantity))) NOT VALID;
ALTER TABLE public.document_records ADD CONSTRAINT document_content_sha256 CHECK
 (sha256=encode(pg_catalog.sha256(pdf),'hex')) NOT VALID;
ALTER TABLE public.inventory_state ADD CONSTRAINT inventory_singleton CHECK(id=1) NOT VALID;

-- New facts only. Capacity is derived by the trusted backend, never a public API field.
CREATE TABLE public.dispatch_allocation_facts (
 dispatch_item_id uuid NOT NULL REFERENCES public.dispatch_items(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 100000),
 numerator numeric(40,0) NOT NULL CHECK(public.quantity_is_finite(numerator) AND numerator>0),
 denominator numeric(40,0) NOT NULL CHECK(public.quantity_is_finite(denominator) AND denominator>0),
 capacity numeric(20,6) NOT NULL CHECK(public.quantity_is_finite(capacity) AND capacity>0),
 PRIMARY KEY(dispatch_item_id,ordinal)
);
CREATE FUNCTION public.protect_allocation_fact() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE parent uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'DISPATCH_FACT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT dispatch_id INTO parent FROM public.dispatch_items WHERE id=NEW.dispatch_item_id;
 PERFORM 1 FROM public.dispatches WHERE id=parent FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.dispatches WHERE id=parent AND status='CONFIRMADO')
 THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_fact_guard BEFORE INSERT OR UPDATE OR DELETE ON public.dispatch_allocation_facts
FOR EACH ROW EXECUTE FUNCTION public.protect_allocation_fact();

-- A set-returning CAS function returns zero rows on stale expected version.
-- The application MUST check the returned row count, then wait for COMMIT.
CREATE FUNCTION public.inventory_number(j jsonb,allow_zero boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE n numeric;
BEGIN
 IF jsonb_typeof(j) IS DISTINCT FROM 'number' OR length(j::text)>80
 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE='23514'; END IF;
 n:=j::text::numeric;
 IF NOT public.quantity_is_finite(n) OR n>1000000000000 OR n<0 OR (NOT allow_zero AND n=0)
 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE='23514'; END IF;
 RETURN n;
END $$;
CREATE FUNCTION public.write_inventory_cas(p_data jsonb,p_expected bigint)
RETURNS TABLE(version bigint) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE old_data jsonb; old_entries jsonb; collection text; entry jsonb; allocation jsonb; field text;
BEGIN
 IF p_expected IS NULL OR p_expected<1 OR p_expected>=9223372036854775807
 THEN RAISE EXCEPTION 'REVISION_REQUIRED' USING ERRCODE='23514'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data->'products') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_data->'purchases') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_data->'outputs') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'INVALID_INVENTORY' USING ERRCODE='23514'; END IF;
 SELECT s.data INTO old_data FROM public.inventory_state s WHERE s.id=1 AND s.version=p_expected FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 FOREACH collection IN ARRAY ARRAY['products','purchases','outputs'] LOOP
  IF jsonb_array_length(p_data->collection)>100000
  THEN RAISE EXCEPTION 'INVALID_INVENTORY' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->collection) e
   GROUP BY e->>'id' HAVING count(*)>1)
  THEN RAISE EXCEPTION 'DUPLICATE_OR_INVALID_ID' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_object_agg(o->>'id',o) FILTER(WHERE o->>'id' IS NOT NULL),'{}'::jsonb)
  INTO old_entries FROM jsonb_array_elements(old_data->collection) o;
  FOR entry IN SELECT e FROM jsonb_array_elements(p_data->collection) e LOOP
   IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR entry->>'id' IS NULL OR length(entry->>'id') NOT BETWEEN 1 AND 128
   THEN RAISE EXCEPTION 'DUPLICATE_OR_INVALID_ID' USING ERRCODE='23514'; END IF;
   -- Preserve untouched legacy quantities; validate every new or changed object.
   IF old_entries->(entry->>'id')=entry THEN CONTINUE; END IF;
   IF collection='products' THEN
    PERFORM public.inventory_number(entry->'openingStock',true);
    PERFORM public.inventory_number(entry->'minStock',true);
   ELSE
    PERFORM public.inventory_number(entry->'quantity');
    IF collection='outputs' THEN
     FOREACH field IN ARRAY ARRAY['usedQuantity','doseQuantity','doseContainerCount'] LOOP
      IF entry ? field THEN PERFORM public.inventory_number(entry->field); END IF;
     END LOOP;
     IF entry ? 'allocations' THEN
      IF jsonb_typeof(entry->'allocations') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'INVALID_ALLOCATION' USING ERRCODE='23514'; END IF;
      FOR allocation IN SELECT a FROM jsonb_array_elements(entry->'allocations') a LOOP
       PERFORM public.inventory_number(allocation->'quantity');
      END LOOP;
     END IF;
    END IF;
   END IF;
  END LOOP;
 END LOOP;
 PERFORM set_config('japurima.writer_protocol','phase5a',true);
 RETURN QUERY UPDATE public.inventory_state s SET data=p_data,version=s.version+1,updated_at=now()
 WHERE s.id=1 AND s.version=p_expected RETURNING s.version;
END $$;
REVOKE ALL ON FUNCTION public.write_inventory_cas(jsonb,bigint) FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.inventory_state FROM PUBLIC;

-- SELECT FOR UPDATE itself requires UPDATE rights. Expose this narrowly scoped
-- lock through a definer routine instead of granting direct UPDATE to the app.
CREATE FUNCTION public.lock_inventory_for_write() RETURNS TABLE(data jsonb,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 RETURN QUERY SELECT s.data,s.version FROM public.inventory_state s WHERE s.id=1 FOR UPDATE;
END $$;
REVOKE ALL ON FUNCTION public.lock_inventory_for_write() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.protect_dispatch_output() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE link record; before_output jsonb; after_output jsonb; before_count integer; after_count integer;
BEGIN
 FOR link IN SELECT output_id FROM public.dispatch_inventory_links LOOP
  SELECT count(*) INTO before_count FROM jsonb_array_elements(OLD.data->'outputs') o WHERE o->>'id'=link.output_id;
  SELECT count(*) INTO after_count FROM jsonb_array_elements(NEW.data->'outputs') o WHERE o->>'id'=link.output_id;
  SELECT o INTO before_output FROM jsonb_array_elements(OLD.data->'outputs') o WHERE o->>'id'=link.output_id;
  SELECT o INTO after_output FROM jsonb_array_elements(NEW.data->'outputs') o WHERE o->>'id'=link.output_id;
  IF before_count<>1 OR after_count<>1 OR before_output IS DISTINCT FROM after_output
  THEN RAISE EXCEPTION 'DISPATCH_OUTPUT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;

CREATE FUNCTION public.require_new_output_links() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE output jsonb;
BEGIN
 -- Deferred until COMMIT: the legitimate backend writes inventory before links.
 FOR output IN SELECT o FROM jsonb_array_elements(NEW.data->'outputs') o
 WHERE o ? 'dispatchId' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.data->'outputs') old_o WHERE old_o->>'id'=o->>'id') LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(NEW.data->'outputs') x WHERE x->>'id'=output->>'id')<>1
  OR NOT EXISTS(SELECT 1 FROM public.dispatch_inventory_links l
    JOIN public.dispatch_items i ON i.id=l.dispatch_item_id JOIN public.dispatches d ON d.id=i.dispatch_id
    WHERE l.output_id=output->>'id' AND i.id::text=output->>'dispatchItemId'
    AND d.id::text=output->>'dispatchId' AND d.status='CONFIRMADO')
  THEN RAISE EXCEPTION 'DISPATCH_MOVEMENTS_REQUIRED' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER inventory_new_dispatch_links_guard AFTER UPDATE ON public.inventory_state
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_new_output_links();

CREATE FUNCTION public.reject_inventory_insert() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'INVENTORY_INSERT_FORBIDDEN' USING ERRCODE='23514'; END $$;
CREATE TRIGGER inventory_insert_guard BEFORE INSERT ON public.inventory_state
FOR EACH ROW EXECUTE FUNCTION public.reject_inventory_insert();

-- Parse BEFORE a numeric(20,6) assignment. Used for JSONB quantities as well.
CREATE FUNCTION public.strict_quantity(t text) RETURNS numeric LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog AS $$
DECLARE n numeric;
BEGIN
 IF t IS NULL OR length(t)>21 OR t !~ '^[0-9]{1,14}(\.[0-9]{1,6})?$'
 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE='23514'; END IF;
 n:=t::numeric;
 IF n<=0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE='23514'; END IF;
 RETURN n;
END $$;

-- Canonical physical units already used by request-rules; other units represent
-- counts of their named presentation. No guessed parsing of historic labels.
CREATE FUNCTION public.dispatch_base_factor(u text,b text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF (u='kg' AND b='g') OR (u='L' AND b='ml') THEN RETURN 1000; END IF;
 IF u=b THEN RETURN 1; END IF;
 RAISE EXCEPTION 'INCOMPATIBLE_UNIT' USING ERRCODE='23514';
END $$;

CREATE OR REPLACE FUNCTION public.require_dispatch_movements() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inventory jsonb; current_version bigint; line record; movement jsonb;
 matches integer; sent numeric; factor numeric; allocation record;
 total_n numeric; total_d numeric; fact_count integer; exact_n text; exact_d text;
 common_divisor numeric;
BEGIN
 IF NEW.status<>'CONFIRMADO' THEN RETURN NEW; END IF;
 SELECT data,version INTO inventory,current_version FROM public.inventory_state WHERE id=1 FOR UPDATE;
 PERFORM 1 FROM public.requests WHERE id=NEW.request_id FOR UPDATE;
 IF NEW.inventory_version IS DISTINCT FROM current_version
 OR NEW.result_snapshot->>'inventoryRevision' IS DISTINCT FROM NEW.inventory_version::text
 THEN RAISE EXCEPTION 'DISPATCH_INVENTORY_VERSION_MISMATCH' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.dispatch_items WHERE dispatch_id=NEW.id)
 THEN RAISE EXCEPTION 'DISPATCH_MOVEMENTS_REQUIRED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.dispatch_items WHERE dispatch_id=NEW.id GROUP BY request_item_id HAVING count(*)<>1)
 THEN RAISE EXCEPTION 'DISPATCH_DUPLICATE_ITEM' USING ERRCODE='23514'; END IF;
 FOR line IN SELECT i.*,ri.quantity AS requested,ri.unit AS requested_unit,
 ri.request_id AS item_request,ri.product_id,ri.dimension,ri.base_unit AS requested_base_unit,l.output_id
 FROM public.dispatch_items i JOIN public.request_items ri ON ri.id=i.request_item_id
 LEFT JOIN public.dispatch_inventory_links l ON l.dispatch_item_id=i.id WHERE i.dispatch_id=NEW.id
 LOOP
  IF line.item_request IS DISTINCT FROM NEW.request_id
  THEN RAISE EXCEPTION 'DISPATCH_REQUEST_ITEM_MISMATCH' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO matches FROM jsonb_array_elements(inventory->'outputs') o
  WHERE o->>'id'=line.output_id;
  IF matches<>1 THEN RAISE EXCEPTION 'DISPATCH_MOVEMENTS_REQUIRED' USING ERRCODE='23514'; END IF;
  SELECT o INTO movement FROM jsonb_array_elements(inventory->'outputs') o WHERE o->>'id'=line.output_id;
  IF movement->>'dispatchId' IS DISTINCT FROM NEW.id::text
  OR movement->>'dispatchItemId' IS DISTINCT FROM line.id::text
  OR movement->>'productId' IS DISTINCT FROM line.product_id
  THEN RAISE EXCEPTION 'DISPATCH_MOVEMENTS_REQUIRED' USING ERRCODE='23514'; END IF;
  IF NOT public.quantity_is_finite(line.requested) OR line.requested<=0
  OR NOT public.quantity_is_finite(line.quantity) OR line.quantity<=0
  OR line.unit IS DISTINCT FROM line.requested_unit
  OR movement->>'usedUnit' IS DISTINCT FROM line.unit
  OR public.strict_quantity(movement->>'usedQuantity') IS DISTINCT FROM line.quantity
  OR line.allocations IS DISTINCT FROM movement->'allocations'
  OR jsonb_typeof(line.allocations) IS DISTINCT FROM 'array' OR jsonb_array_length(line.allocations)=0
  OR line.base_quantity IS NULL OR NOT public.quantity_is_finite(line.base_quantity)
  OR (line.requested_base_unit IS NOT NULL AND line.base_unit IS DISTINCT FROM line.requested_base_unit)
  OR (line.dimension='weight' AND (line.base_unit IS DISTINCT FROM 'g' OR line.unit NOT IN ('kg','g')))
  OR (line.dimension='volume' AND (line.base_unit IS DISTINCT FROM 'ml' OR line.unit NOT IN ('L','ml')))
  OR (line.dimension LIKE 'packages:%' AND line.base_unit IS DISTINCT FROM line.unit)
  OR movement->>'quantityMode' IS NULL OR movement->>'quantityMode' NOT IN ('units','physical')
  OR (line.dimension IS NOT NULL AND movement->>'quantityMode' IS DISTINCT FROM
   CASE WHEN line.dimension LIKE 'packages:%' THEN 'units' ELSE 'physical' END)
  THEN RAISE EXCEPTION 'DISPATCH_QUANTITY_MISMATCH' USING ERRCODE='23514'; END IF;
  factor:=public.dispatch_base_factor(line.unit,line.base_unit);
  IF line.base_quantity IS DISTINCT FROM line.quantity*factor
  THEN RAISE EXCEPTION 'DISPATCH_QUANTITY_MISMATCH' USING ERRCODE='23514'; END IF;
  total_n:=0;total_d:=1;fact_count:=0;
  FOR allocation IN SELECT * FROM public.dispatch_allocation_facts
  WHERE dispatch_item_id=line.id ORDER BY ordinal LOOP
   fact_count:=fact_count+1;
   exact_n:=line.allocations->(allocation.ordinal-1)->'exactQuantity'->>'n';
   exact_d:=line.allocations->(allocation.ordinal-1)->'exactQuantity'->>'d';
   IF allocation.ordinal<>fact_count OR exact_n IS NULL OR exact_d IS NULL
   OR exact_n !~ '^[0-9]{1,40}$' OR exact_d !~ '^[1-9][0-9]{0,39}$'
   THEN RAISE EXCEPTION 'INVALID_ALLOCATION' USING ERRCODE='23514'; END IF;
   IF exact_n::numeric IS DISTINCT FROM allocation.numerator
   OR exact_d::numeric IS DISTINCT FROM allocation.denominator
   OR (movement->>'quantityMode'='units' AND allocation.capacity<>1)
   THEN RAISE EXCEPTION 'INVALID_ALLOCATION' USING ERRCODE='23514'; END IF;
   total_n:=total_n*allocation.denominator+allocation.numerator*allocation.capacity*total_d;
   total_d:=total_d*allocation.denominator;
   -- Capacity may have six fractional places; normalize before numeric gcd.
   common_divisor:=gcd(total_n*1000000,total_d*1000000);
   total_n:=total_n*1000000/common_divisor;
   total_d:=total_d*1000000/common_divisor;
  END LOOP;
  IF fact_count<>jsonb_array_length(line.allocations) OR total_n<>line.base_quantity*total_d
  THEN RAISE EXCEPTION 'DISPATCH_ALLOCATION_MISMATCH' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(i.quantity),0) INTO sent FROM public.dispatch_items i
  JOIN public.dispatches d ON d.id=i.dispatch_id
  WHERE i.request_item_id=line.request_item_id AND d.status='CONFIRMADO' AND d.id<>NEW.id;
  -- Preserve the existing user contract: approved_quantity policy is not activated here.
  IF NOT public.quantity_is_finite(sent) OR sent+line.quantity>line.requested
  THEN RAISE EXCEPTION 'DISPATCH_OVERDELIVERY' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(inventory->'outputs') o
 WHERE o->>'dispatchId'=NEW.id::text AND NOT EXISTS(
 SELECT 1 FROM public.dispatch_items i JOIN public.dispatch_inventory_links l ON l.dispatch_item_id=i.id
 WHERE i.dispatch_id=NEW.id AND o->>'id'=l.output_id AND o->>'dispatchItemId'=i.id::text))
 THEN RAISE EXCEPTION 'DISPATCH_EXTRA_MOVEMENT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

-- Serialize child changes with confirmation, and freeze delivered request facts.
CREATE OR REPLACE FUNCTION public.protect_confirmed_dispatch() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE parent uuid; parent_new uuid;
BEGIN
 IF TG_TABLE_NAME='dispatches' THEN
  IF OLD.status='CONFIRMADO' THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
 ELSE
  parent:=CASE WHEN TG_OP='INSERT' THEN NEW.dispatch_id ELSE OLD.dispatch_id END;
  PERFORM 1 FROM public.dispatches WHERE id=parent FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.dispatches WHERE id=parent AND status='CONFIRMADO')
  THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id THEN
   parent_new:=NEW.dispatch_id;
   PERFORM 1 FROM public.dispatches WHERE id=parent_new FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.dispatches WHERE id=parent_new AND status='CONFIRMADO')
   THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION public.freeze_delivered_request_quantity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.requests WHERE id=OLD.request_id FOR UPDATE;
 IF (NEW.quantity,NEW.unit,NEW.base_quantity,NEW.base_unit,NEW.product_snapshot,NEW.presentation,NEW.approved_quantity)
 IS DISTINCT FROM (OLD.quantity,OLD.unit,OLD.base_quantity,OLD.base_unit,OLD.product_snapshot,OLD.presentation,OLD.approved_quantity)
 AND EXISTS(SELECT 1 FROM public.dispatch_items WHERE request_item_id=OLD.id)
 THEN RAISE EXCEPTION 'DISPATCH_REQUEST_ITEM_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delivered_request_quantity_guard BEFORE UPDATE ON public.request_items
FOR EACH ROW EXECUTE FUNCTION public.freeze_delivered_request_quantity();
CREATE INDEX dispatch_items_dispatch_request_idx ON public.dispatch_items(dispatch_id,request_item_id);
CREATE FUNCTION public.protect_new_dispatch_link() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE parent uuid;
BEGIN
 SELECT dispatch_id INTO parent FROM public.dispatch_items WHERE id=NEW.dispatch_item_id;
 PERFORM 1 FROM public.dispatches WHERE id=parent FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.dispatches WHERE id=parent AND status='CONFIRMADO')
 THEN RAISE EXCEPTION 'CONFIRMED_DISPATCH_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dispatch_new_link_guard BEFORE INSERT ON public.dispatch_inventory_links
FOR EACH ROW EXECUTE FUNCTION public.protect_new_dispatch_link();
COMMIT;
