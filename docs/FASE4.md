# Fase 4: documentos y reportes en desarrollo

Versión 1.4.0, rama `codex/fase4-documentos-reportes`. No se ha migrado ni desplegado producción. La validación de integración utiliza PostgreSQL local aislado.

## Ejecutar las pruebas

Requisitos: Node.js >=20 para la aplicación; Node.js >=22 para el ejecutor Chrome, PostgreSQL con `initdb`/`pg_ctl` y Chrome instalado. En esta máquina se validó con Node.js 24.19.0, PostgreSQL 17.6 y Chrome headless. PDFKit está fijado en 0.20.2; el motor de aplicación PostgreSQL mantiene su versión anterior del lockfile.

Desde la raíz del proyecto, en PowerShell:

```powershell
npm ci
npm run check
npm run test:documents
```

`test:documents` ejecuta `node scripts/test-postgres.cjs --with-documents`. Crea un clúster propio en `.test-runtime`, usa un puerto libre en 127.0.0.1, contraseñas aleatorias y dos bases vacías con datos ficticios. Ignora la conexión `DATABASE_URL` para esas pruebas y detiene PostgreSQL al terminar. Chrome usa un perfil desechable. No deja un servidor interactivo abierto.

Si PostgreSQL o Chrome están instalados fuera de las rutas predeterminadas:

```powershell
$env:PG_BIN_DIR = 'C:\Program Files\PostgreSQL\17\bin'
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/test-postgres.cjs --with-documents
```

La ruta predeterminada PostgreSQL del ejecutor es `.tools/postgres/pgsql/bin`. Para utilizar el Node disponible en esta máquina sin npm en PATH:

```powershell
$node = 'C:\Users\LENOVO\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node scripts/check.cjs
& $node scripts/test-postgres.cjs --with-documents
```

Para comprobar y renderizar los cinco PDFs de ejemplo y abrir el XLSX mediante una biblioteca independiente:

```powershell
$env:POPPLER_BIN = 'C:\Users\LENOVO\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin'
& 'C:\Users\LENOVO\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/verify-documents.py
```

En otra máquina, configurar `POPPLER_BIN` al directorio de Poppler y usar Python con `pypdf` y `openpyxl`. Son herramientas de validación; la aplicación no necesita Python ni Poppler. Los ejemplos se generan en `output/pdf`, las capturas en `docs/evidencias-fase4`, y las páginas renderizadas en `docs/evidencias-fase4-pdf`.

## Activar una instancia interactiva de desarrollo

1. Detener la instancia local que se actualiza. Respaldar código y su base PostgreSQL de desarrollo antes de aplicar la migración. Si se utiliza una copia existente, verificar que corresponda a Fase 3. No utilizar una conexión de Neon de producción.
2. Preparar una base PostgreSQL local exclusiva, por ejemplo `japurima_dev`. Para datos existentes, restaurar allí una copia autorizada. En una base vacía la migración crea inventario vacío; no importa automáticamente `data/inventory.json`.
3. Configurar la conexión del propietario de migraciones, con credenciales privadas propias:

```powershell
$env:NODE_ENV = 'development'
$env:DATABASE_URL = 'postgresql://USUARIO_MIGRACIONES:CLAVE_CODIFICADA_URL@127.0.0.1:5432/japurima_dev'
node scripts/migrate.cjs --confirm-target 127.0.0.1/japurima_dev
```

El migrador comprueba los checksums y aplica únicamente las migraciones pendientes, incluida `004_document_records.sql`. No modificar 001, 002 o 003. No usar `--allow-production` para esta entrega.

4. Preparar un rol de aplicación distinto del propietario, no superusuario y sin herencia del rol propietario. Si ya existe desde Fase 3, actualizar sus permisos después de migrar:

```powershell
psql $env:DATABASE_URL -v app_role=japurima_app -f scripts/runtime-permissions.sql
```

Este script no crea el rol ni su contraseña. Otorga SELECT/INSERT en documentos y revoca UPDATE/DELETE/TRUNCATE. Revisar también privilegios heredados del rol. No asignar a la aplicación credenciales de propietario.

5. Cambiar a la conexión de aplicación y arrancar:

```powershell
$env:DATABASE_URL = 'postgresql://japurima_app:CLAVE_CODIFICADA_URL@127.0.0.1:5432/japurima_dev'
$env:HOST = '127.0.0.1'
$env:PORT = '8080'
$env:PUBLIC_ORIGIN = 'http://localhost:8080'
node scripts/create-admin.cjs
node server.js
```

Crear el administrador solo si no existe uno disponible en la copia. El script pide contraseña oculta; no hay credenciales predeterminadas. Node no carga `.env.example` automáticamente.

