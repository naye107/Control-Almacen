# Informe técnico — Fase 2: Solicitudes públicas

AGRÍCOLA JAPURIMA S.A. — 08/10/2026. Rama: `codex/fase2-solicitudes-publicas`.

Implementación local realizada y verificada mediante pruebas automatizadas, PostgreSQL real de desarrollo y revisión visual en Chrome. No se conectó, modificó ni migró Neon de producción. No hubo publicación en Render ni desarrollo de Fase 3.

## Funcionalidades implementadas

- Portada responsiva con Registrar solicitud, Consultar solicitud y Acceso protegido a almacén. Archivo del logotipo y colores corporativos conservados; presentación pública sobre fondo verde para mejorar legibilidad.
- Agroquímicos, Herramientas y Otros productos. Catálogo público con identificadores reales, búsqueda y unidades compatibles; solo activos, no vencidos y clasificados expresamente. Stock cero permitido. No muestra saldos internos, costos, compras ni movimientos.
- Campo `requestCategory` separado de la categoría agronómica histórica. ADMINISTRADOR puede habilitarlo al crear/editar productos y en alta rápida. No se clasificaron automáticamente productos originales.
- Agroquímicos: nombre, cultivo, lugar único, observaciones; CILINDROS o TANQUES mutuamente excluyentes; una cantidad general de recipientes. Cada producto tiene dosis y unidad propias: total = dosis × recipientes. Herramientas/Otros usan cantidades directas sin campos de aplicación.
- Varias líneas y fracciones. Rechazo de productos duplicados y dimensiones incompatibles. Conversión g/kg, ml/L y conteos compatibles con las reglas existentes. Aritmética BigInt exacta a seis decimales; rechazo de precisión excesiva sin redondeo silencioso. No se suman magnitudes de unidades incompatibles. Herramientas usa su unidad de inventario como conteo.
- UUID interno, código único y fecha/hora del servidor. Clave privada de 32 bytes aleatorios generada con Web Crypto; servidor almacena SHA-256, nunca la clave. Registro/seguimiento mediante POST, clave ausente de URLs y logs/auditoría de aplicación. Código y clave completa visibles; comprobante TXT descargable privado.
- Nuevas solicitudes PENDIENTE, sin reserva o descuento de stock, movimiento de salida ni despacho. Estados históricos almacenados intactos; REGISTRADA se presenta como PENDIENTE y PARCIAL como PARCIALMENTE_DESPACHADA. APROBADA conserva su significado histórico.
- Idempotencia por UUID normalizado y huella del contenido. Doble clic bloqueado; reintento devuelve la misma solicitud incluso si se perdió la respuesta después del commit. Contenido diferente para la misma operación: 409. Borrador/intento/comprobante en sessionStorage; aviso visible si no está disponible y copia pendiente descargable.
- Solicitud, detalles y auditoría `REQUEST_PUBLIC_CREATE` en una transacción. Fallo intermedio revierte todo. Se conserva versión e inventario. El bloqueo de fila/cola local se comparte con el guardado antiguo; productos referenciados no pueden eliminarse. Reintentos ya guardados no dependen de que el producto siga activo.
- Reutiliza seguridad, sesiones, roles, CSRF, límites de tamaño/intentos y SQL parametrizado de Fase 1. Público no puede listar solicitudes de terceros, usuarios, existencias ni movimientos. ADMINISTRADOR/ALMACENERO mantienen permisos independientes. El almacén protegido sigue en `/index.html`; la portada pública está en `/`.

## Archivos creados

- `public.css`: diseño público responsivo.
- `shared/request-rules.js`: categorías, elegibilidad, unidades y cálculo compartido.
- `src/request-service.js`: catálogo, registro, snapshots, seguimiento e idempotencia.
- `migrations/002_public_requests.sql`: ampliación SQL incremental.
- `test/requests.test.js`: validación, seguridad, integridad y compatibilidad.
- `scripts/test-postgres.cjs`: clúster local aislado con contraseña aleatoria y cierre automático.
- `scripts/test-browser.cjs`: Chrome aislado, interacciones y capturas.
- `docs/FASE2.md`, `docs/INFORME_FASE2.md`: guía e informe.
- `docs/pruebas-fase2-postgresql.txt`, `docs/pruebas-fase2-navegador.txt`, `docs/verificacion-conservacion-fase2.txt`: resultados.
- `docs/evidencias-fase2/*.png`: 14 capturas con datos ficticios; clave del comprobante sustituida por leyenda.

## Archivos modificados respecto al respaldo de Fase 1

