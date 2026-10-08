# Informe técnico — Fase 4: gestión documental, PDF y reportes

Fecha: 8 de octubre de 2026. Versión 1.4.0. Rama `codex/fase4-documentos-reportes`.

Implementación y validación de desarrollo completadas dentro del alcance autorizado. Producción no fue modificada: no se conectó a Neon, no se aplicaron migraciones allí y no se desplegó en Render. No se avanzó a Fase 5. No hubo commits ni publicación automática.

## Funcionalidades entregadas

1. **PEDIDO DE ALMACÉN**: PDF A4 corporativo con logotipo, código, fecha/hora de registro, solicitante, categoría, cultivo, destino, cilindros/tanques, recipientes, productos, dosis, unidades, cantidades originales, observaciones y firma manuscrita.
2. **CONSTANCIA DE DESPACHO DE ALMACÉN**: PDF individual de cada entrega, con solicitud/despacho, fecha/hora, responsable, receptor, cultivo/destino, cantidades originales, entrega actual, acumulado, pendiente, observaciones y dos firmas.
3. **Documentos persistidos e inmutables**: snapshot autorizado, plantilla versionada, bytes PDF, hash SHA-256, fecha y actor de generación. Las descargas repetidas no crean nuevos documentos ni movimientos.
4. **Descarga pública segura**: se autoriza con código y clave privada enviados por POST. El PDF no incluye la clave. El TXT privado anterior se conserva como medio de recuperación del seguimiento.
5. **Descarga interna protegida**: ADMINISTRADOR y ALMACENERO pueden descargar documentos operativos. Las rutas públicas no ofrecen comprobantes de despacho ni información interna.
6. **Reportes exclusivos de ADMINISTRADOR**: solicitudes por periodo, categoría y estado; productos solicitados/entregados; despachos por responsable; historial por solicitud; diferencias y pendientes. Incluyen filtros, paginación, corte de consulta y XLSX.
7. **Compatibilidad**: las exportaciones anteriores reutilizan el mismo generador extraído, con su precisión histórica de dos decimales. Los nuevos reportes usan seis decimales y texto exacto para cifras que exceden la precisión de Excel.

## Arquitectura y preservación histórica

`DocumentService` autoriza cada acceso y construye una proyección documental explícita. La solicitud utiliza sus campos originales y snapshots de producto; el despacho utiliza `result_snapshot`. El estado actual o cambios posteriores del catálogo no sustituyen datos originales.

La lectura inicial termina antes de renderizar PDF. La generación no bloquea el inventario. Antes de persistir se vuelve a autorizar el acceso; documento y auditoría se guardan juntos. La restricción única `(kind, source_id, template_version)` resuelve primeras descargas concurrentes: solo se conserva un registro y un evento de creación. Descargas posteriores recuperan el documento existente.

`PDFKit 0.20.2` está fijado y Noto Sans Regular/Bold se distribuyen localmente bajo SIL OFL 1.1, con licencia incluida. No hay fuentes remotas ni servicios externos durante generación. El documento usa A4 vertical, colores institucionales, márgenes de 50 puntos, tipografía legible, cabecera, tablas alternadas, repetición de encabezados, firmas y páginas numeradas.

Los reportes PostgreSQL usan transacciones `REPEATABLE READ READ ONLY` y consultas parametrizadas por lote. La suma de despachos confirmados se calcula por detalle de solicitud antes de combinarla con las cantidades originales, evitando multiplicar solicitudes por número de entregas. Se reutiliza el mapeo histórico de solicitudes del repositorio.

Productos se agrupan por ID, nombre histórico, presentación y unidad. No se mezclan litros con kilogramos ni presentaciones distintas. El histórico de despacho mantiene acumulados y pendientes propios de cada evento. Las exportaciones indican si el periodo selecciona solicitudes o despachos y llevan fecha de corte.

## Seguridad

