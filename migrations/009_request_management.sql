BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(74182026);
CREATE SEQUENCE public.request_number_seq AS bigint;
ALTER TABLE public.requests ADD COLUMN request_number bigint;
ALTER TABLE public.requests ADD COLUMN edit_revision bigint NOT NULL DEFAULT 1 CHECK(edit_revision>0);
WITH numbered AS (SELECT id,row_number() OVER(ORDER BY created_at,id) AS n FROM public.requests)
UPDATE public.requests r SET request_number=n.n FROM numbered n WHERE n.id=r.id;
SELECT setval('public.request_number_seq',coalesce((SELECT max(request_number) FROM public.requests),0)+1,false);
ALTER TABLE public.requests ALTER COLUMN request_number SET DEFAULT nextval('public.request_number_seq');
ALTER TABLE public.requests ALTER COLUMN request_number SET NOT NULL;
ALTER TABLE public.requests ADD CONSTRAINT requests_number_unique UNIQUE(request_number);
ALTER TABLE public.requests ADD CONSTRAINT requests_number_positive CHECK(request_number>0);
ALTER SEQUENCE public.request_number_seq OWNED BY public.requests.request_number;
GRANT USAGE,SELECT ON SEQUENCE public.request_number_seq TO japurima_app_v160;
CREATE TABLE public.request_public_actions(operation_id uuid PRIMARY KEY,request_id uuid NOT NULL REFERENCES public.requests(id),payload_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON public.request_public_actions FROM PUBLIC;
GRANT SELECT,INSERT ON public.request_public_actions TO japurima_app_v160;
CREATE FUNCTION public.freeze_request_action() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'REQUEST_ACTION_IMMUTABLE' USING ERRCODE='23514'; END $$;
CREATE TRIGGER request_action_guard BEFORE UPDATE OR DELETE ON public.request_public_actions FOR EACH ROW EXECUTE FUNCTION public.freeze_request_action();

-- A narrow replacement routine avoids granting arbitrary DELETE on request items.
CREATE FUNCTION public.replace_pending_request(p_id uuid,p_revision bigint,p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.requests; i jsonb;
BEGIN
 SELECT * INTO r FROM public.requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.dispatch_revision<>p_revision OR r.status NOT IN ('PENDIENTE','REGISTRADA','APROBADA')
 OR EXISTS(SELECT 1 FROM public.dispatches WHERE request_id=p_id)
 THEN RAISE EXCEPTION 'REQUEST_NOT_EDITABLE' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(p_data->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'items') NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'INVALID_REQUEST_ITEMS' USING ERRCODE='23514'; END IF;
 DELETE FROM public.request_items WHERE request_id=p_id;
 FOR i IN SELECT x FROM jsonb_array_elements(p_data->'items') x LOOP
  INSERT INTO public.request_items(id,request_id,product_id,product_snapshot,presentation,quantity,unit,line_number,dose_quantity,base_quantity,base_unit,dimension)
  VALUES((i->>'id')::uuid,p_id,i->>'productId',i->'productSnapshot',i->>'presentation',public.strict_quantity(i->>'quantity'),i->>'unit',(i->>'lineNumber')::int,CASE WHEN i->>'doseQuantity' IS NULL THEN NULL ELSE public.strict_quantity(i->>'doseQuantity') END,public.strict_quantity(i->>'baseQuantity'),i->>'baseUnit',i->>'dimension');
 END LOOP;
 UPDATE public.requests SET requester=p_data->>'requester',destination=p_data->>'destination',notes=p_data->>'notes',category=p_data->>'category',crop=p_data->>'crop',application_mode=p_data->>'applicationMode',container_count=CASE WHEN p_data->>'containerCount' IS NULL THEN NULL ELSE public.strict_quantity(p_data->>'containerCount') END,request_version=2,dispatch_revision=dispatch_revision+1,edit_revision=edit_revision+1,updated_at=now() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.replace_pending_request(uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_pending_request(uuid,bigint,jsonb) TO japurima_app_v160;
COMMIT;
