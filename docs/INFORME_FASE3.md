# Informe de entrega — Fase 3: Despachos

Fecha: 8 de octubre de 2026. Rama: `codex/fase3-despachos-almacen`. Versión: 1.3.0.

Implementación y validación de desarrollo completadas dentro del alcance autorizado. No se realizaron despliegues, publicaciones, commits ni migraciones de producción. No se avanzó a Fase 4. Las pruebas emplearon exclusivamente PostgreSQL local, bases desechables y datos ficticios.

## Funcionalidades implementadas

- Módulo protegido de Despachos para ADMINISTRADOR y ALMACENERO, con identidad visual existente y navegación responsiva.
- Búsqueda por código, persona y producto; filtros por fechas, categoría y estado; orden y paginación. Tarjetas en móvil y tabla en escritorio.
- Detalle de solicitud con cantidades originales, entregadas y pendientes, disponibilidad por producto y desglose por presentación. Conserva información histórica de la solicitud.
- Entregas parciales y completas, múltiples despachos por solicitud, cantidades fraccionadas, unidades compatibles, receptor obligatorio y observaciones. Actor y fecha registrados por el servidor.
- Identificador único `DSP-…`, comprobante inmutable y descarga TXT con datos de trazabilidad y espacios de firma.
- Actualización automática a PENDIENTE, PARCIALMENTE_DESPACHADA o DESPACHADA según el progreso; seguimiento público mediante código y clave privada con cantidades entregadas y pendientes, sin datos internos de stock o usuarios.
- Integración con las salidas actuales y Kardex. No se descuenta stock al crear solicitudes; la salida se genera al confirmar la entrega.
- Registro de auditoría de confirmación. No hay endpoints operativos de edición o eliminación de despachos confirmados.

## Integridad, concurrencia y seguridad

La confirmación usa una sola transacción PostgreSQL. Bloquea el registro de inventario, comprueba la sesión y su rol, bloquea la solicitud, valida revisiones del inventario y solicitud, calcula disponibilidad y saldo, genera las salidas, guarda despacho y detalles, vincula movimientos, actualiza estado y registra auditoría. Si cualquier etapa falla, revierte todo.

Los bloqueos de usuarios y sesiones evitan que una revocación simultánea permita confirmar con permisos ya retirados. Las lecturas y confirmaciones requieren autenticación; las escrituras usan CSRF y tienen limitación de frecuencia. La identidad del responsable no se acepta del navegador.

Cada intento lleva un UUID y hash del contenido. Un reintento idéntico devuelve el comprobante original incluso si las revisiones ya cambiaron; usar ese UUID con otro contenido o usuario devuelve conflicto. El navegador bloquea el doble envío y conserva el intento ante una respuesta perdida. No comunica guardado exitoso antes de obtener confirmación.

El guardado antiguo de inventario conserva su validación de revisión e idempotencia y comparte la comprobación exacta de stock. No puede fabricar, editar ni borrar salidas de despachos. Los disparadores SQL añaden protección de despachos confirmados, detalles, vínculos y movimientos asociados.

Las unidades físicas se calculan mediante racionales con BigInt y conversiones compatibles de volumen, peso y unidades. Los detalles relacionales se guardan en NUMERIC con seis decimales. Las fracciones periódicas de envases se conservan adicionalmente como numerador/denominador en las nuevas asignaciones JSONB, evitando acumular errores de `1/3` o `1/6`. Se mantiene el valor numérico esperado por las vistas antiguas; solo el cálculo del servidor decide si existe stock suficiente.

No se reescribieron compras o salidas históricas. Las presentaciones compatibles pueden abastecer cantidades físicas de distintas capacidades. Las cantidades expresadas como envases se limitan a la presentación solicitada. Un cambio histórico incompatible de unidad, producto inactivo o vencido bloquea su entrega y requiere revisión administrativa.

## Archivos creados y modificados

Listado de esta fase respecto del respaldo de Fase 2, sin atribuirle cambios pendientes de fases anteriores:

