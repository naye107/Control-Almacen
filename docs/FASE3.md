# Fase 3: instalación y operación en desarrollo

Esta entrega se encuentra en `codex/fase3-despachos-almacen`, versión 1.3.0. No se ha desplegado ni conectado a Neon/Render. No ejecutar estos pasos sobre producción. El desarrollo y la validación integral de esta fase utilizan PostgreSQL local aislado.

## Prueba automatizada reproducible

Requisitos: Node.js >=20 y dependencias de `package-lock.json`; para el ejecutor de navegador, Node.js >=22 con WebSocket global, PostgreSQL y Chrome. La ejecución realizada utilizó Node.js 24.19.0 y PostgreSQL 17.6 en Windows.

En PowerShell, desde la raíz del proyecto:

```powershell
npm ci
npm run check
npm run test:dispatches
```

`test:dispatches` ejecuta `node scripts/test-postgres.cjs --with-browser`. Busca los binarios PostgreSQL en `.tools/postgres/pgsql/bin`; si PostgreSQL está instalado en otra ubicación:

```powershell
$env:PG_BIN_DIR = 'C:\Program Files\PostgreSQL\17\bin'
node scripts/test-postgres.cjs --with-browser
```

No reutiliza `DATABASE_URL`: genera un clúster en `.test-runtime`, puerto libre en 127.0.0.1, contraseña aleatoria, bases vacías de pruebas y datos ficticios. Ejecuta todas las pruebas, abre Chrome con perfil desechable y guarda las capturas en `docs/evidencias-fase3`. Detiene el clúster al terminar. No deja una aplicación interactiva en ejecución.

En esta máquina también se puede ejecutar sin npm en PATH:

```powershell
$node = 'C:\Users\LENOVO\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node scripts/check.cjs
& $node scripts/test-postgres.cjs --with-browser
```

## Activación interactiva sobre una base de desarrollo

1. Detener la instancia local que se vaya a actualizar. Crear un respaldo del código y de su base de desarrollo con `pg_dump` antes de aplicar migraciones. Este respaldo de código no reemplaza el respaldo de PostgreSQL.
2. Preparar una base local **exclusiva de desarrollo** llamada, por ejemplo, `japurima_dev`. Si se necesitan datos existentes, restaurar allí una copia autorizada; no apuntar la aplicación al servidor de producción. En una base vacía, la migración crea un inventario vacío: no importa automáticamente `data/inventory.json`. Los productos de demostración pueden registrarse desde la interfaz administrativa. La importación inicial de inventario legado por archivo pertenece al modo local anterior, no al arranque PostgreSQL.
3. Utilizar una cuenta propietaria de migraciones exclusivamente para aplicar SQL. Definir una conexión con credenciales propias, sin copiar las credenciales de ejemplo literalmente:

```powershell
$env:NODE_ENV = 'development'
$env:DATABASE_URL = 'postgresql://USUARIO_MIGRACIONES:CLAVE_CODIFICADA_URL@127.0.0.1:5432/japurima_dev'
node scripts/migrate.cjs --confirm-target 127.0.0.1/japurima_dev
```

El migrador valida el destino y los checksums de las migraciones aplicadas. Ejecuta 001, 002 y 003 en orden; si 001 y 002 ya están registradas y coinciden, aplica únicamente 003. No usar `--allow-production` para esta entrega.

4. Crear una cuenta PostgreSQL de aplicación con secreto propio. Debe ser distinta del propietario de tablas y no ser superusuario ni heredar el rol propietario. Aplicar los permisos con `psql` usando la conexión de migraciones:

```powershell
psql $env:DATABASE_URL -v app_role=japurima_app -f scripts/runtime-permissions.sql
```

El rol `japurima_app` debe haberse creado previamente con una contraseña segura; el script no crea usuarios ni establece contraseñas. Verificar además que no herede privilegios amplios otorgados previamente.

5. Cambiar `DATABASE_URL` a la conexión del rol de aplicación. Configurar la instancia local:

```powershell
$env:DATABASE_URL = 'postgresql://japurima_app:CLAVE_CODIFICADA_URL@127.0.0.1:5432/japurima_dev'
$env:HOST = '127.0.0.1'
$env:PORT = '8080'
$env:PUBLIC_ORIGIN = 'http://localhost:8080'
node scripts/create-admin.cjs
node server.js
```