- Código y clave privada solo se reciben en el cuerpo POST de la ruta pública. No se añaden a URLs, archivos, metadatos PDF o auditoría.
- Las respuestas PDF/XLSX tienen nombre controlado, tipo MIME, longitud y `Cache-Control: private, no-store`.
- Las rutas internas verifican sesión y rol; los reportes rechazan ALMACENERO y público en servidor.
- Al cerrar sesión o cambiar de usuario se vacían los resultados administrativos y se descartan respuestas tardías de otra sesión. Esta transición se probó en Chrome.
- Se mantienen controles existentes de origen, sesiones, autorización, CSP y límites de frecuencia. Los nuevos endpoints también tienen límites de consulta/descarga.
- No se aceptan cantidades ni contenido del documento enviados por el navegador como datos autoritativos.
- Los documentos tienen disparador de inmutabilidad; los permisos de aplicación solo incluyen SELECT/INSERT, con UPDATE/DELETE/TRUNCATE revocados.
- Las operaciones documentales no actualizan inventario, solicitudes ni despachos. La primera emisión crea un registro documental y una auditoría; repetir una descarga no repite esa auditoría.
- No se inventan campos de registros antiguos. Un despacho confirmado sin snapshot documental se rechaza con `HISTORICAL_DOCUMENT_UNAVAILABLE`.

## Decisión de almacenamiento y capacidad

Se implementó `bytea` en PostgreSQL: es la opción más simple para la arquitectura actual, con copia de seguridad conjunta, autorización central y registro atómico junto con snapshot/hash. No requiere un disco persistente de Render ni contratar almacenamiento externo.

Los cinco ejemplos reales medidos ocupan aproximadamente **190–203 KB cada uno**, incluido logotipo y fuentes. No se recibió una previsión real de documentos por día; estas cifras son escenarios de dimensionamiento, no mediciones del uso de la empresa:

| Emisiones nuevas diarias | Estimación anual con 200.000 bytes por PDF |
|---|---|
| 30 | 2,19 GB de PDF |
| 100 | 7,30 GB de PDF |
| 300 | 21,90 GB de PDF |

No incluye snapshots, índices, WAL, réplicas ni respaldos. Se contabiliza cada documento nuevo; las descargas repetidas no aumentan almacenamiento. El límite por PDF es 5 MiB.

| Alternativa | Ventajas y costes |
|---|---|
| PostgreSQL implementado | Consistencia y respaldo sencillo; incrementa tamaño de base, WAL y tiempos de copia. Adecuado para validar esta fase y un volumen compatible con la capacidad contratada. |
| Objetos privados futuros | Reduce crecimiento de PostgreSQL y facilita retención de muchos archivos; requiere permisos, claves, control de acceso, respaldo, coordinación de escrituras y un servicio adicional. |

Antes de una activación productiva se debe calcular el volumen real y contrastarlo con la capacidad disponible. Revisar la decisión al aproximarse a 5 GB de documentos o cuando el tiempo de respaldo afecte la operación. Es un umbral propuesto de revisión, no un límite del motor. No se integró ni contrató almacenamiento externo.

## Migración

`004_document_records.sql` crea exclusivamente `document_records`, índice temporal y disparador de inmutabilidad. Incluye referencias a solicitudes/despachos, tipo, origen, versión, snapshot, PDF, hash, nombre, fecha y actor. No modifica tablas de negocio ni reescribe históricos. Las migraciones 001, 002 y 003 conservan sus hashes.

Se aplicó solamente a bases PostgreSQL desechables de desarrollo. El preflight del servidor ahora requiere 001–004; la instalación debe aplicar 004 explícitamente antes de arrancar esta versión.

## Archivos de esta fase

Comparación contra el respaldo completo de Fase 3, no contra HEAD, que también contiene cambios pendientes de fases previas:

