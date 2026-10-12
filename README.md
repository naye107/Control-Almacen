# JAPURIMA — demostración aislada

Paquete de la implementación actual, con backend y frontend de la misma copia.
Incluye las correcciones del backend asociadas a 006, pero usa FileStore:
no ejecuta PostgreSQL, migraciones SQL ni certifica los triggers de 006.

Contiene exclusivamente tres productos ficticios. No contiene datos históricos,
usuarios anteriores, contraseñas, respaldos, claves ni conexiones de Neon.
No introducir solicitudes, nombres personales o registros empresariales reales.
Las altas y despachos de práctica cambian únicamente estos datos temporales.

Render: servicio nuevo `japurima-demo`, rama exclusiva, Node 24.19.0.
Build: `npm ci`. Start: `npm start`. Health: `/api/ready`.
Seleccionar Free; no asociar bases, discos ni servicios existentes.
Variables privadas: `DEMO_ADMIN_USERNAME` y `DEMO_ADMIN_PASSWORD` (12–256 caracteres).
No usar una contraseña de producción. Ninguna cuenta predeterminada.
`RENDER_EXTERNAL_URL` define el origen HTTPS; no configurar `DATABASE_URL`.
`RESOURCE_RSS_LIMIT_MIB=384`, `DOCUMENT_CONCURRENCY=2`, `NODE_ENV=production`.
HTTPS, cookies Secure/HttpOnly, CSRF y autorizaciones permanecen activos.

Portada: `/`. Almacén: `/index.html`. Crear ALMACENERO desde Usuarios.
Al iniciar se crea un almacén nuevo: todos los datos de práctica se reinician.
Render Free puede suspenderse por inactividad y reiniciar archivos; no usar
este servicio para solicitudes reales ni como registro permanente.

Producción y laboratorios de evidencia no se conectan ni modifican.

## Tres roles (actualización de demostración)

- ADMINISTRADOR: administración completa, usuarios, catálogo y movimientos.
- ALMACENERO: registra compras/ingresos, salidas y despachos; consulta productos,
  existencias y Kardex. No cambia stock inicial/catálogo ni edita o elimina historia.
- SUPERVISOR: consulta productos, cantidades, existencias y Kardex. Las escrituras
  y endpoints operativos/administrativos están bloqueados en el servidor.

Compras es el módulo de ingresos existente; no se crea un segundo ingreso duplicado.
Registrar un despacho sigue generando su salida automáticamente.
La cuenta SUPERVISOR puede cerrar sesión y autenticarse, acciones de seguridad;
la solicitud pública continúa disponible para trabajadores sin autenticación.
Cambiar rol revoca las sesiones anteriores. Se protege al último administrador.

Validación local: node --test test/roles.test.cjs. Usa HTTP y FileStore desechable;
no usa PostgreSQL ni ensayos históricos. El PostgreSQL preparado en 001–006
conserva la restricción de dos roles: se requiere una migración incremental futura
para SUPERVISOR antes de integrar este cambio en PostgreSQL/producción.
No se modificaron ni ejecutaron las migraciones 001–006.