6. Abrir `http://localhost:8080/` para solicitudes públicas y `http://localhost:8080/index.html` para almacén. Registrar una solicitud con productos clasificados de la copia local; guardar aparte código y clave privada. Descargar el PDF desde el comprobante o la consulta de seguimiento. Registrar una entrega parcial y otra completa; descargar ambos PDFs y verificar que el primero mantiene sus saldos originales.
7. Entrar como ADMINISTRADOR y abrir Reportes. Seleccionar tipo, fechas, categoría, estado o búsqueda; consultar, paginar y exportar Excel. Confirmar que un ALMACENERO no tiene acceso al panel ni a las rutas de reportes.

## Reglas de documentos y reportes

- El PDF público es compartible y no incluye la clave privada. La copia TXT existente sigue siendo **privada** y contiene la clave; no compartirla como constancia pública.
- Cada fuente y versión de plantilla tiene un único PDF persistido. Las descargas repetidas devuelven los mismos bytes y hash.
- Generar un PDF agrega solamente el registro documental y su auditoría inicial. No modifica solicitudes, despachos, inventario, salidas o revisiones.
- Los PDFs se generan del original persistido de la solicitud y del snapshot confirmado de cada despacho, nunca del formulario del navegador o del catálogo actual.
- Los registros históricos con campos ausentes muestran “No registrado” u omiten campos no aplicables. Un despacho antiguo sin snapshot documental devuelve un error explícito; no se inventa un comprobante.
- La versión de plantilla es `corporate-a4-v1`. Para futuros cambios de contenido o marca, crear otra versión; no sobrescribir documentos ya emitidos.
- Reportes: periodo predeterminado de 30 días; máximo 366 días de diferencia entre extremos. Límite de 2.000 solicitudes o despachos para la selección principal y 20.000 filas/detalles. Excel máximo 16 MiB. Si se excede, reducir el periodo o filtrar.
- Para “Despachos por responsable”, las fechas corresponden al despacho. Los demás reportes seleccionan por fecha de solicitud y muestran entregas acumuladas al momento de consulta; no representan un cierre histórico retroactivo. El panel y Excel lo indican.
- La exportación incluye toda la selección filtrada dentro de los límites, no solo la página visible. Se calcula con un nuevo corte coherente: si hay nuevas entregas entre la consulta y la descarga, Excel puede reflejarlas y lleva su propia fecha de corte.
- Las cantidades se agrupan por producto histórico, presentación y unidad. No hay total global de unidades físicas incompatibles. Valores numéricos Excel usan hasta seis decimales; cifras con más de 15 dígitos se exportan como texto exacto.

## Respaldo y recuperación

Punto anterior a la Fase 4: `backups/fase1-2026-10-08T20-27-51-157Z`. El prefijo `fase1` proviene del script existente; el contenido corresponde a **Fase 3 completa**, con todos los cambios sin commit y datos locales existentes. Incluye 97 archivos, manifiesto SHA-256 y Git bundle. Se restauró y verificó en `backups/restauracion-fase3-verificada`.

```powershell
node scripts/backup.cjs --verify backups/fase1-2026-10-08T20-27-51-157Z
node scripts/backup.cjs --restore backups/fase1-2026-10-08T20-27-51-157Z backups/recuperacion-fase3-nueva
```

El destino debe ser nuevo. Revisar su conexión antes de arrancar, instalar dependencias y utilizar datos de desarrollo del mismo punto recuperado. No sobrescribe el proyecto actual.

Un respaldo de archivos **no reemplaza `pg_dump`**. Para una instancia PostgreSQL local propia, con conexión ya verificada y servidor detenido para un punto coherente con el código:

```powershell
pg_dump --format=custom --file=backups/japurima-dev-fase3.dump $env:DATABASE_URL
```

Restaurar con `pg_restore` en una base local nueva, sin `--clean` ni sobrescribir la base actual:

```powershell
pg_restore --exit-on-error --dbname=CONEXION_DE_BASE_LOCAL_NUEVA backups/japurima-dev-fase3.dump
```

Revisar permisos y probar esa copia antes de sustituir una instancia. No se creó un dump de Neon ni se conectó a producción. Los clústeres `.test-runtime` son fixtures desechables, no datos operativos.

Para revertir Fase 4, recuperar código y base coherentes en un entorno aparte. Conservar PDFs y snapshots emitidos posteriormente; no eliminar `document_records`, disparadores o documentos para volver atrás. Una corrección compatible hacia adelante es preferible cuando ya existe actividad nueva. No se entrega SQL destructivo de reversión.