| Archivos | Acción y propósito |
|---|---|
| `migrations/004_document_records.sql` | Nuevo esquema documental incremental. |
| `src/document-service.js` | Nuevo servicio de autorización, snapshots, emisión y deduplicación. |
| `src/pdf/document-layout.js` | Nuevo diseño común y renderizado de las dos clases de PDF. |
| `src/report-query.js`, `src/report-service.js` | Nuevos filtros, consultas, agregación, paginación y XLSX. |
| `shared/xlsx-writer.js` | Generador existente extraído como módulo reutilizable, con precisión configurable. |
| `documents.js`, `reports.js`, `reports.css` | Nuevas descargas y panel administrativo responsivo. |
| `assets/fonts/NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`, `OFL.txt`, `README.md` | Fuentes y licencia local. |
| `server.js`, `src/services.js`, `src/store.js` | Nuevas rutas y servicios, persistencia documental, lectura coherente y mapeo por lote. |
| `app.js`, `index.html`, `dispatches.js` | Integración de navegación, acceso por rol, XLSX reutilizable y botones PDF. |
| `public.html`, `public.js` | PDF desde comprobante y seguimiento con código/clave. |
| `scripts/runtime-permissions.sql`, `scripts/check.cjs` | Permisos documentales y comprobación ampliada de scripts. |
| `scripts/test-postgres.cjs`, `test/postgres.test.js`, `test/frontend.test.js` | Integración de Fase 4 y actualización de infraestructura de pruebas. |
| `test/document-scenarios.js`, `test/documents.test.js` | Nuevos escenarios documentales, reportes y precisión XLSX. |
| `scripts/test-document-browser.cjs`, `scripts/verify-documents.py` | Nuevos flujos Chrome/PostgreSQL y verificación/renderizado independiente PDF/XLSX. |
| `package.json`, `package-lock.json`, `README.md` | Versión 1.4.0, PDFKit fijado, comando de pruebas y guía. |
| `docs/FASE4.md`, `docs/INFORME_FASE4.md`, registros y evidencias | Instalación, recuperación, informe y resultados verificables. |
| `output/pdf/*.pdf`, `output/pdf/reporte-historial.xlsx` | Ejemplos de prueba con datos ficticios, no documentos reales de la empresa. |

No fue necesario crear plantillas separadas para cada PDF: el diseño común aplica ambas proyecciones y mantiene una sola implementación de cabeceras, tablas y paginación.

## Resultados de pruebas

Registro autoritativo: `docs/pruebas-fase4-integrales.txt`.

| Verificación | Resultado |
|---|---|
| Sintaxis | Correcta con `scripts/check.cjs`. |
| Suite completa de Fases 1–4 | **46 aprobadas, 0 fallos, 0 omisiones.** |
| PostgreSQL real | Clúster 17.6 aislado; migración desde histórico, repetición del migrador y conservación verificadas. |
| Documentos concurrentes | Cuatro primeras descargas generan un solo registro, mismos bytes y SHA-256. |
| Historia | PDF de pedido conserva nombre original tras cambiar catálogo; PDF parcial conserva saldo después de la segunda entrega. |
| Seguridad | Clave errónea rechazada, descarga interna sin sesión rechazada, ALMACENERO sin reportes/Excel. |
| Atomicidad documental | Fallo de renderizado no persiste PDF; fallo de auditoría revierte documento y auditoría sin afectar inventario. |
| Inmutabilidad SQL | UPDATE/DELETE de documentos rechazados por disparador. |
| Reportes | Dos entregas no duplican cantidad solicitada; historial, categorías, estados, responsables, diferencias y paginación comprobados. |
| Conservación | Generación/descarga/reportes no cambian inventario, versión, solicitud, historial de despacho ni vínculos. |
| XLSX | Mantiene precisión anterior de dos decimales y admite seis para reportes; textos como fórmulas se escriben como texto. |
| Verificación independiente | `pypdf`: A4, texto, tildes, firmas, numeración y encabezados. `openpyxl`: XLSX válido, 0.125 numérico y formato de seis decimales. |
| PDFs extensos | 50 productos y observaciones largas: siete páginas, cabeceras repetidas y firma intacta. |
| Chrome/PostgreSQL | Descarga PDF pública y protegida mediante UI, panel ADMINISTRADOR, permisos visuales, historial y Excel aprobados. Incluye regresión de despacho, pérdida de respuesta y reintento. |
| Responsive | 1440, 900, 390 y 320 px; sin desbordamiento horizontal de página ni excepciones JavaScript. Tablas anchas tienen desplazamiento interno en tablet. |
| Respaldo | 97 archivos restaurados y comparados por SHA-256; Git bundle válido. |

