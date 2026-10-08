# Fase 2 — Instalación y pruebas locales

## Alcance

La portada `/` permite registrar solicitudes, consultarlas con código y clave privada y entrar al almacén protegido en `/index.html`. El inventario sigue en JSONB en PostgreSQL o en `phase1.json` en el modo local. Los registros nuevos son relacionales en PostgreSQL. No se descuentan ni reservan existencias. No hay confirmación de despachos, entregas parciales, firmas ni PDF final.

## Respaldo y punto de recuperación

Rama de trabajo: `codex/fase2-solicitudes-publicas`. El respaldo se creó ANTES de modificar Fase 1 y contiene también sus cambios sin commit:

`backups/fase1-2026-10-08T16-55-43-304Z/`

Incluye 44 archivos, datos locales válidos, `manifest.json` con tamaños y SHA-256, `repository.bundle`, estado Git y parche de archivos rastreados. Los archivos nuevos sin commit están en las copias del manifiesto; un parche o cambiar de rama no basta para recuperarlos. El archivo histórico de tres bytes no se utilizó como fuente de inventario. Se comprobó la recuperación completa en `backups/restauracion-fase1-verificada/`.

```powershell
node scripts/backup.cjs --verify backups/fase1-2026-10-08T16-55-43-304Z
# La carpeta de destino debe NO existir:
node scripts/backup.cjs --restore backups/fase1-2026-10-08T16-55-43-304Z backups/otra-restauracion-fase1
```

El respaldo es privado y debe protegerse. No contiene `node_modules`; se reconstruye con `npm ci`. Los respaldos posteriores excluyen también `.tools` y `.test-runtime` (binarios y entornos desechables). El script no respalda PostgreSQL: para una base con información vigente hace falta un dump consistente independiente. No se conectó a producción para obtenerlo.

Para volver al punto de recuperación, detenga el servidor local, respalde primero cualquier información NUEVA y restaure en otra carpeta. No sustituya los datos actuales con datos viejos. No elimine las columnas de 002: las solicitudes nuevas deben conservarse. Si ya se habilitaron productos con `requestCategory`, Fase 1 anterior rechaza ese campo al guardar inventario; regresar solo el código exige una adaptación compatible o una corrección hacia adelante. No quite clasificaciones ni solicitudes para forzar el regreso. La recuperación exacta comprobada corresponde al código y los datos locales juntos en el momento del respaldo.

## Probar sin modificar los datos originales

Necesita Node >=20 y las dependencias del lockfile. Con npm instalado, ejecute `npm ci`. En este equipo se usó Node 24.19.0 del runtime de Codex y el módulo `pg` ya instalado; npm no está disponible como comando en PATH.

PowerShell, desde la raíz del proyecto:

```powershell
# Con una instalación normal puede sustituir la ruta siguiente por 'node'.
$nodeExe = 'C:\Users\LENOVO\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:PORT = '8080'
# Use una carpeta nueva para esta copia de desarrollo:
$taskDevData = Join-Path (Get-Location) '.test-runtime\manual-dev-data'
if (Test-Path -LiteralPath $taskDevData) { throw 'Elija otra carpeta nueva; no sobrescriba datos.' }
New-Item -ItemType Directory -Path $taskDevData | Out-Null
if (Test-Path -LiteralPath 'data\phase1.json') {
    Copy-Item -LiteralPath 'data\phase1.json' -Destination (Join-Path $taskDevData 'phase1.json')
} else {
    Copy-Item -LiteralPath 'data\inventory.json' -Destination (Join-Path $taskDevData 'inventory.json')
}
$env:DATA_DIR = $taskDevData
& $nodeExe scripts\check.cjs
& $nodeExe scripts\test.cjs
# Solo si esta copia todavía no tiene un administrador. Solicita la contraseña de forma oculta:
& $nodeExe scripts\create-admin.cjs
& $nodeExe server.js
```

Detenga el servidor original antes de copiar un `phase1.json` en uso. Si la copia ya tiene usuarios, utilice sus credenciales existentes y omita `create-admin`. No hay cuentas predeterminadas en la aplicación. Las cuentas fijas de pruebas solo existen dentro de carpetas temporales que los ensayos eliminan.

Abra `http://127.0.0.1:8080/`. Entre por **Acceso protegido a almacén** y, como ADMINISTRADOR, edite los productos que correspondan. El campo **Clasificación para solicitudes** permite **Agroquímicos**, **Herramientas** u **Otros productos**. Deje **No publicar en solicitudes** para los demás. Guarde mediante el mecanismo habitual, protegido por versión e idempotencia. El catálogo público solo usa productos `active === true`, no marcados vencidos y con clasificación expresa. Admite stock cero y no muestra saldos, costos ni movimientos. No se clasifican automáticamente los datos originales.

Prueba funcional: seleccione Agroquímicos, complete nombre, cultivo y lugar; use una sola modalidad y una cantidad general; añada productos con sus dosis/unidades. Revise los totales, envíe y guarde el comprobante TXT. Consulte con código y clave. Para Herramientas/Otros no aparecen dosis ni recipientes. Cerrar esta ventana pierde el almacenamiento de sesión del navegador: conserve el comprobante. Una copia pendiente de registro también puede descargarse si hay un fallo de red. Ese archivo contiene datos privados y debe protegerse.

## PostgreSQL local y migraciones