Crear el administrador solo si la copia de desarrollo no tiene uno disponible. El script solicita contraseña oculta, mínimo 12 caracteres. No hay usuarios ni contraseñas predeterminadas. Node no carga `.env.example` automáticamente.

6. Abrir `http://localhost:8080/` para solicitudes públicas y `http://localhost:8080/index.html` para el almacén. Un administrador puede crear el usuario ALMACENERO desde Usuarios. Ambos roles pueden acceder a Despachos; el ALMACENERO no puede guardar inventario ni administrar usuarios.
7. Para datos de demostración, clasificar expresamente productos de la copia local para solicitudes. Registrar una solicitud pública y conservar su código y clave privada. En Despachos, buscarla, revisar stock, introducir cantidades y receptor, confirmar y revisar el comprobante, Kardex y seguimiento público. Verificar una entrega parcial y otra que complete el saldo.

## Comportamiento operativo

- Un producto sin stock puede solicitarse; solo se confirma una entrega si hay stock y saldo suficientes.
- Las cantidades de entrega tienen hasta seis decimales. Solo se admiten unidades compatibles; los cálculos del servidor son autoritativos.
- Los recipientes de agroquímicos pertenecen a la solicitud original. El despacho indica la cantidad física realmente entregada, sin cambiar sus dosis ni su modalidad.
- Puede dejarse un producto en cero mientras otro se entrega. No se admite confirmar una entrega completamente vacía.
- El receptor es obligatorio; el usuario responsable y la fecha se obtienen del servidor. El comprobante incluye cantidades solicitadas, entregadas en ese despacho, acumuladas y pendientes. Puede descargarse como TXT.
- Ante un conflicto de versiones, actualizar los saldos, revisar lo introducido y volver a confirmar. El formulario conserva los valores.
- Si se pierde la respuesta después de confirmar, usar **Reintentar confirmación**. El navegador conserva la operación y envía exactamente el mismo identificador y contenido; no genera otra salida. Evitar borrar el almacenamiento de la pestaña hasta resolver ese intento. Si se perdió ese almacenamiento, consultar primero el historial antes de registrar otra entrega.
- Un despacho confirmado no se edita ni elimina. No hay anulaciones, devoluciones o compensaciones operativas en esta fase.

## Recuperación y reversión

El punto previo a Fase 3 está en `backups/fase1-2026-10-08T19-37-43-433Z`. El prefijo `fase1` proviene del script existente: su contenido es el estado completo de **Fase 2**, incluidos sus cambios sin commit. Incluye 70 archivos, inventario local, manifiesto SHA-256, Git bundle, estado Git y parche de trabajo.

```powershell
node scripts/backup.cjs --verify backups/fase1-2026-10-08T19-37-43-433Z
node scripts/backup.cjs --restore backups/fase1-2026-10-08T19-37-43-433Z backups/recuperacion-fase2-nueva
```

El destino debe ser una carpeta que todavía no exista. No sobrescribe el proyecto actual. Ya se realizó una restauración de prueba en `backups/restauracion-fase2-verificada` y se compararon los 70 archivos. Consultar `verificacion-conservacion-fase3.txt`.

Antes de iniciar una copia restaurada, revisar y cambiar su configuración para usar exclusivamente datos recuperados de desarrollo, instalar dependencias y restaurar su respaldo PostgreSQL correspondiente. No conectar el código restaurado a una base actualizada con entregas posteriores.

Después de registrar despachos, **no basta con bajar la versión del código**: los nuevos movimientos contienen vínculos y cantidades exactas que el código anterior no conoce. Preservar esos datos, detener la instancia afectada y corregir hacia adelante o restaurar código y base de datos del mismo punto en un entorno aparte. No eliminar tablas, disparadores ni despachos para revertir; no se entrega una migración destructiva de reversión.

Los archivos de pruebas y clústeres desechables de `.test-runtime`, binarios `.tools`, `node_modules` y `.git` no se copian al respaldo de archivos; la historia Git se conserva en el bundle. El archivo histórico de tres bytes no se considera respaldo válido. No se ha extraído un respaldo de Neon porque no se autorizó operar sobre producción.
