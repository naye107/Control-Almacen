# Fase 1 — Instalación, arquitectura, respaldo y reversión

## Estado y alcance

Trabajo local en `codex/fase1-seguridad-almacen`. Sin publicación ni conexión/migración de producción.
Se mantienen el JSONB de inventario y las pantallas existentes. Se han separado HTTP, servicios,
almacenamiento, seguridad y reglas compartidas. No se implementan pantallas operativas completas de
solicitudes/despachos ni confirmación real de despachos en esta fase.

## Respaldo previo verificable y restauración comprobada

Respaldo previo: `backups/fase1-pre-20261008-111739/`.
Contiene 18 archivos originales, datos locales, manifiesto SHA-256 y `repository.bundle` con historial Git.
El supuesto respaldo histórico de tres bytes se conserva solo como archivo original; no es fuente de datos.
Se verificaron todos los hashes y el bundle. Se restauró en una carpeta nueva:
`backups/restauracion-verificada-pre-fase1/`. Su inventario coincide byte por byte con el original.
SHA-256 del inventario original:
`9DA4530C9BE96639F783631222673D0B76F57B08FE077D4F386E82ED12276BA9`.

Verificar otra vez, desde la raíz del proyecto:

```powershell
node scripts/backup.cjs --verify backups/fase1-pre-20261008-111739
```

Restaurar a una carpeta que NO exista (no reemplaza el proyecto actual):

```powershell
node scripts/backup.cjs --restore backups/fase1-pre-20261008-111739 'C:\ruta\nueva\japurima-restaurado'
```

Después, revise configuración y datos antes de `npm ci` e iniciar. El código restaurado es anterior a Fase 1,
con seguridad antigua; no debe exponerse públicamente. Cambiar de rama no basta para revertir archivos sin commit.

Para nuevos respaldos locales, detenga el servidor y ejecute `npm run backup` o `node scripts/backup.cjs`.
El comando rechaza el respaldo si está activo el bloqueo del almacenamiento local. Incluye el nuevo archivo
`phase1.json` cuando exista. Proteja el respaldo: puede contener datos, hashes, sesiones y configuración privada.
No se respalda `node_modules`; las dependencias se recuperan con el lockfile y `npm ci`.
Este respaldo de archivos NO respalda PostgreSQL. Para PostgreSQL es obligatorio un dump consistente separado.

## Activar en desarrollo con datos locales