| Archivos | Modificación |
| --- | --- |
| `public.html`, `public.js` | Portada, formularios, revisión, comprobante, recuperación y seguimiento. |
| `server.js` | Portada, catálogo y proyección de solicitudes; archivos públicos permitidos. |
| `src/services.js` | Delegación de solicitudes y referencias en validación de inventario. |
| `src/store.js` | Campos SQL nuevos, decimales como texto y productos referenciados. |
| `src/inventory-service.js` | Clasificación válida y protección de referencias. |
| `index.html`, `app.js` | Clasificación pública en Productos y alta rápida. |
| `scripts/migrate.cjs` | Aplicar hasta 001 durante prueba histórica; comando normal sigue aplicando pendientes por hash. |
| `scripts/backup.cjs` | Excluir herramientas/entornos desechables de nuevos respaldos. |
| `test/api.test.js`, `test/helpers.js`, `test/postgres.test.js` | Contrato v2, fixtures y prueba real ampliada. |
| `.gitignore` | Excluir `.tools/` y `.test-runtime/`. |
| `package.json`, `package-lock.json` | Versión 1.2.0 y comandos de prueba, sin nuevas dependencias de aplicación. |
| `README.md` | Alcance y referencias de Fase 2. |

El estado Git incluye además cambios sin commit de Fase 1. No deben atribuirse todos a esta fase. Se conservaron sin cambios de Fase 2 estilos protegidos, seguridad/usuarios, reglas históricas, exportadores y archivos de despliegue. El inventario original y 001 son byte-idénticos.
## Migración SQL

`002_public_requests.sql` agrega a solicitudes: versión, categoría, cultivo, modalidad, número general de recipientes, operación y huella. Detalles: orden, dosis, cantidad base, unidad base y dimensión; cantidades `numeric(20,6)`. Agrega unicidad/restricciones para v2 y amplía el CHECK de estados. Cambia el valor predeterminado solo para filas nuevas. Campos nuevos permiten NULL en registros antiguos. No borra tablas/filas ni actualiza estados históricos. `001_phase1.sql` no fue modificada.

Se aplicó 002 exclusivamente en bases temporales PostgreSQL de localhost con 001 y registros históricos. El migrador repetido fue idempotente y verificó hashes. El servidor comprueba ambas migraciones al arrancar, sin ejecutar DDL. No hay downgrade destructivo; después de registrar v2 deben conservarse los datos y considerar el campo nuevo al regresar código. La guía explica esa limitación.

## Pruebas y resultados

| Prueba | Resultado |
| --- | --- |
| `node scripts/check.cjs` | Sintaxis correcta. |
| Suite con PostgreSQL real | **42 pruebas; 42 aprobadas; 0 fallidas; 0 omitidas.** |
| Motor real | PostgreSQL 17.6 local portable; base vacía desechable, clave aleatoria; clúster detenido al terminar. |
| Migración/compatibilidad | 001 con registros previos → 002 → migrador repetido; IDs, hashes, cantidades, snapshots, estado y fechas históricos iguales. |
| Concurrencia de inventario Fase 1 | Dos guardados desde una versión: uno gana, otro STATE_CONFLICT. Reintento ganador sin duplicar movimientos/auditoría. |
| Idempotencia pública PostgreSQL | Cuatro envíos concurrentes, incluido UUID en mayúsculas: una solicitud, dos detalles, una auditoría. Contenido distinto: 409. |
| Seguridad | Sesiones/hash/expiración/roles/CSRF/origen/límites/archivos privados; público sin acceso a datos internos; ALMACENERO sin escritura ni administración. |
| Cálculos y catálogo | Cilindros/tanques fraccionarios, dosis distintas, unidades, stock cero, exclusión de no vigentes/sin clasificación, campos/números inválidos y duplicados. |
| Integridad | Solicitudes no cambian inventario/versión ni generan salidas/despachos. Protección de productos referenciados y rollback de encabezado/detalles si falla auditoría. |
| Regresiones | Historial real (3 productos, 2 compras, 2 salidas), presentaciones, agotamiento, Kardex/exportador y recuperación del guardado antiguo. |
| Chrome real headless | **PASS**: escritorio 1440×1000, tablet 900×900, móvil 390×844 y 320×720; sin desbordamiento horizontal ni excepciones JavaScript. |
| Interacción en navegador | Dosis/totales, borrador tras recarga, doble clic, respuesta perdida tras commit, recarga/reintento, comprobante, seguimiento, categorías y acceso protegido. Inventario intacto. |
| Respaldo/restauración | 44 archivos y Git bundle; copia recuperada en otra carpeta y comparación SHA-256. |

