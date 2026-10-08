# Informe de implementación — Fase 1

Fecha: 8 de octubre de 2026. Proyecto: AGRÍCOLA JAPURIMA S.A.
Rama de desarrollo: `codex/fase1-seguridad-almacen`. Cambios locales sin despliegue ni publicación.
No se conectó ni modificó PostgreSQL de producción. No se ejecutó la migración SQL.
No se creó una cuenta real predeterminada. Los usuarios de pruebas se crean únicamente en carpetas temporales.

## Respaldo y conservación

Antes del primer cambio se respaldaron 18 archivos originales y todos los datos locales, con SHA-256,
manifiesto y bundle Git verificado. Carpeta: `backups/fase1-pre-20261008-111739`.
Restauración ejecutada en `backups/restauracion-verificada-pre-fase1`, una carpeta nueva independiente.
El inventario original, el respaldado y el restaurado son idénticos byte por byte. Se conserva sin cambios
`data/inventory.json` (2028 bytes), con 3 productos, 2 compras y 2 salidas. El archivo histórico de tres bytes
no se utilizó como respaldo de datos. No se inició la nueva aplicación con el DATA_DIR real durante las pruebas.

## Archivos modificados

- `server.js`: servidor modular, autorización, API, seguridad HTTP, acceso público limitado y arranque sin DDL.
- `app.js`: reglas compartidas, sesión/rol/CSRF, versiones, idempotencia y recuperación de guardados.
- `index.html`: acceso público, Usuarios, panel de recuperación y carga de reglas compartidas.
- `styles.css`: estilos adicionales, restricciones visuales de rol y adaptación de vistas nuevas mínimas.
- `package.json`, `package-lock.json`: versión 1.1.0 y comandos; sin nuevas dependencias directas.
- `.env.example`: configuración sin usuarios/contraseñas por defecto.
- `.gitignore`: exclusión de respaldos y almacenamiento privado nuevo.
- `iniciar-sistema.bat`: elimina autenticación por defecto y evita imprimir contraseñas.
- `render.yaml`: configuración preparada para HTTPS/origen y autenticación nueva; no desplegada.
- `README.md`, `PUBLICAR.md`: instrucciones actualizadas, sin acceso predeterminado inseguro.

## Archivos creados

- `src/errors.js`: errores públicos controlados y comprobación de rol.
- `src/security.js`: hash scrypt, tokens aleatorios, comparación segura y proyección de usuario.
- `src/database.js`: pool PostgreSQL con verificación SSL remota.
- `src/inventory-service.js`: validación del cambio respecto del estado histórico.
- `src/services.js`: autenticación, usuarios, escritura idempotente, solicitudes públicas y auditoría.
- `src/store.js`: repositorios PostgreSQL y archivo local transaccional con bloqueo de proceso.
- `shared/inventory-rules.js`: mismas reglas de cálculo y conversión para navegador/servidor.
- `migrations/001_phase1.sql`: migración relacional incremental.
- `users.js`: administración básica de usuarios con crear, rol, estado y cambio de contraseña.
- `public.html`, `public.js`: registro de una línea y consulta pública mínimos, con recibo privado.
- `scripts/backup.cjs`: respaldo, verificación y restauración en carpeta nueva.
- `scripts/check.cjs`, `scripts/test.cjs`: sintaxis y pruebas portables.
- `scripts/create-admin.cjs`: bootstrap privado e interactivo.
- `scripts/migrate.cjs`: migración explícita con checksum y confirmación de destino.
- `scripts/runtime-permissions.sql`: plantilla de permisos para una cuenta SQL de ejecución separada.
- `scripts/preview-test.cjs`: vista previa aislada con datos y cuentas exclusivamente de prueba.
- `test/helpers.js`, `test/api.test.js`, `test/inventory.test.js`, `test/frontend.test.js`,
  `test/postgres.test.js`: pruebas de seguridad, integridad, concurrencia, recuperación y PostgreSQL.
- `docs/FASE1.md`: instalación, contratos, restauración y límites.
- `docs/pruebas-fase1.txt`: salida de la batería final de pruebas.
- `docs/INFORME_FASE1.md`: este informe.

## Implementado

Usuarios ADMINISTRADOR/ALMACENERO independientes; permisos exigidos en el servidor y reflejados en la interfaz.
Contrasenas hasheadas con scrypt y salt individual; sesiones persistentes con tokens almacenados como hash,
expiración, revocación y cookies HttpOnly/SameSite/Secure en producción. CSRF, comprobación de origen,
limitación de intentos, consultas parametrizadas y ausencia de exposición de archivos privados.

