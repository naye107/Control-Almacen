# Informe de entrega — Fase 5A

## Resultado y alcance

Versión 1.5.0, Node.js 24.19.0 LTS, rama codex/fase5a-preparacion-produccion. Correcciones implementadas y validadas en desarrollo. No se modificaron Neon, Render, credenciales reales ni inventario operativo. No se publicaron commits ni se contrató infraestructura. Fase 5B no autorizada.

Commit de código validado en clon limpio: 2038b3dd1d0c69fe3ca485c305dcb5a0b6b4c2e1. La etiqueta de entrega codex/fase5a-v1.5.0 identifica el commit final que incorpora este informe y sus evidencias; consultar git rev-parse codex/fase5a-v1.5.0. Los cambios finales respecto al commit ensayado son documentación y resultados.

## Respaldo y conservación

Antes de modificar código se respaldaron 159 archivos y un Git bundle, incluidos archivos sin commit y datos locales. Paquete: backups/fase1-2026-10-08T21-11-05-426Z. Restauración: backups/restauracion-fase4-verificada. Los 159 archivos restaurados coinciden en tamaño y SHA-256.

Punto de recuperación Git de Fases 1–4: 9210758, etiqueta codex/fase4-recuperacion-20261008. La rama anterior se conservó. El paquete de recuperación, no el archivo histórico de tres bytes, es la copia verificada.

El inventario original data/inventory.json conserva SHA-256 9DA4530C9BE96639F783631222673D0B76F57B08FE077D4F386E82ED12276BA9. Las migraciones 001–004 conservan sus bytes; detalles en preservacion-fase5a.json. La normalización LF/CRLF del checksum migrador facilita clones Windows/Linux sin reescribir ni descartar checksums históricos.

No se obtuvo un respaldo de Neon de producción. El ensayo PostgreSQL de recuperación utilizó exclusivamente datos ficticios locales.

## Riesgos corregidos

| Riesgo | Corrección y evidencia |
|---|---|
| Sobrescritura por escritor anterior | 005 exige marcador transaccional y versión anterior + 1; el UPSERT antiguo y un UPDATE que incrementa versión sin protocolo se rechazan. Ensayo concurrente mantiene el estado del escritor autorizado. |
| Revocación concurrente | Bloqueos de usuario/sesión durante guardado de inventario y de usuario durante login. Un login con password anterior no prospera si gana el cambio de contraseña. |
| Esperas SQL indefinidas | statement_timeout=15s, lock_timeout=3s, idle transaccional=10s; conexiones 5s. Ajustes locales compatibles con pooling. Timeouts y desconexiones tienen respuestas recuperables; rollback y recuperación verificados. |
| Salud HTTP engañosa | /api/health y /api/ready independientes, comprobación DB acotada y drenaje. Mantenimiento bloquea mutaciones y emisión PDF. |
| Memoria/concurrencia documental | Dos trabajos compartidos, cola de ocho, espera máxima de cinco segundos y admisión por RSS; single-flight para un mismo PDF. Límites de snapshot, páginas, fuente de reportes y Excel antes de construir archivos. |
| Guardado completo limitado a 1 MiB | Ruta protegida de inventario hasta 16 MiB, configurable 1–32; otras rutas 128 KiB. Ensayo de inventario válido mayor a 1 MiB aprobado. Cuerpos chunked excesivos devuelven 413. |
| CSV/Excel | Neutralización de fórmulas/control en CSV, texto explícito en XLSX y eliminación de controles XML inválidos. Conservadas cantidades, comillas y decimales. |
| Integridad SQL | Restricción de pertenencia solicitud/detalle/despacho, referencias usadas e inmutabilidad al cambiar destino; confirmación exige salidas enlazadas. Comparación de salidas JSONB por conjuntos e índice por usuario. |
| Privilegios excesivos | Ensayo con rol NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT, sin propiedad; DDL y operaciones destructivas rechazadas. Plantilla reforzada. |
| Versión no reproducible | Motor exacto y lock fijados; clon sin inventario privado instalado y probado. Pruebas históricas usan fixture ficticio. release:check verifica árbol limpio y archivos privados excluidos. |

