# Anulación de despachos y vista de usuarios

El administrador puede abrir Despachos, elegir Todos o Despachadas, entrar en Ver solicitud y pulsar Anular despacho en su historial. Debe indicar un motivo y confirmar la devolución. No se ejecuta ninguna anulación durante el despliegue.

La operación bloquea inventario, usuario y solicitud, comprueba ambas revisiones y registra en una transacción: ingresos de devolución, anulación, nueva revisión de solicitud y auditoría. Una repetición de la misma anulación devuelve su resultado anterior, sin duplicar cantidades. Almaceneros y supervisores no pueden anular.

Los despachos anulados quedan en el historial. Las salidas, asignaciones y PDF originales conservan sus bytes. La pantalla del comprobante señala la anulación y ofrece el PDF original con esa advertencia. Las entregas anuladas dejan de contar para los pendientes y reportes de entregas; las devoluciones aparecen en los movimientos como Devolución y no en el total de compras.

La devolución conserva la fecha de vencimiento de cada lote consumido y el costo promedio exacto en soles de la salida; no se inventa precio para saldos sin valorizar. Los ingresos por devolución son inmutables y se vinculan a la salida original. Se colocan después de las salidas ya registradas del mismo día, antes de las salidas posteriores. Un lote devuelto ya vencido aumenta el saldo vencido, sin habilitarlo para entregar. Se admiten productos con cantidades totales en kg, L y unidad; los despachos anteriores con presentaciones históricas requieren revisión específica.

La migración 008 amplía la restricción de estado, añade un registro inmutable de anulaciones y permite exclusivamente el cambio CONFIRMADO → ANULADO cuando existe una devolución completa validada. Mantiene la protección sobre salidas y documentos, congela también los hijos de despachos anulados y protege las devoluciones en PostgreSQL. No modifica inventario, usuarios, contraseñas o despachos existentes. Se aplica antes del nuevo servidor; las migraciones 001–007 se conservan.

Usuarios organiza la creación en tres campos alineados, separa la explicación de roles y agrupa los controles de rol y contraseña por usuario. Los permisos y credenciales existentes se conservan.

Pruebas: FileStore y PostgreSQL 17 aislados, con permisos equivalentes a japurima_app_v160; revisiones obsoletas, concurrencia, devoluciones únicas, lotes, precios PEN/USD, reapertura parcial/completa, nueva entrega, PDF y protecciones de base de datos. Validación visual con datos ficticios en localhost.
