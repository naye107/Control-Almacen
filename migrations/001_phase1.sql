BEGIN;
SELECT pg_advisory_xact_lock(74182026);
CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS inventory_state (id integer PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE inventory_state ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
INSERT INTO inventory_state(id,data) VALUES(1,'{"products":[],"purchases":[],"outputs":[]}') ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('ADMINISTRADOR','ALMACENERO')), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf_token text NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS requests (
 id uuid PRIMARY KEY, code text NOT NULL UNIQUE, private_key_hash text NOT NULL,
 requester text NOT NULL, destination text NOT NULL, notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'REGISTRADA' CHECK(status IN ('REGISTRADA','APROBADA','RECHAZADA','PARCIAL','DESPACHADA','CANCELADA')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS request_items (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES requests(id), product_id text NOT NULL,
 product_snapshot jsonb NOT NULL, presentation text NOT NULL, quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 unit text NOT NULL, approved_quantity numeric(20,6) CHECK(approved_quantity>=0 AND approved_quantity<=quantity)
);
CREATE INDEX IF NOT EXISTS request_items_request_idx ON request_items(request_id);
CREATE TABLE IF NOT EXISTS dispatches (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES requests(id), user_id uuid NOT NULL REFERENCES users(id),
 idempotency_key text NOT NULL UNIQUE, payload_hash text NOT NULL,
 status text NOT NULL CHECK(status IN ('BORRADOR','CONFIRMADO','ANULADO')),
 created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);
CREATE TABLE IF NOT EXISTS dispatch_items (
 id uuid PRIMARY KEY, dispatch_id uuid NOT NULL REFERENCES dispatches(id), request_item_id uuid NOT NULL REFERENCES request_items(id),
 quantity numeric(20,6) NOT NULL CHECK(quantity>0), unit text NOT NULL, allocations jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS dispatch_inventory_links (
 dispatch_item_id uuid PRIMARY KEY REFERENCES dispatch_items(id), output_id text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS inventory_writes (
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), payload_hash text NOT NULL,
 result_version bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_events (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES users(id), action text NOT NULL, entity_id text,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events(created_at);
COMMIT;
