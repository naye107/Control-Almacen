# Aplicación y fertilización

Versión 1.9.1-rc.1. En solicitudes de agroquímicos, Tipo de trabajo permite elegir Aplicación o Fertilización. Aplicación mantiene las modalidades Por cilindros y Por tanques y calcula cada total multiplicando dosis por cantidad de recipientes. Fertilización oculta esos controles y pide la cantidad total de cada producto en su unidad.

El servidor conserva los formatos anteriores. Para fertilización guarda applicationMode=FERTILIZACION, containerCount=null y doseQuantity=null; cada quantity se valida y se usa directamente, sin multiplicaciones. Rechaza dosis y cantidades de recipientes en una fertilización. Se mantienen las reglas de precisión, productos habilitados y unidades enteras para unidad.

La elección se conserva en borradores, consulta, edición, comprobante y PDF. Editar una solicitud pendiente permite pasar de un tipo a otro; el servidor vuelve a calcular y validar cada línea. Los despachos descuentan únicamente el total guardado. Las solicitudes y los PDF históricos conservan sus datos y bytes.

La migración 010 amplía la restricción de solicitudes para aceptar fertilización sin recipientes. No cambia filas, movimientos, productos, usuarios ni contraseñas. Las migraciones 001–009 permanecen intactas. El despliegue aplica la migración antes del servidor nuevo.

Validación: 77 pruebas aprobadas, incluidos PostgreSQL con permisos del aplicativo, cantidades directas, cálculo por recipientes, rechazo de combinaciones inválidas, creación, reintento, edición entre tipos, consulta, PDF y despacho. Revisión visual del formulario y del registro de un pedido ficticio en localhost.