Los mensajes `Error interno: Error` del registro corresponden a fallos INYECTADOS para verificar rollback, no a pruebas fallidas. El controlador integrado de navegador falló al iniciar; la revisión se completó con Chrome aislado y DevTools oficial, sin usar perfil personal.

Resultados completos: [suite/PostgreSQL](pruebas-fase2-postgresql.txt), [navegador](pruebas-fase2-navegador.txt), [conservación](verificacion-conservacion-fase2.txt).

Capturas principales: [inicio escritorio](evidencias-fase2/01-inicio-escritorio.png), [formulario móvil](evidencias-fase2/04-agroquimicos-movil.png), [reintento móvil](evidencias-fase2/06-reintento-movil.png), [comprobante](evidencias-fase2/07-comprobante-movil.png), [seguimiento](evidencias-fase2/08-seguimiento-movil.png), [tablet](evidencias-fase2/14-formulario-tablet.png). Se inspeccionaron distribución, legibilidad, colores y campos.

## Respaldo y conservación

Respaldo ANTERIOR a modificar Fase 1, incluyendo sus cambios sin commit:
`backups/fase1-2026-10-08T16-55-43-304Z/`.
Contiene 44 archivos, datos locales, manifiesto SHA-256, Git bundle, estado Git y parche. Recuperación comprobada en `backups/restauracion-fase1-verificada/`. Un parche o cambiar de rama no recupera todos los archivos sin commit. No se utilizó el respaldo histórico de tres bytes como fuente válida.

SHA-256 del inventario original, sin cambios:
`9DA4530C9BE96639F783631222673D0B76F57B08FE077D4F386E82ED12276BA9`.

SHA-256 de 001, sin cambios:
`40B48FA450201F933A6DF40E99A8A9CA19C6246B0120F63B12C5FBDD880D07FD`.

## Riesgos, límites y pendientes

- Un ADMINISTRADOR debe clasificar y revisar unidades de productos en una COPIA de desarrollo antes de probar con datos empresariales. No se habilitó automáticamente el catálogo original.
- Se verificó Chrome headless con emulación; no Safari/iOS, Firefox, dispositivos físicos, teclado virtual real ni lector de pantalla. No se hicieron carga masiva ni auditoría externa. Esas pruebas de aceptación quedan pendientes y no se declaran realizadas.
- Límites por IP y memoria del proceso: una IP compartida puede alcanzar el límite. Para múltiples instancias se requiere un limitador compartido. El bloqueo global favorece estabilidad; debe medirse demanda antes de optimizar.
- sessionStorage se pierde al cerrar la pestaña y depende del navegador. Conserve comprobante/copia pendiente privados. No hay recuperación de clave ni importación automática de la copia descargada.
- Se admiten seis decimales; mayor precisión se rechaza. No se inventan conversiones de unidades desconocidas. Integración física con salidas y entregas parciales corresponde a Fase 3.
- PostgreSQL necesita 002 antes de iniciar. Validación local no sustituye ensayo sobre copia representativa de Neon ni un dump independiente recuperable antes de cambios futuros autorizados.
- No hubo commit/push. Los cambios de ambas fases permanecen revisables en la rama; existe un respaldo completo previo. Al volver solo al código de Fase 1, `requestCategory` debe admitirse o sus guardados podrían rechazarse; no eliminar ese campo/datos para forzar una reversión.
- No implementados: confirmación de despachos, descuentos, entregas parciales, firmas, PDF final, distribución de personal, rendimiento o aplicaciones agrícolas. El servicio protegido permite consultar solicitudes; la interfaz operativa de despachos espera autorización de Fase 3.

## Instrucciones exactas para probar localmente

[FASE2.md](FASE2.md) incluye comandos PowerShell completos: copiar a un DATA_DIR nuevo, retirar URLs de producción del ensayo, crear administrador privado solo si falta, arrancar en localhost, clasificar productos y repetir las pruebas. También explica migración de PostgreSQL de desarrollo y restauración sin sobrescribir datos actuales.

Orden: instalar dependencias con `npm ci` si falta `pg` → `node scripts/check.cjs` → `node scripts/test-postgres.cjs` → `node scripts/test-browser.cjs` → crear copia local → crear administrador solo si falta → `node server.js` con DATA_DIR de esa copia → abrir `/` y `/index.html` → clasificar → registrar y consultar comprobante.

Antes de una activación futura autorizada: dump PostgreSQL verificable, ensayo de migración sobre copia, revisión de clasificación, cuenta SQL limitada y HTTPS de Fase 1, ventana de cambio y recuperación. **Producción no fue modificada; no hubo despliegue Render ni migración Neon.**