La separación de roles PostgreSQL complementa los roles funcionales ADMINISTRADOR/ALMACENERO. No son el mismo mecanismo. Un propietario SQL puede desactivar protecciones, por lo que su aislamiento sigue siendo una puerta obligatoria para producción.

## Migración nueva

005_production_hardening.sql, incremental y transaccional. No reemplaza el JSONB, no borra históricos ni modifica 001–004. Se ejecutó únicamente en PostgreSQL 17.6 local aislado. El arranque requiere las cinco migraciones.

Después de 005, las versiones anteriores a 1.5.0 no pueden guardar inventario. No usar la aplicación antigua como reversión operativa; conservar una versión compatible o corregir hacia adelante. Migraciones pendientes se aplican con bloqueo asesor, checksum y tiempos máximos, mediante el comando explícito.

## Pruebas finales

- 56 pruebas aprobadas, cero fallos, cero omitidas, desde clon limpio con PostgreSQL 17.6 y Node 24.19.0.
- Instalación npm ci --ignore-scripts completada: 34 paquetes instalados; el lock no contiene hooks de instalación. No se instalaron paquetes globales ni se alteraron credenciales.
- Autenticación, CSRF, cookies, revocación, protección de ADMINISTRADOR/ALMACENERO y endpoints públicos.
- Guardados y despachos concurrentes, idempotencia, stock cero, precisión decimal, conservación de históricos y rollback por fallos internos.
- Respuesta HTTP perdida después del commit: reintento con el mismo ID produce un solo inventory_write.
- Bloqueo SQL real, cancelación por statement_timeout y recuperación posterior; operación fallida no cambia inventario.
- Confirmaciones SQL sin movimientos y referencias cruzadas rechazadas bajo rol restringido.
- Dump local completo y restauración en otra base; doce tablas comparadas por SHA-256 de contenido ordenado; arranque del destino con rol restringido tras reaplicar permisos.
- Inventario sin cambios durante solicitudes, PDF, reportes y carga de consultas.
- Chrome: escritorio 1440, tablet 900, móviles 390/320; circuito de solicitudes/despachos, UI protegida, reportes y descargas; sin errores JavaScript ni desbordamiento horizontal según pruebas.
- Cinco PDF analizados y renderizados por pypdf/Poppler, cuatro de una página y uno de siete. Revisión visual de comprobante parcial y última página multipágina: firmas, títulos, columnas y pies correctos.
- XLSX abierto con openpyxl: fracción 0.125, formato de seis decimales y ausencia de fórmulas.

Los mensajes de error interno presentes en la suite corresponden a fallos inyectados para comprobar rollback. El criterio válido es el resultado final sin fallos.

## Métricas del ensayo

| Métrica | Resultado |
|---|---:|
| Cuentas | 30 |
| Respuestas correctas | 90 de 90, HTTP 200 |
| Mediana | 275.03 ms |
| Percentil 95 | 912.97 ms |
| Máximo | 975.33 ms |
| RSS máximo durante carga | 120.52 MiB |
| Heap máximo | 33.3 MiB |
| Trabajos documentales simultáneos máximos | 2 |
| Dump de ensayo | 1139939 bytes |
| Tablas restauradas y comparadas | 12 |

Carga: 30 cuentas distintas, tres rondas y 90 peticiones concurrentes de consultas, PDF y Excel. No representa treinta escritores simultáneos ni una prueba en Render. Concurrencia de mutaciones se comprobó en escenarios separados. La medición de memoria pertenece al proceso Node durante la carga; no incluye memoria de PostgreSQL ni certifica consumo con el volumen real de producción. El umbral de admisión es una defensa gradual, no un límite físico garantizado.

## Archivos creados y modificados

Listado de Fase 5A respecto al punto de recuperación; A=creado, M=modificado:

