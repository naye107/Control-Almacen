# Lotes, vencimientos y valorización — 1.8.0-rc.1

El formulario de productos admite fecha de vencimiento y precio del stock inicial. Cada compra tiene lote, fecha de vencimiento, precio unitario, moneda PEN/USD y, para USD, tipo de cambio expresado en soles por dólar. Los campos de fecha y precio pueden quedar sin registrar; un precio vacío no equivale a cero. El alta rápida en Compras crea un producto sin stock inicial: los datos de su lote se registran en la línea de compra.

Los administradores pueden completar o corregir lote, vencimiento y precio de compras anteriores mediante «Editar lote y precio». La operación conserva cantidades y fecha de ingreso, utiliza revisión CAS y queda en la auditoría existente. Al corregir precios se recalcula la valorización derivada desde esa fecha.

## Vencimiento

Se evalúa con la fecha de Lima. Un lote vence al día siguiente de la fecha indicada, al finalizar su último día de vigencia. Los saldos se distribuyen por vencimiento más próximo entre los lotes vigentes, después entre los sin fecha. Los movimientos se ordenan por fecha; las compras preceden a las salidas de un mismo día. El stock físico conserva el saldo vencido y el valor de ese saldo; no se genera una baja contable automática.

Existencias distingue cantidades vigentes y vencidas, muestra un detalle de lotes con saldo y permite filtrar Disponible, Vencido, Parcialmente vencido, Bajo mínimo, Inactivo o Negativo. El estado se recalcula al consultar, y la interfaz se actualiza al cambiar de día durante su sincronización. Se retira el botón manual de vencimiento.

Las salidas manuales y los despachos se comprueban nuevamente en el servidor contra la cantidad vigente. La disponibilidad de despacho excluye los lotes vencidos. El catálogo público excluye un producto cuyo saldo está totalmente vencido. Los saldos antiguos sin fecha permanecen explícitamente «Sin fecha». Las antiguas marcas manuales de vencimiento se conservan hasta que el administrador registre la información de vencimiento del producto.

## Valorización

La moneda de valorización es PEN. El precio USD se multiplica por el tipo de cambio de esa compra, conservando ambos datos originales. Se calcula promedio ponderado por fecha de movimiento, procesando ingresos antes de salidas del mismo día. Una salida usa el promedio de su fecha, y reduce cantidad y valor. No se cambian los PDF ya emitidos ni se añaden precios a documentos públicos.

Los cálculos usan fracciones exactas con enteros arbitrarios. Solo se redondean importes monetarios al mostrarlos o exportarlos; los costos unitarios pueden mostrar seis decimales. Compras y Salidas incluyen costos e importes, y Existencias muestra costo promedio y valor del saldo. Sus exportaciones XLSX incluyen las columnas nuevas.

Si una parte del stock aún no tiene precio, su costo promedio y su valor completo se presentan como pendientes de valorizar. No se inventan costos históricos. Se informa cuántos productos o movimientos están pendientes; el subtotal conocido no se presenta como valor completo. Al agotarse un saldo de costo desconocido, un nuevo ingreso con precio puede iniciar una valorización conocida.

## Compatibilidad y comprobaciones

Los campos nuevos se almacenan en el JSON de inventario existente; esta versión no ejecuta migraciones ni modifica los archivos 001–007. No reinicia datos, usuarios o sesiones. Los controles de roles, protección de salidas vinculadas, idempotencia y CAS siguen activos.

Pruebas: mezcla PEN/USD, promedio ponderado, corte por fecha, precio desconocido frente a cero real, vencimiento parcial, asignación por fecha de vencimiento, rechazo de fechas/precios/tipos de cambio inválidos, bloqueo acumulado de salidas sobre saldo vigente y flujo real de solicitudes/despachos con lotes vencidos. Se verificaron en navegador local altas, compras USD, salidas valorizadas, filtro de estado, edición de compras existentes y generación de XLSX con importes numéricos.

Los datos de esas pruebas son ficticios y se guardan fuera de producción. No se realizaron pruebas de escritura con datos ficticios en Neon.
