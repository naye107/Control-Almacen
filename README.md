# JAPURIMA — Sistema integrado de almacén, Fase 4

Aplicación web responsiva con HTML, CSS, JavaScript, Node.js >=20 y PostgreSQL.
Mantiene productos, compras, salidas, existencias, Kardex, impresión y exportaciones CSV/XLSX.

La Fase 1 incorpora usuarios ADMINISTRADOR/ALMACENERO, sesiones persistentes, autorización,
CSRF, inventario validado en servidor, concurrencia e idempotencia, auditoría y esquema relacional
para solicitudes/despachos. La Fase 2 incorpora el registro público por categorías, dosis, cantidades exactas y seguimiento privado. La Fase 3 incorpora despachos parciales y completos con salidas atómicas, control de concurrencia, comprobantes y seguimiento de cantidades entregadas. Registrar solicitudes no reserva ni descuenta stock.

No existen cuentas o contraseñas predeterminadas. El modo `file:` no autentica; use Node.js.

## Desarrollo local

1. Instale Node.js >=20 con npm y abra una terminal en esta carpeta.
2. Para Fase 4, prepare exclusivamente PostgreSQL de desarrollo; consulte los comandos de migración y permisos en [docs/FASE4.md](docs/FASE4.md). No use una conexión de producción.
3. Ejecute `npm ci`, `npm run check` y `npm run test:documents` para las pruebas integrales con PostgreSQL y Chrome.
4. Configure DATABASE_URL de desarrollo y, si no existe un administrador, ejecute `npm run create-admin` e introduzca usuario y contraseña privada.
5. Ejecute `npm start`. Abra http://localhost:8080. El almacén protegido está en `/index.html`.

Para usar solo el runtime Node ya disponible: `node scripts/check.cjs`,
`node scripts/test.cjs`, `node scripts/create-admin.cjs` y `node server.js`.

El almacenamiento local Fase 1 usa `data/phase1.json` con inventario, usuarios, sesiones y auditoría.
La primera inicialización copia el inventario legado sin modificar `data/inventory.json`.
PostgreSQL conserva `inventory_state.data` y agrega tablas mediante una migración explícita.

Consulte [docs/FASE1.md](docs/FASE1.md) para configuración, instalación, migración, respaldo,
restauración, restricciones y pruebas. Consulte [PUBLICAR.md](PUBLICAR.md) antes de cualquier publicación.

La portada pública está en `/`; el almacén protegido sigue en `/index.html`.
Los productos se habilitan expresamente mediante «Clasificación para solicitudes» en Productos.
Consulte [docs/FASE2.md](docs/FASE2.md) para probar con una copia local, ejecutar las pruebas
PostgreSQL/navegador y aplicar `002_public_requests.sql` exclusivamente en desarrollo.
Consulte [docs/INFORME_FASE2.md](docs/INFORME_FASE2.md) para resultados, evidencias y pendientes.

Consulte [docs/FASE3.md](docs/FASE3.md) para activar y probar Despachos en PostgreSQL local,
gestionar reintentos y recuperar el respaldo verificado. El informe de esta entrega está en
[docs/INFORME_FASE3.md](docs/INFORME_FASE3.md), con resultados de 44 pruebas, evidencias visuales,
archivos modificados, riesgos y límites de validación. No se incluye Fase 4 ni despliegue automático.

La Fase 4 agrega PDFs A4 persistidos y reportes exclusivos de ADMINISTRADOR, con filtros y XLSX.
Los PDF públicos no incluyen la clave de seguimiento; el TXT previo sigue siendo privado.
Consulte [docs/FASE4.md](docs/FASE4.md) para activación local, pruebas y recuperación;
[docs/INFORME_FASE4.md](docs/INFORME_FASE4.md) detalla resultados, capacidad y limitaciones.
La migración 004 se ejecutó únicamente sobre PostgreSQL aislado de pruebas. No se incluye Fase 5.
