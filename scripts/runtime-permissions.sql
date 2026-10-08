-- Template for psql, run only with authorization and an already-created runtime role.
-- Example: psql CONNECTION -v app_role=japurima_app -f scripts/runtime-permissions.sql
-- The runtime role must NOT own tables, be superuser, or inherit the migration-owner role.
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT ON schema_migrations TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON inventory_state, users, sessions, requests, request_items,
 dispatches, dispatch_items, dispatch_inventory_links, inventory_writes TO :"app_role";
GRANT SELECT, INSERT ON audit_events TO :"app_role";
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM :"app_role";

-- Fase 3: confirmación mediante INSERT + transición BORRADOR a CONFIRMADO.
-- Los triggers impiden cambios posteriores de despachos, detalles y vínculos confirmados.
REVOKE DELETE, TRUNCATE ON dispatches, dispatch_items, dispatch_inventory_links FROM :"app_role";

-- Fase 4: documentos históricos inmutables.
GRANT SELECT, INSERT ON document_records TO :"app_role";
REVOKE UPDATE, DELETE, TRUNCATE ON document_records FROM :"app_role";

REVOKE DELETE, TRUNCATE ON inventory_state FROM :"app_role";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM :"app_role";
