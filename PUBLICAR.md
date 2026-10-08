# Publicación y activación — Fase 1

No se ha realizado ningún despliegue ni migración de producción. Publicar requiere autorización adicional.
`render.yaml` es configuración preparada; no ejecuta migraciones al iniciar.

Antes de publicar:

1. Validar la versión en una base PostgreSQL de desarrollo y en staging.
2. Crear un respaldo consistente de la base real con `pg_dump` y verificar su restauración en otra base.
3. Aprobar la ventana de mantenimiento y detener todos los escritores antiguos del inventario.
4. Aplicar la migración explícita siguiendo `docs/FASE1.md`; conservar el respaldo y datos nuevos.
5. Crear el administrador con contraseña privada, sin reutilizar credenciales antiguas predeterminadas.
6. Actualizar servidor/frontend conjuntamente y exigir recarga de pestañas antiguas.
7. Configurar DATABASE_URL, NODE_ENV=production y PUBLIC_ORIGIN con origen HTTPS sin barra final.
8. Configurar TRUST_PROXY=1 únicamente si la aplicación está detrás del proxy de confianza del hosting.
9. Verificar login, permisos, consultas, compras, salidas, conflictos, exportaciones y acceso público.

No use el almacenamiento de archivos en producción. El proceso de aplicación no crea tablas automáticamente.
Las credenciales APP_USER/APP_PASSWORD ya no autentican. Las cuentas se gestionan mediante hashes en `users`.
Las instrucciones detalladas y la estrategia de reversión están en [docs/FASE1.md](docs/FASE1.md).