~~~text
M	.env.example
A	.gitattributes
M	.gitignore
A	.node-version
A	.npmrc
A	.nvmrc
M	PUBLICAR.md
M	README.md
M	app.js
A	docs/DESPLIEGUE_RECUPERACION.md
A	docs/FASE5A.md
A	docs/preservacion-fase5a.json
M	index.html
A	migrations/005_production_hardening.sql
M	package-lock.json
M	package.json
M	render.yaml
M	scripts/backup.cjs
M	scripts/migrate.cjs
A	scripts/preflight.cjs
A	scripts/release-check.cjs
M	scripts/runtime-permissions.sql
M	scripts/test-dispatch-browser.cjs
M	scripts/test-document-browser.cjs
M	scripts/test-postgres.cjs
M	server.js
A	shared/csv-writer.js
M	shared/xlsx-writer.js
M	src/database.js
M	src/document-service.js
A	src/operational-limits.js
M	src/pdf/document-layout.js
M	src/report-query.js
M	src/report-service.js
M	src/services.js
M	src/store.js
M	test/documents.test.js
A	test/fixtures/legacy-inventory.json
M	test/frontend.test.js
M	test/inventory.test.js
A	test/phase5a-scenarios.js
A	test/phase5a.test.js
M	test/postgres.test.js
docs/resultados-fase5a.json
A docs/INFORME_FASE5A.md
~~~

Los reportes completos de ejecución y capturas se conservan localmente bajo docs/pruebas-fase5a-clon.txt, docs/pruebas-fase5a-documentos.txt y docs/evidencias-fase5a/. Son evidencias sintéticas, excluidas de Git; resultados-fase5a.json y preservacion-fase5a.json sí están versionados. .env, datos locales, respaldos, dumps, caches y perfiles de prueba están excluidos.

## Procedimientos entregados

FASE5A.md contiene configuración, límites, restauración del código y pasos locales. DESPLIEGUE_RECUPERACION.md contiene respaldo PostgreSQL directo, restauración, corte de escritores, migración y reversión conservando movimientos posteriores.

Prueba local desde la raíz con Node 24.19.0, npm y binarios PG configurados:

~~~powershell
npm ci
npm run check
npm test
$env:PG_BIN_DIR = (Resolve-Path '.tools/postgres/pgsql/bin').Path
npm run test:phase5a
npm run release:check
~~~

En otros equipos apuntar PG_BIN_DIR a la instalación local de PostgreSQL y disponer de Chrome. npm test sin integración omite la prueba PostgreSQL; test:phase5a crea su propio cluster y no usa DATABASE_URL real. Para visualización manual usar una base nueva local, migrador y cuenta de aplicación separados, y crear administrador por terminal sin credenciales predeterminadas.

## Riesgos pendientes y autorización de producción

1. Inspección y restauración de copia real de Neon; esquema, propietarios, extensiones, tamaño y movimientos no se comprobaron contra producción.
2. Identificación, parada y aislamiento de todos los escritores antiguos, incluso conexiones ya abiertas. El marcador no sustituye retirar privilegios de propietarios.
3. TLS/pooling de Neon, proxy real de Render, región, límites efectivos y costos; la plantilla preparada no se aplicó ni se contrató el plan.
4. Prueba de carga equivalente con volumen real anonimizado y medición de crecimiento JSONB/documentos/auditoría. El diseño conserva una fila de inventario serializada; no promete escalabilidad ilimitada.
5. Firefox, Safari/iOS, dispositivos físicos y pruebas de impresión necesitan intervención manual. Emulación Chrome no los sustituye.
6. Almacenamiento externo cifrado, recuperación temporal, alertas, retención, responsables y objetivos RPO/RTO deben configurarse y ensayarse. La reconciliación de movimientos posteriores no está automatizada.
7. Revisar nuevamente parches de Node LTS y avisos de dependencias antes de publicar. La consulta npm del diagnóstico no reportó avisos conocidos para las dependencias fijadas, pero no certifica vulnerabilidades desconocidas.
8. El rate limiting es por proceso; una futura ampliación a varias instancias requiere controles compartidos.
9. Autorizar expresamente Fase 5B, cambios de credenciales, migraciones y publicación. No reabrir una base restaurada a un punto antiguo sin recuperar y reconciliar los movimientos posteriores.

No se autoriza producción únicamente por aprobar pruebas locales. Esta entrega completa las correcciones y preparación de Fase 5A y conserva las verificaciones de producción como pendientes explícitos.
