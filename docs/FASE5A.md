# Fase 5A — preparación técnica de producción

Versión 1.5.0. Rama: codex/fase5a-preparacion-produccion. Esta entrega no autoriza la Fase 5B, publicaciones, cambios de credenciales ni conexiones a producción.

## Recuperación de las Fases 1–4

- Respaldo completo: backups/fase1-2026-10-08T21-11-05-426Z.
- 159 archivos, incluidos datos locales y cambios sin commit, con tamaños y SHA-256.
- Restauración independiente: backups/restauracion-fase4-verificada; los 159 archivos fueron comparados contra el manifiesto.
- Commit de recuperación: 9210758; etiqueta codex/fase4-recuperacion-20261008.
- El respaldo es privado y puede contener configuración sensible. No subirlo a Git ni a una carpeta pública. No constituye un respaldo de Neon.

Para verificar o recuperar el paquete, desde la raíz y con Node.js 24.19.0:

~~~powershell
node scripts/backup.cjs --verify backups/fase1-2026-10-08T21-11-05-426Z
node scripts/backup.cjs --restore backups/fase1-2026-10-08T21-11-05-426Z backups/otra-restauracion-fase4
~~~

El destino debe ser nuevo. Una restauración conserva configuraciones del estado antiguo: revisar el destino de la conexión antes de iniciar cualquier servidor. La etiqueta Git conserva código; el paquete conserva también los datos locales ignorados por Git.

## Configuración y límites

Node.js 24.19.0 LTS está fijado en package.json, .node-version, .nvmrc y la plantilla Render. .npmrc exige compatibilidad de motor. package-lock.json conserva las dependencias.

| Configuración | Valor predeterminado | Alcance |
|---|---:|---|
| DB_STATEMENT_TIMEOUT_MS | 15000 | Cada consulta de la transacción de aplicación |
| DB_LOCK_TIMEOUT_MS | 3000 | Espera por bloqueo en PostgreSQL |
| DB_IDLE_TRANSACTION_TIMEOUT_MS | 10000 | Transacción inactiva |
| Conexión PostgreSQL | 5000 ms | Adquisición/conexión; pool máximo 10 |
| HTTP_BODY_KIB | 128 | Login, solicitudes y otras mutaciones |
| INVENTORY_BODY_MIB | 16 | Guardado JSONB completo, exclusivamente ADMINISTRADOR |
| DOCUMENT_CONCURRENCY | 2 | Trabajos compartidos de PDF y reportes/Excel |
| Cola documental | 8; 5000 ms | Cola acotada, rechazo recuperable |
| RESOURCE_RSS_LIMIT_MIB | 768 | Umbral de admisión por RSS |
| Inventario HTTP | 2 activos; 28 en espera; 5000 ms | Lecturas/guardados completos |
| Peticiones HTTP | 32 activas | Rechazo cuando no hay capacidad |

El umbral RSS es una defensa de admisión, no una garantía de límite total de memoria. PDF permite hasta 100 líneas de origen, 256 KiB de snapshot, 30 páginas y 5 MiB finales. Los reportes limitan origen a 8 MiB por conjunto consultado, 2000 solicitudes, 20000 detalles/filas y 1 MiB de contenido de filas para construir Excel, además de 16 MiB finales. Si se supera un límite, reducir el periodo o revisar capacidad; no devolver un archivo truncado.

El catálogo y solicitudes no requieren sesión. Se permiten 60 registros por minuto/IP para redes compartidas. Login limita IP a 60/minuto y cada nombre de cuenta a 10/minuto; el hash de cuenta no se registra. Los mapas de limitación están acotados a 10000 claves y siguen siendo locales a cada proceso. Verificar el proxy real antes de activar TRUST_PROXY=1; múltiples instancias requieren una política compartida futura.

/api/health comprueba el proceso HTTP; /api/ready comprueba acceso a la fila del inventario y comunica indisponibilidad con 503. La comprobación DB tiene 3000 ms de límite y una caché positiva de un segundo. MAINTENANCE_MODE=1 bloquea mutaciones y emisión PDF; permite consultas y readiness para un despliegue mantenido fuera del tráfico público. SIGTERM activa drenaje antes de cerrar conexiones. Mantenimiento interno no detiene servidores antiguos.

Los tiempos SQL se establecen localmente dentro de cada transacción, para no depender de ajustes de sesión permanentes a través de PgBouncer. Errores de bloqueo, cancelación, deadlock o desconexión se traducen a errores recuperables. No se reejecutan automáticamente transacciones con commit incierto: usar la misma operación idempotente y contenido. No generar otra operación para un resultado desconocido.

## Protocolo de inventario e integridad

005_production_hardening.sql añade un trigger que exige versión anterior + 1 y el marcador transaccional phase5a. El guardado del servidor establece el marcador dentro de la consulta UPDATE. El UPSERT anterior, incluso con sesión DB viva, se rechaza. También se prohíben DELETE y TRUNCATE del inventario. El marcador distingue protocolos; no es un secreto ni sustituye los roles restringidos. Un propietario puede desactivar triggers: sus credenciales no deben estar en el servicio web.

