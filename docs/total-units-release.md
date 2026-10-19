# Registro por cantidades totales — 1.7.0-rc.1

El catálogo registra cantidades en kg, L o unidad. Se elimina el campo de presentación del alta y de la edición de productos. Compras, salidas, solicitudes y despachos trabajan con la unidad elegida. Los indicadores suman cada unidad por separado. Los documentos nuevos usan la plantilla `corporate-a4-total-v2`.

Los productos nuevos llevan `quantityBasis: TOTAL`. Internamente se conserva una presentación canónica (`1 kg`, `1 L`, `1 unidad`) compatible con las comprobaciones de integridad existentes. No representa un envase ni multiplica cantidades. Se admiten hasta seis decimales para kg y L; unidad exige enteros. El cálculo de dosis utiliza aritmética decimal exacta.

Los archivos históricos siguen siendo legibles. No se convierten sacos o bidones antiguos automáticamente. Un navegador anterior que intente crear un producto sin el contrato nuevo será rechazado por el servidor. Al publicar, los operadores deben recargar la página e iniciar sesión nuevamente.

## Reinicio solicitado

El alcance confirmado incluye productos, compras, salidas, solicitudes, despachos y sus documentos PDF. Conserva usuarios, contraseñas, roles, migraciones, historial de auditoría y respaldos externos. Se revocan las sesiones para evitar escrituras desde clientes con datos anteriores. La revisión del inventario avanza mediante CAS y nunca vuelve a cero.

El constructor de reinicio se encuentra fuera del paquete publicable, en `scripts/build-total-units-reset.cjs` del proyecto principal. Exige identidad exacta de producción, mantenimiento habilitado, respaldo verificado y recuentos/hashes recientes. La transacción bloquea las tablas afectadas, comprueba nuevamente esos valores y cancela cualquier discrepancia. No utiliza CASCADE ni deshabilita disparadores. El reinicio conserva una entrada de auditoría con referencia al respaldo.

## Validación y estado

34 pruebas automatizadas aprobadas: permisos por rol con HTTP real, cantidades por unidad, restricciones de precisión, despachos parciales/completos, concurrencia CAS, salidas vinculadas inmutables, PDF y comprobaciones del constructor de reinicio. Se verificó en navegador local el alta con 25.5 kg, una salida de 1.25 kg y una dosis de 0.1 kg por tres cilindros, resultando 23.95 kg. Los datos de estas pruebas son ficticios y están aislados de Neon.

No se han ejecutado pruebas nuevas contra PostgreSQL real para esta versión ni se ha ejecutado el reinicio. Las migraciones 001–007 se conservan; esta versión no añade migraciones.

Consulta de solo lectura del 19 de octubre de 2026: producción contiene 264 productos, 206 compras, 866 salidas, una solicitud, dos despachos, un documento y tres usuarios; revisión de inventario 5. Estos recuentos deben comprobarse nuevamente durante el corte.

Pendiente para publicar: respaldo actualizado, comprobación de restauración, corte con escrituras bloqueadas, confirmación final del borrado, ejecución transaccional, despliegue de este candidato en Render y comprobación de disponibilidad y de conservación de usuarios. Esta preparación no es evidencia de un reinicio o despliegue completado.