Abra PowerShell en la raíz. Use Node.js >=20 con npm instalado. El entorno de ejecución de Codex aquí
proporciona Node v24.19.0 pero no un comando npm; se ejecutaron los comandos equivalentes con Node.

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
$env:HOST = '127.0.0.1'
$env:PORT = '8080'
npm ci
npm run check
npm test
npm run create-admin
npm start
```

`create-admin` necesita una terminal interactiva: solicita usuario, contraseña de al menos 12 caracteres
sin mostrarla y confirmación. No admite una cuenta ADMINISTRADOR existente ni introduce una clave por defecto.
Debe ejecutarse con el servidor local detenido porque ambos comparten el bloqueo del almacén.
Abra http://localhost:8080. Gestión de usuarios: menú Usuarios del ADMINISTRADOR.
Acceso público mínimo: http://localhost:8080/public.html.

Equivalentes si pg ya está instalado y solo existe Node:

```powershell
node scripts/check.cjs
node scripts/test.cjs
node scripts/create-admin.cjs
node server.js
```

La inicialización local lee `data/inventory.json` y crea `data/phase1.json` sin alterar el primero.
A partir de ahí `phase1.json` es la fuente de verdad local. Incluye estado/version y entidades nuevas en una
única escritura temporal/renombrado; los fallos de validación o auditoría no persisten resultados parciales.
No vuelva al archivo legado para recuperar movimientos nuevos: necesita el `phase1.json` actualizado.

Si hay un cierre abrupto puede quedar `data/.phase1.lock`. No lo borre mientras exista un proceso servidor
usando ese DATA_DIR. Verifique procesos/servidores, respalde los archivos y, solo con todos detenidos, retire
ese archivo de bloqueo. Un JSON corrupto provoca error de inicio; no se sustituye por un inventario vacío.

## Activar con PostgreSQL de desarrollo

Use una base dedicada de desarrollo; no copie aquí una cadena de producción. Ejemplo conceptual:

```powershell
$env:DATABASE_URL = 'postgresql://USUARIO:CLAVE@localhost:5432/japurima_dev'
$env:NODE_ENV = 'development'
node scripts/migrate.cjs --confirm-target localhost/japurima_dev
node scripts/create-admin.cjs
node server.js
```

Reemplace las credenciales en su entorno privado. No las guarde en scripts, commits ni informes.
Los archivos `.env.example` no se cargan automáticamente. Puede utilizar variables de sesión PowerShell.

En una base existente, la migración conserva la fila y su JSONB. En una base nueva empieza vacío; no se importa
silenciosamente el archivo local a PostgreSQL. Una importación de datos reales requerirá un procedimiento
explícito y validado por separado.

Migración preparada: `migrations/001_phase1.sql`. Runner: `scripts/migrate.cjs`.
Añade versión a inventory_state y crea schema_migrations, users, sessions, requests, request_items,
dispatches, dispatch_items, dispatch_inventory_links, inventory_writes y audit_events.
No hay DROP, TRUNCATE ni UPDATE de datos históricos en la migración. El runner usa transacción, bloqueo asesor,
checksum y registro de migración. Repetirlo con el mismo checksum no reaplica; un checksum cambiado se rechaza.
La cuenta de migración requiere permisos de DDL. El servidor usa una cuenta diferente sin permisos DDL.

Producción exige autorización adicional, respaldo restaurado, ventana de mantenimiento y los flags explícitos
`--confirm-target HOST/BASE --allow-production` para migración o `--allow-production` para bootstrap. No ejecutar
estos comandos contra producción durante la Fase 1 autorizada.
El arranque de la aplicación solo verifica el esquema con SELECT; no ejecuta la migración.

## Roles y seguridad

- ADMINISTRADOR: inventario, productos, compras, salidas, Kardex, exportaciones, usuarios, solicitudes y auditoría.
- ALMACENERO: consultas de inventario/Kardex y consulta privada de solicitudes. Despachos tendrá su endpoint
  específico en la fase siguiente; no puede escribir por POST /api/state ni administrar usuarios.
- Público: catálogo mínimo sin stock, registro de solicitud y consulta de su estado con código y clave privada.

Contraseñas: scrypt con salt aleatorio, N=32768, r=8, p=1, salida de 64 bytes, límite de memoria explícito.
La longitud permitida es 12–256 caracteres. Sesiones aleatorias de 256 bits: en almacenamiento solo su SHA-256.
Expiran en 12 horas. Logout y cambio de contraseña/rol/estado revocan sesiones.
No se permite desactivar/degradar el último administrador activo.

Cookies HttpOnly, SameSite=Strict y Secure obligatorio en producción. CSRF requerido en POST/PATCH privados.
Se verifica Origin y sec-fetch-site. En producción PUBLIC_ORIGIN debe ser el origen HTTPS exacto, sin barra final.
Conexiones PostgreSQL remotas verifican certificados y no admiten sslmode=disable.
La cuenta de ejecución debe tener SELECT/INSERT/UPDATE en las tablas correspondientes y solo SELECT/INSERT en
`audit_events`. No otorgar UPDATE/DELETE de auditoría al usuario de aplicación. No hay endpoint para borrarla.

El límite de intentos es por IP/grupo, en memoria por instancia. Si se despliega en varias instancias se necesita
un limitador compartido o protección del proxy. TRUST_PROXY=1 requiere que el proxy sobrescriba correctamente
X-Forwarded-For; fuera de ese entorno déjelo desactivado. No exponer el servidor de desarrollo HTTP a Internet.

## Contrato de inventario y recuperación del navegador

GET /api/state devuelve JSON y X-State-Revision. POST /api/state acepta el JSON legado pero requiere:
X-State-Revision, X-Operation-Id (UUID) y X-CSRF-Token, además de la sesión ADMINISTRADOR.
Dentro de una transacción se bloquea inventory_state id=1, se verifica sesión/rol otra vez, se comprueba el
identificador de operación, la versión y las reglas; se escriben estado, versión, recibo y auditoría juntos.

- 428: versión ausente.
- 409 STATE_CONFLICT: otro escritor avanzó la versión; no se reemplaza su estado.
- 409 IDEMPOTENCY_CONFLICT: identificador reutilizado para otro contenido/actor.
- 422: datos, stock o conversiones inválidos.
- 401/403: sesión, rol o CSRF inválidos.

Un reintento idéntico devuelve el recibo sin una nueva salida. El navegador conserva la copia pendiente en
sessionStorage por usuario, restaura su última copia confirmada en memoria y mantiene el formulario. Se puede
reintentar con el mismo ID o descargar la copia y cargar estado actual para conciliación manual.
No hay fusión automática de estados conflictivos. Si falla el almacenamiento del navegador, conserve la página
abierta y descargue la copia pendiente antes de cerrarla. Pestañas antiguas sin versión no pueden guardar.
La sincronización periódica no pisa una operación pendiente ni formularios con edición detectada.

Validaciones del servidor: cantidades finitas/positivas, IDs únicos, productos, fechas, campos autorizados,
unidades físicas, sumas de asignaciones/dosis y saldo por presentación. Bloquea faltantes nuevos o agravados.
Tolera formatos históricos intactos y conserva extensión histórica en el JSONB.
La etiqueta histórica bidones no se cambia silenciosamente a galones.
Productos con historial no pueden cambiar unidad/presentación ni eliminarse; las salidas vinculadas a despacho
no pueden editarse/eliminarse por el guardado legado. Las eliminaciones administrativas autorizadas de otros
movimientos conservan copia anterior en auditoría; no se elimina información mediante esta implementación.

## Acceso público mínimo

GET /api/public/catalog: ID/nombre/presentación/unidad de productos disponibles; sin cantidades.
POST /api/public/requests: requester, destination, notes e items, más operationId UUID y privateKey aleatoria.
El formulario genera ambos antes de enviar y conserva el intento para reintentos. La clave solo se almacena
como hash en el servidor; código/clave se pueden descargar como recibo privado.
POST /api/public/requests/status recibe código/clave en el cuerpo, nunca en la URL. La respuesta contiene solo
código, estado, fecha e items de esa solicitud; no devuelve solicitante, destino, usuarios, inventario ni hashes.
No hay actualización, aprobación, listado público ni despacho público. Registrar no descuenta ni reserva stock.

## Preparación de despachos y pendientes

Las tablas tienen restricciones de cantidades, relaciones SQL y claves únicas para evitar duplicación de
confirmación y de enlace salida/detalle. Los product_id referencian IDs del JSONB: no existe FK SQL hacia esos
objetos; su existencia se valida en el servicio y se preserva una instantánea descriptiva.

Pendiente para fases posteriores: flujo de aprobación, reservas, entregas parciales, interfaz de almacenero,
confirmación transaccional de despacho y documentos de entrega. Esa confirmación deberá usar el mismo bloqueo
inventory_state, la misma validación y una transacción para despacho, salidas, enlaces y auditoría. El esquema
por sí solo no implementa ese flujo; actualmente no existe un endpoint operativo de confirmación de despacho.

## Pruebas

`node scripts/test.cjs` ejecuta seguridad/API con HTTP real y almacenamiento temporal, reglas de inventario,
regresión de Kardex/XLSX, recuperación del navegador en VM y contrato BEGIN/FOR UPDATE/COMMIT/ROLLBACK del
repositorio PostgreSQL. No acceden al almacén real, salvo lectura del inventario histórico para regresión.
El fallo de auditoría inyectado produce intencionalmente un error interno de prueba y verifica rollback.

La prueba PostgreSQL real es opcional y está bloqueada salvo TEST_DATABASE_URL a localhost/127.0.0.1,
una base VACÍA cuyo nombre coincida con japurima_*test y una URL distinta de DATABASE_URL:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USUARIO:CLAVE@localhost:5432/japurima_fase1_test'
node --test test/postgres.test.js
Remove-Item Env:TEST_DATABASE_URL
```