Se comprueban cambios de detalle entre despachos y pertenencia a la solicitud; se protegen referencias ya utilizadas; una confirmación requiere salidas enlazadas a todos sus detalles. La protección JSONB de salidas se implementa como comparación por conjuntos. No se actualiza, elimina ni transforma el inventario al aplicar la migración.

El migrador reconoce checksums históricos con LF o CRLF y registra nuevas versiones con LF normalizado. No modifica registros de checksum anteriores. Las migraciones 001–004 se conservaron sin editar.

El CSV neutraliza texto con prefijos de fórmula/control, conserva comillas y números. El PDF existente se verifica contra SHA-256 antes de descargar; si falla, no se reemplaza silenciosamente. Dentro del proceso, peticiones simultáneas del mismo PDF comparten generación después de validar acceso; cada participante vuelve a comprobar autorización.

## Pruebas reproducibles

No utilizan credenciales ni datos de producción. Los datos históricos de prueba son ficticios, en test/fixtures/legacy-inventory.json; el inventario privado no forma parte del repositorio.

Requisitos: Node.js 24.19.0; npm; binarios PostgreSQL 17 compatibles (initdb, pg_ctl, pg_dump, pg_restore); Chrome para la prueba visual. En este equipo están disponibles PostgreSQL 17.6 y Chrome. En otro equipo configurar PG_BIN_DIR a una instalación local equivalente.

~~~powershell
node --version
npm ci
npm run check
npm test
$env:PG_BIN_DIR = (Resolve-Path '.tools/postgres/pgsql/bin').Path
npm run test:phase5a
~~~

npm test omite la integración PostgreSQL si no existe TEST_DATABASE_URL. test:phase5a crea un cluster nuevo y bases desechables exclusivamente en 127.0.0.1, genera contraseñas aleatorias y vacía DATABASE_URL en los procesos de prueba. No necesita editar .env. Ejecuta integración, cuentas restringidas, aislamiento de escritor antiguo, SQL, recuperación y Chrome. El propietario de prueba puede crear roles; una instalación PostgreSQL remota no es necesaria. Las bases de ensayo quedan en .test-runtime y su servidor se detiene al terminar.

La carga usa 30 cuentas diferentes y 90 peticiones en tres rondas, con consultas de inventario/solicitudes, PDF y Excel. Concurrencia de mutaciones, despachos y reintentos se verifica adicionalmente. Las métricas son del proceso Node local durante la carga y no equivalen a 30 usuarios escribiendo inventario simultáneamente ni a una prueba en Render.

Para verificar el commit desde un árbol limpio:

~~~powershell
npm run release:check
~~~

Para inspección explícita futura, configurar INSPECT_DATABASE_URL y ejecutar scripts/preflight.cjs --confirm-target HOST/BASE. El script no utiliza DATABASE_URL por defecto y trabaja en transacción READ ONLY. Conexiones remotas requieren además --allow-remote-readonly y autorización específica del usuario. No ejecutarlo ahora contra Neon. Registra tamaños, huellas, propietarios y conexiones sin imprimir JSONB, claves ni texto de consultas.

## Prueba manual local separada

Usar una base PostgreSQL nueva de desarrollo con cuenta migradora. Configurar DATABASE_URL explícitamente y verificar que el host sea 127.0.0.1. Ejecutar npm run migrate -- --confirm-target 127.0.0.1/NOMBRE_BASE. Crear una cuenta de aplicación no propietaria y aplicar scripts/runtime-permissions.sql mediante psql, pasando app_role. Cambiar DATABASE_URL a esa cuenta. Ejecutar npm run create-admin en terminal interactiva: contraseña personal de al menos 12 caracteres, sin valores predeterminados. Iniciar npm start. Portada en http://127.0.0.1:8080 y almacén en /index.html.

La base nueva comienza vacía. Para probar productos, registrarlos mediante ADMINISTRADOR. Nunca cargar el inventario privado local en una base compartida sin una decisión explícita. Alternativamente, DATA_DIR puede apuntar a una carpeta nueva con datos ficticios para FileStore; producción exige PostgreSQL.

## Pendientes de autorización para Fase 5B

- Inspeccionar esquema, versión, volumen y escritores de Neon real, incluidos procesos fuera de Render.
- Restaurar y ensayar una copia de producción en aislamiento; contrastar límites de 16 MiB y reportes con volumen real.
- Comprobar roles, TLS, cadena de proxy, región, configuración y plan efectivos.
- Aplicar y verificar la separación de propietarios/migrador/aplicación y aislar credenciales antiguas durante la ventana aprobada.
- Validar Firefox, Safari/iOS, dispositivos físicos e impresión física.
- Configurar almacenamiento externo cifrado, retención, recuperación temporal, alertas y responsables. No se contrató ningún servicio.
- Medir carga en infraestructura equivalente, con volumen real anonimizado, y actualizar Node.js si existe un parche LTS posterior antes de publicar.
- Autorizar expresamente migraciones y despliegue. La plantilla render.yaml no se aplicó.