| Archivos | Tipo y propósito |
|---|---|
| `dispatches.js`, `dispatches.css` | Nuevos: interfaz protegida, formulario, filtros, recuperación, historial y comprobante. |
| `shared/dispatch-rules.js` | Nuevo: aritmética racional y validación compartida. |
| `src/stock-service.js` | Nuevo: disponibilidad, asignación por presentación y protección exacta de stock. |
| `src/dispatch-service.js` | Nuevo: autorización, validación, confirmación atómica, idempotencia y comprobantes. |
| `src/dispatch-query.js` | Nuevo: filtros, paginación y proyección de solicitudes. |
| `migrations/003_dispatches.sql` | Nuevo: migración incremental y disparadores de integridad. |
| `test/dispatch-scenarios.js`, `test/dispatches.test.js` | Nuevos: escenarios compartidos y pruebas de despacho/API. |
| `scripts/test-dispatch-browser.cjs` | Nuevo: validación Chrome con base PostgreSQL ficticia. |
| `server.js`, `src/services.js` | Modificados: rutas protegidas, servicio de despachos y recursos estáticos. |
| `src/store.js` | Modificado: persistencia transaccional PostgreSQL y compatibilidad del almacenamiento local existente. |
| `src/inventory-service.js` | Modificado: guardado antiguo protegido, referencias y stock exacto. |
| `src/request-service.js`, `public.js` | Modificados: progreso público de entregas sin exponer información interna. |
| `index.html`, `app.js` | Modificados: acceso al módulo, sincronización con inventario, presentación en Kardex y protección visual de salidas vinculadas. |
| `scripts/runtime-permissions.sql` | Modificado: restricciones de eliminación y truncado de tablas de despacho. |
| `scripts/test-postgres.cjs`, `scripts/test-browser.cjs`, `test/postgres.test.js` | Modificados: pruebas integrales y reutilización del ejecutor de navegador. |
| `package.json`, `package-lock.json`, `README.md` | Modificados: versión, comando de prueba y documentación. |
| `docs/FASE3.md`, `docs/INFORME_FASE3.md` | Nuevos: activación, operación, recuperación e informe. |
| `docs/pruebas-fase3-*.txt`, `docs/verificacion-conservacion-fase3.txt`, `docs/evidencias-fase3/*.png` | Nuevos: registros de pruebas y evidencias de conservación y visuales. |

## Migración SQL

`003_dispatches.sql` agrega revisión de despacho a solicitudes, código y receptor del despacho, observaciones, snapshots de actor/solicitud/comprobante, versión de inventario y referencia preparada para una futura compensación. Agrega snapshots y cantidades base a detalles, índices, restricciones y disparadores.

La inserción de un despacho utiliza BORRADOR dentro de la transacción y pasa a CONFIRMADO después de guardar detalles y vínculos; no deja borradores comprometidos. Los registros históricos sin el nuevo código conservan compatibilidad. No se implementó un flujo de compensación.

Las migraciones 001 y 002 mantienen sus hashes originales. La 003 se aplicó únicamente sobre PostgreSQL de pruebas local y se comprobó la repetición del migrador sin reaplicar cambios.

## Pruebas y resultados

Registro final autoritativo: `docs/pruebas-fase3-integrales.txt`.

| Verificación | Resultado |
|---|---|
| Sintaxis JavaScript (`scripts/check.cjs`) | Correcta. |
| Suite completa de Fases 1, 2 y 3 | **44 aprobadas, 0 fallos, 0 omisiones.** |
| PostgreSQL real | Clúster local 17.6; migración desde histórico y repetición, confirmaciones, reintentos, conflictos y conservación verificadas. |
| Seguridad de API | Sin sesión rechazado; roles, CSRF, validaciones y filtros comprobados. |
| Integridad de entregas | Parciales/completas, cero omitido, exceso de saldo/stock, stock cero y reposición, unidades incompatibles y precisión. |
| Envases y conversiones | 500/1000/1500 ml desde 3 L, fracciones exactas y reposición con presentación diferente; peso fraccionado y herramientas. |
| Concurrencia | Dos solicitudes sobre stock compartido; un ganador y conflicto del otro; cuatro reintentos idénticos generan una sola salida y revisión. |
| Atomicidad | Fallos inyectados en persistencia de inventario, despacho, actualización de solicitud y auditoría revierten el estado. |
| SQL directo | Rechaza actualizar/eliminar despachos confirmados, modificar detalles y retirar movimientos vinculados. |
| Compatibilidad | Guardado antiguo rechaza versiones obsoletas y salidas falsificadas; productos, compras y salidas del histórico de prueba se conservan. |
| Navegador Chrome con PostgreSQL | Búsqueda/paginación, rol ALMACENERO, unidades, parcial y completa, doble envío, pérdida de respuesta después del commit, recarga/reintento, conflicto con formulario conservado, Kardex y seguimiento público: aprobados. |
| Responsive | 1440 px escritorio, 900 px tablet, 390 y 320 px móvil; sin desbordamiento horizontal ni excepciones JavaScript en el flujo. |
| Respaldo recuperable | Git bundle verificado y 70 archivos restaurados comparados por SHA-256. |
| Conservación del proyecto | Inventario local y SQL 001/002 idénticos al respaldo. |