La escritura antigua también usa transacción, bloqueo de fila PostgreSQL, versión obligatoria e ID de operación.
Rechaza sobrescrituras y repeticiones con distinto contenido; repeticiones idénticas no crean movimientos nuevos.
Valida cantidades, stock por presentación, referencias, fechas, conversiones, asignaciones y dosis en servidor.
Conserva datos históricos intactos y evita reinterpretarlos mediante cambio de unidad/presentación.

El navegador conserva copia pendiente y formulario ante error; no anuncia éxito antes de confirmarlo.
Permite reintentar o descargar copia y cargar estado actual para conciliación manual. No aplica fusión automática.

Auditoría transaccional para cambios de inventario y usuarios, login/logout y creación pública de solicitudes.
Las contraseñas, tokens de sesión y claves privadas de solicitudes no se registran en auditoría.

Se conservaron productos, compras, salidas, existencias, Kardex, CSV/XLSX e impresión. Reglas y exportador
se comprobaron con regresión automatizada. La eliminación que deja saldo negativo ahora es rechazada.

## Migraciones preparadas, no ejecutadas

`001_phase1.sql` agrega `inventory_state.version` y crea:
`schema_migrations`, `users`, `sessions`, `requests`, `request_items`, `dispatches`, `dispatch_items`,
`dispatch_inventory_links`, `inventory_writes`, `audit_events` e índices asociados.
No migra productos fuera del JSONB ni modifica destructivamente su contenido.
La relación SQL salida/detalle y la clave idempotente de despacho tienen unicidad; su flujo operativo no está
implementado todavía. El arranque del servidor comprueba el esquema y no aplica migraciones automáticamente.

## Pruebas y resultados

Sintaxis: aprobada mediante `node scripts/check.cjs`.
Pruebas: 31 casos, 30 aprobados, 0 fallos, 1 omitido. Véase `docs/pruebas-fase1.txt`.
Se probaron autenticación, hashes, CSRF, roles, cookies, revocación, expiración, último administrador,
archivos privados, límites de login, conflictos concurrentes, reintentos, rollback, validaciones de inventario,
registro/consulta pública, historia real, conversiones, Kardex, XLSX y recuperación del navegador en VM.
El mensaje de error interno en la salida es intencional: prueba de rollback al fallar auditoría.

La prueba omitida requiere PostgreSQL real local y vacío, con TEST_DATABASE_URL restringida. No había una
base local habilitada. El contrato SQL transaccional se probó con cliente simulado; esto no sustituye probar
DDL, restricciones y concurrencia contra PostgreSQL real antes de activar esa modalidad.

Respaldo: hashes y Git bundle aprobados; restauración en carpeta independiente aprobada.
`git diff --check`: aprobado. Inventario original intacto tras todas las pruebas.
Vista previa: arrancó solo con almacenamiento temporal. El navegador de control falló al inicializarse por
el entorno; no se declara prueba visual realizada. Se conserva la identidad CSS y se documentó QA visual pendiente.

## Pendiente y riesgos

- Flujo completo de aprobación, reservas, entregas parciales, confirmación de despacho e interfaces operativas.
- Prueba con PostgreSQL real y revisión visual de escritorio/móvil antes de activar en staging.
- Alta de administrador real por el operador, con contraseña privada, y permisos SQL mínimos.
- Autorización adicional, respaldo PostgreSQL restaurado y ventana de mantenimiento para producción.
- JSONB sigue siendo una sola fila con guardados completos y límite de 1 MiB por petición.
- Rate limiting es por instancia; múltiples instancias requieren coordinación externa.
- No hay gestión de stock por lote/FIFO/FEFO; inventario Number y entidades nuevas NUMERIC(20,6).
- sessionStorage puede fallar o perderse al cerrar; descargar el pendiente es necesario si no se puede confirmar.
- Auditoría/sesiones/recibos requieren política de retención futura.
- Rollback al código antiguo no puede ejecutarse junto a escritores nuevos; un dump antiguo no debe borrar
  movimientos posteriores. Conservar tablas nuevas y preferir corrección compatible hacia delante.

## Activación exacta

Desarrollo local: seguir los comandos de `docs/FASE1.md`: comprobar variables, `npm ci`, `npm run check`,
`npm test`, `npm run create-admin`, `npm start`. Con el runtime actual y pg ya instalado, usar los equivalentes
`node scripts/check.cjs`, `node scripts/test.cjs`, `node scripts/create-admin.cjs`, `node server.js`.
No hay una contraseña inicial entregada: se solicita privadamente en terminal interactiva.

PostgreSQL de desarrollo: definir DATABASE_URL de una base dedicada, aplicar
`node scripts/migrate.cjs --confirm-target HOST/BASE`, crear administrador y probar.
No se importa automáticamente el inventario local a una base nueva. Para producción es obligatorio el proceso
separado documentado en `PUBLICAR.md` y autorización adicional; no se realizó ningún despliegue.