Los mensajes `Error interno: Error` dentro de la suite corresponden a fallos de rollback inyectados deliberadamente. No son fallos de la ejecución final.

## Evidencias visuales

- `docs/evidencias-fase4`: 18 capturas de UI, incluidas descargas PDF, reportes escritorio/tablet/móvil y regresión de Fase 3.
- `docs/evidencias-fase4-pdf`: 11 páginas renderizadas en PNG y texto extraído de los cinco documentos.
- `output/pdf`: pedido, despacho parcial, despacho completo, pedido histórico y pedido multipágina; XLSX de historial.

Se inspeccionaron visualmente los cinco PDFs, incluidas todas las páginas del ejemplo extenso, y capturas de reportes en escritorio/tablet/móvil y seguimiento público. No se observan textos solapados, firmas cortadas ni tablas fuera de página.

## Preservación, riesgos y límites

El respaldo previo está en `backups/fase1-2026-10-08T20-27-51-157Z`; su prefijo proviene del script anterior, pero corresponde a Fase 3. La recuperación verificada está en `backups/restauracion-fase3-verificada`.

Se compararon los 97 archivos restaurados. `data/inventory.json` mantiene SHA-256 `9DA4530C9BE96639F783631222673D0B76F57B08FE077D4F386E82ED12276BA9`; SQL 001–003 permanecen idénticos. Ver `verificacion-conservacion-fase4.txt`. El respaldo incluye datos locales existentes; no es un dump de Neon. El archivo histórico de tres bytes no se usó como respaldo válido.

Limitaciones concretas:

- Validación de navegador en Chrome headless de Windows; no hubo pruebas en móviles físicos, Safari/iOS o Firefox, ni impresión física A4.
- No se hizo prueba de carga, auditoría externa ni ensayo con una copia de producción. Se limitaron periodos y filas para acotar coste; se debe dimensionar con uso real antes de publicar.
- PDFKit genera comprobantes con espacios para firma manuscrita; no son PDFs firmados digitalmente ni comprobantes tributarios.
- Los campos antiguos no registrados no se reconstruyen. Despachos sin snapshot requieren revisión, no emisión inventada.
- Los filtros por estado reflejan el estado actual. Los reportes de solicitudes incluyen acumulados al corte de consulta, no un cierre retroactivo al último día del periodo.
- Una exportación usa un corte nuevo coherente y puede incluir entregas posteriores a la consulta visible. Su fecha de corte se indica en Excel.
- El propietario/superusuario puede alterar disparadores; la cuenta de aplicación debe ser distinta y tener los permisos restringidos documentados.
- Las pruebas SQL de integración usan el propietario del clúster desechable. La configuración de privilegios del rol que se utilizará en una futura instalación debe verificarse en esa base antes de activarla.
- Los ejemplos PDF/XLSX son ficticios. No representan datos operativos de AGRÍCOLA JAPURIMA S.A.
- No se implementaron servicios de objetos, firma digital, anulaciones, devoluciones o funcionalidades de Fase 5.

## Activación y recuperación

Consultar [FASE4.md](FASE4.md) para comandos exactos: `npm ci`, migración con confirmación de destino local, actualización de permisos, conexión de aplicación y `node server.js`. Prueba integral: `npm run test:documents` o `node scripts/test-postgres.cjs --with-documents`.

El respaldo de archivos se verifica y restaura con `scripts/backup.cjs` a una carpeta nueva. PostgreSQL exige su propio `pg_dump` coherente y restauración en una base nueva; no eliminar datos para revertir. No conectar código recuperado a una base de producción ni ejecutar despliegues sin autorización independiente.

**Confirmación final:** producción no fue modificada, no hubo despliegue en Render, migración en Neon ni avance a Fase 5.