El registro inicial y el de PostgreSQL aislado documentan intentos anteriores; el resultado final es el archivo integral. Los mensajes `Error interno: Error` de pruebas corresponden a fallos inyectados para comprobar rollback, no a fallos de la suite final.

## Evidencias visuales

En `docs/evidencias-fase3` se guardan 11 PNG con datos ficticios: panel y detalle de escritorio, tablet, entrega parcial móvil, reintento, comprobante, conflicto, Kardex, panel móvil, panel de 320 px y seguimiento público. Se inspeccionaron visualmente las capturas de escritorio, entrega parcial, comprobante, seguimiento y panel de 320 px. Las métricas generales se ocultan únicamente en la vista Despachos para dar prioridad al formulario.

## Respaldo y datos conservados

El respaldo previo está en `backups/fase1-2026-10-08T19-37-43-433Z`, con todos los cambios sin commit de Fase 2. La restauración verificada está en `backups/restauracion-fase2-verificada`. El prefijo del respaldo es histórico; no indica la fase de su contenido.

Inventario local conservado: SHA-256 `9DA4530C9BE96639F783631222673D0B76F57B08FE077D4F386E82ED12276BA9`. Los 70 archivos restaurados coinciden con su manifiesto. El archivo histórico de tres bytes no se usó como fuente de recuperación. El respaldo contiene los datos locales existentes; no es un dump de Neon.

## Riesgos y pendientes

- Validación realizada en Chrome headless sobre Windows; no se probaron dispositivos físicos, Safari/iOS o Firefox. No se declara validación universal de navegadores.
- No se realizó una prueba de carga ni una auditoría externa de seguridad. El bloqueo global del inventario serializa escrituras: favorece integridad, pero debe medirse antes de crecer a muchos usuarios concurrentes.
- Las tablas y datos de producción no se inspeccionaron ni migraron. Antes de una activación futura se requiere respaldo PostgreSQL verificable, ensayo con una copia autorizada, revisión de permisos y autorización independiente de despliegue.
- Las vistas antiguas mantienen sus formatos y números de presentación; los cálculos decisivos de las nuevas operaciones son exactos en servidor. No se ha migrado masivamente el histórico.
- El formulario conserva un intento incierto en sessionStorage de la pestaña. Al borrar ese almacenamiento se pierde la recuperación automática; consultar el historial antes de intentar una nueva entrega.
- El comprobante entregado es TXT, no PDF firmado. No se implementaron anulación, devolución, edición de confirmados, compensaciones, notificaciones ni otras funciones de Fase 4.
- El propietario/superusuario de PostgreSQL puede alterar disparadores. Usar obligatoriamente una cuenta de aplicación distinta, con los permisos del script, y custodiar las credenciales del propietario.
- No restaurar únicamente código de Fase 2 sobre datos que ya contengan despachos de Fase 3. La reversión segura requiere preservar esos datos y recuperar un conjunto coherente en otro entorno o aplicar una corrección compatible hacia adelante.

## Instalación y recuperación

Los comandos exactos y requisitos están en [FASE3.md](FASE3.md). La prueba integral se reproduce con `node scripts/test-postgres.cjs --with-browser` o `npm run test:dispatches`. La activación interactiva exige una base PostgreSQL exclusiva de desarrollo, ejecutar el migrador con confirmación de destino, configurar el rol de aplicación, crear un administrador si hace falta y ejecutar `node server.js`.

**Confirmación:** producción no fue modificada. No hubo despliegues en Render, ejecución de migraciones en Neon ni implementación de Fase 4.