No borra bases/tablas existentes; deja datos de prueba para inspección. Una nueva ejecución real requiere otra
base de pruebas vacía. No ejecute esta prueba con una base de producción ni una copia con información real.
La integración PostgreSQL real no se ejecutó aquí por ausencia de servidor/base local habilitados.

El control del navegador de esta sesión no pudo inicializarse por un fallo del entorno; no se declara QA visual
realizada. Se conservó CSS existente y se probaron funciones del navegador en VM. Antes de activar en staging,
verifique escritorio/móvil, login, Usuarios, panel de recuperación y formulario público.

## Reversión

Antes de nuevas operaciones: detener servicio, restaurar el respaldo en otra carpeta y comprobar la versión.
Después de nuevas operaciones: no restaurar un dump antiguo encima del estado actual. Primero obtener respaldo
actual, conciliar movimientos y conservar usuarios/solicitudes/auditoría. Preferir desactivar rutas nuevas o
corregir hacia delante manteniendo tablas y control de versión. El servidor anterior no respeta los bloqueos ni
la versión: no puede convivir como escritor con Fase 1. No hay migración descendente destructiva automática.

## Limitaciones conocidas

JSONB completo: sigue existiendo límite de 1 MiB por petición y bloqueo de una sola fila. A mayor volumen se
necesitarán operaciones más granulares. El inventario usa Number con tolerancia para conversión; las cantidades
relacionales usan NUMERIC(20,6). No se migra todo el inventario ni se introduce contabilidad por lote/FIFO/FEFO.
Auditoría/sesiones/recibos crecen: definir mantenimiento y retención con respaldo antes de producción.
El almacenamiento local es para desarrollo y un solo proceso; producción usa PostgreSQL y HTTPS.

Se incluye `scripts/runtime-permissions.sql` como plantilla psql de permisos mínimos. No se ejecutó.
Debe utilizar una cuenta de ejecución ya creada que no sea propietaria ni superusuario ni herede el rol de
migración. Revoque privilegios heredados incompatibles. La migración no crea contraseñas ni roles PostgreSQL.

Resultado final de pruebas registradas: 31 casos, 30 aprobados, 0 fallos, 1 omitido (PostgreSQL real).
El runner `scripts/test.cjs` enumera archivos explícitos para compatibilidad con Node 20 y PowerShell.