La aplicación no ejecuta DDL automáticamente. Para el modo PostgreSQL, deben estar aplicadas `001_phase1.sql` y `002_public_requests.sql`. 001 no fue modificada. Use una base exclusiva de desarrollo y una cuenta propietaria de migraciones separada de la cuenta de aplicación.

```powershell
$env:NODE_ENV = 'development'
# Introduzca sus credenciales de DESARROLLO; no use la URL de Neon.
$env:DATABASE_URL = 'postgresql://USUARIO_DESARROLLO:CLAVE_PRIVADA@127.0.0.1:5432/japurima_dev'
& $nodeExe scripts\migrate.cjs --confirm-target 127.0.0.1/japurima_dev
# Si falta el primer administrador de esa base:
& $nodeExe scripts\create-admin.cjs
& $nodeExe server.js
```

La URL de ejemplo es un marcador, no una cuenta funcional ni una clave predeterminada. Un esquema de Fase 1 conserva `inventory_state`, usuarios, sesiones, solicitudes y detalles. En una base vacía, 001 crea inventario vacío: este procedimiento no importa automáticamente los datos locales ni los datos de producción. Utilice los fixtures de pruebas para demostrar funcionalidades; una copia de datos empresariales debe planificarse y respaldarse por separado.

002 agrega columnas de categoría, cultivo, modalidad, número general de recipientes, versión, operación y huella del contenido. Amplía estados sin actualizar filas históricas. Los detalles incluyen orden, dosis, cantidad base, unidad base y dimensión. Los campos nuevos admiten NULL en registros antiguos; los nuevos se validan en SQL y en el servidor. El índice único de operación y el bloqueo de inventario serializan los reintentos y cambios del catálogo. El ejecutor aplica ambas migraciones en una transacción y comprueba hashes para evitar reescribir una migración ya aplicada.

La cuenta de ejecución puede configurarse con la plantilla `scripts/runtime-permissions.sql`, con una cuenta ya creada y fuera de producción. No use superusuario ni propietario de tablas para la aplicación.

## Ejecutar las pruebas reales de PostgreSQL

En este equipo están disponibles binarios portables en `.tools/postgres/pgsql/bin`. El ejecutor crea un clúster NUEVO, escucha solo en `127.0.0.1`, genera una contraseña aleatoria, crea una base vacía `japurima_*_test`, ejecuta todas las pruebas y detiene el clúster. No lee ni reutiliza `DATABASE_URL` y no borra bases existentes.

```powershell
& $nodeExe scripts\test-postgres.cjs
# En otro equipo, indique el directorio de binarios de una instalación local:
$env:PG_BIN_DIR = 'C:\ruta\PostgreSQL\bin'
& $nodeExe scripts\test-postgres.cjs
```

Se requiere `initdb`, `pg_ctl` y sus bibliotecas. La descarga usada provino de [EDB, binarios oficiales enlazados por PostgreSQL](https://www.enterprisedb.com/download-postgresql-binaries). PostgreSQL 17.6 se usó solo como motor de ensayo, sin instalar servicio Windows. Se conservan directorios de diagnóstico locales dentro de `.test-runtime`; no contienen URLs de acceso guardadas ni archivos de contraseña en texto plano. No son el respaldo de datos empresariales.

La opción manual `TEST_DATABASE_URL` solo admite localhost y nombre `japurima_*test`; el test rechaza una base que ya tenga `inventory_state`. `node scripts/test.cjs` omite exclusivamente la prueba real si falta esa variable. Esa omisión NO equivale a una validación PostgreSQL; el ejecutor anterior evita la omisión.

## Ejecutar pruebas de navegador y regenerar evidencias

```powershell
# Usa Chrome con un perfil NUEVO, una instancia headless y datos temporales ficticios.
# El ejecutor de navegador necesita Node >=22 con WebSocket global; se verificó con Node 24.19.0.
& $nodeExe scripts\test-browser.cjs
# Si Chrome se encuentra en otra ruta:
$env:CHROME_PATH = 'C:\ruta\chrome.exe'
& $nodeExe scripts\test-browser.cjs
```

Las capturas se generan en `docs/evidencias-fase2/`. El ejecutor abre un puerto de depuración local efímero y termina la instancia propia al finalizar. No utiliza el perfil personal ni las pestañas del usuario. Comprueba escritorio, tablet y móvil; doble clic; borrador tras recarga; respuesta perdida después del commit; reintento con la misma operación; seguimiento privado y conservación de inventario. La revisión usa el [protocolo oficial de Chrome DevTools](https://chromedevtools.github.io/devtools-protocol/). No es una prueba en dispositivos físicos ni cubre todos los navegadores.

Con npm disponible, los equivalentes son `npm run check`, `npm test`, `npm run test:postgres` y `npm run test:browser`. Consulte `INFORME_FASE2.md` y los dos registros de resultados.

## Activación futura

No se activó esta versión en Render ni se migró Neon. Antes de cualquier activación futura autorizada: obtener y verificar un dump de la base objetivo, probar 001/002 en una copia representativa, revisar clasificaciones, configurar HTTPS/origen/proxy y la cuenta SQL limitada de Fase 1, ejecutar las pruebas y definir una ventana de cambio y recuperación. No ejecutar migraciones de producción ni desplegar a partir de este informe sin autorización adicional.