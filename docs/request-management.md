# Consulta y gestión por código de solicitud

Versión 1.9.0-rc.1. La consulta pública pide únicamente el código. Acepta SOL-000001, sol-000001, el número 1 o el código largo anterior. Los números se asignan en PostgreSQL con una secuencia y no se reciclan al eliminar un pedido. Las solicitudes existentes reciben un número por fecha de creación e identificador, manteniendo el código original como alias y sus PDF históricos.

El usuario autorizó expresamente que cualquier persona que conozca o pruebe un código pueda consultar, editar o eliminar el pedido, sin iniciar sesión ni introducir una clave privada. Los códigos correlativos son adivinables: el número identifica el pedido, no acredita identidad. No se amplía el acceso a usuarios, contraseñas, compras o administración del almacén. Se mantienen el control de origen, los límites de peticiones y la validación de los datos.

La edición se permite para solicitudes de formato actual, pendientes y sin ningún historial de despacho. Reutiliza las reglas de categorías, unidades y cálculo de dosis y vuelve a validar los productos disponibles. El código, la fecha original y el inventario se conservan. Cada edición incrementa la revisión del pedido y la revisión documental, evitando sobrescrituras concurrentes. Los PDF nuevos reflejan la revisión editada; los originales permanecen inmutables.

Eliminar una solicitud significa marcarla CANCELADA y retirarla de las pendientes; la consulta la muestra como Eliminada. No borra movimientos ni cambia el stock. Las solicitudes con entregas confirmadas requieren anular esas entregas desde Despachos antes de eliminarlas. Los pedidos con historial conservan sus productos y cantidades, incluso después de anular las entregas.

Cada edición o eliminación tiene un UUID de operación, resultado persistido y auditoría. Los reintentos repiten el resultado anterior. Se bloquean inventario y solicitud durante la validación y el cambio. La interfaz mantiene los intentos sin respuesta en la sesión del navegador y pide confirmación antes de eliminar.

La migración 009 añade request_number, edit_revision, la secuencia y el registro inmutable de operaciones. El procedimiento replace_pending_request reemplaza únicamente líneas sin despacho y con la revisión esperada; evita conceder DELETE general al rol del aplicativo. Las migraciones 001–008 se conservan. El despliegue no edita ni elimina pedidos reales.

Validación: 74 pruebas aprobadas, incluidos FileStore y PostgreSQL con permisos del aplicativo, correlativos concurrentes, alias antiguos, consulta sin clave, edición con cálculo, revisiones, reintentos, PDF, eliminación sin modificar inventario, protección de entregas y HTTP sin sesión con rechazo de escrituras desde otro origen. Flujo de registro, consulta, edición y eliminación verificado con datos ficticios en localhost.
