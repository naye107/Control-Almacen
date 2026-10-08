# Despliegue y recuperación — procedimiento sujeto a autorización

Esta guía no ejecuta acciones. La producción existente permanece sin cambios. La Fase 5B necesita autorización adicional. No hay migraciones automáticas al iniciar el servidor ni comandos de migración en render.yaml.

## Preparación y ensayo

1. Identificar commit, rama y versión realmente desplegados; registrar el endpoint, base, versión PG, propietarios y todos los servicios/tareas que escriben. La versión anterior del repositorio utiliza UPSERT sin versión; no asumir que cerrar su UI cierra sus conexiones.
2. Revisar configuración y alertas, región, tamaño del JSONB y crecimiento de documentos/auditoría. Si el inventario supera 16 MiB, detener la preparación hasta ajustar y ensayar los límites dentro del máximo configurado; no truncar ni sustituir JSONB.
3. Separar cuentas: propietario/migrador offline, aplicación sin propiedad/superusuario/CREATE ni herencia del propietario, respaldo de lectura. Crear passwords aleatorios por canal privado; no escribir credenciales en Git, URLs de logs ni comandos compartidos. Revisar privilegios PUBLIC, herencias y membresías; la plantilla no limpia todas las concesiones históricas automáticamente.
4. Crear respaldo de código, configuración y base; verificarlo como abajo. Aplicar 001–005 solo en la copia y ejecutar la suite, el circuito operativo y el plan de reversión. Comprobar que solicitudes no descuenten stock, y que cada despacho produzca una sola salida por detalle.
5. Preparar Render: Node 24.19.0, instancia propuesta 1 CPU/2 GB, npm ci, npm start, auto-deploy apagado, /api/ready, origen HTTPS exacto y DATABASE_URL restringida. TRUST_PROXY solo después de comprobar la cadena real. No modificar la región existente ni contratar planes sin aprobación.
6. Planificar ventana según el tiempo medido de respaldo/restauración/migración. Asignar responsable técnico, encargado de almacén y autoridad para reabrir. Mantener fuera del tráfico público el candidato durante pruebas.

## Respaldo consistente y restauración

Usar conexión PostgreSQL directa y cliente compatible. Configurar servicios y passwords en archivos privados protegidos por ACL (.pg_service.conf/.pgpass o mecanismo equivalente), fuera de Git. No usar la URL con contraseña como argumento visible. Ejemplos, únicamente con destinos previamente verificados:

~~~text
pg_dump --dbname=service=japurima_backup --format=custom --file=respaldo.dump
pg_restore --dbname=service=japurima_restore_aislada --exit-on-error --single-transaction --no-owner --no-privileges respaldo.dump
~~~

El destino de restauración debe estar vacío y aislado. No usar --clean sobre producción. El dump completo incluye datos y definiciones de una base; documentar por separado roles, concesiones, extensiones, configuración y plataforma. --no-privileges requiere reaplicar permisos en el destino y comprobarlos con la cuenta de aplicación.

- Verificar código de salida y advertencias; calcular SHA-256 y tamaño.
- Cifrar, copiar a almacenamiento externo privado y volver a comprobar integridad tras descargar/descifrar.
- Restaurar completamente. Comparar conteos y huellas SHA-256 de contenidos ordenados por tabla; para el JSONB conservar IDs, unidades, cantidades, fechas y extensiones, sin reinterpretación.
- Verificar documentos contra sus hashes y vínculos detalle/salida; ejecutar el arranque con el rol restringido.
- Documentar tiempo de restauración real. Un archivo existente o un SHA coincidente por sí solos no prueban que sea restaurable.

Política propuesta: recuperación temporal Neon de siete días, respaldos externos diarios, cuatro semanales y doce mensuales, simulacro mensual. Aprobar RPO y RTO con el almacén. Un dump diario solo ofrece hasta 24 horas de pérdida potencial; la recuperación temporal requiere configuración y prueba. Objetivo RTO de dos horas pendiente de medir con producción. Presupuesto del diagnóstico US$59–89/mes es orientativo, sujeto a consumo, impuestos, transferencia y cuentas de plataforma.

## Corte futuro de escritores

1. Activar mantenimiento externo en el servicio actual según la plataforma aprobada y detener tareas auxiliares. El flag nuevo no protege al servidor anterior.
2. Inventariar pg_stat_activity y conexiones, relacionando usuario y application_name con servicios, jobs y equipos. Los datos visibles dependen del rol inspector. Conexiones inactivas también pueden volver a escribir.
3. Detener servidores antiguos; aislar su login/concesiones y cerrar sus conexiones con el migrador autorizado. No ejecutar indiscriminadamente pg_terminate_backend: filtrar por base, rol y PIDs verificados, excluyendo respaldo y migración.
4. Si la credencial antigua es propietaria, REVOKE aislado no elimina su capacidad inherente. Requiere detener servicios, separar propiedad y rotar/aislar esa credencial bajo autorización. No compartirla con la nueva aplicación.
5. Confirmar ausencia de escritores y transacciones en curso; tomar respaldo final y huella del corte. Mantener bloqueo de escritura durante su verificación y restauración aislada.
6. En la copia, mantener una sesión del escritor antiguo y comprobar que el UPDATE/UPSERT recibe rechazo después de 005. El bloqueo de protocolo complementa el aislamiento; no garantiza defensa frente a un propietario que desactive triggers.

No permitir operación paralela de la aplicación antigua después del corte. Los clientes con revisiones anteriores recibirán conflictos/rechazos y conservarán datos pendientes; no reaplicar automáticamente snapshots antiguos completos.

## Migraciones y publicación

1. Confirmar nuevamente host/base y ausencia de escritores. No importar data/inventory.json ni ejecutar un reset.
2. Usar cuenta migradora y conexión directa. El comando explícito exige confirmación de destino y, con NODE_ENV=production, --allow-production. Esas opciones solo pueden usarse después de autorización; cambiar NODE_ENV no sustituye la aprobación.
3. Ejecutar el migrador oficial para 001–005. Verifica checksums, orden y bloqueo asesor, con transacción única para las pendientes, statement_timeout=60s, lock_timeout=5s e idle=60s. Si un índice requiere más tiempo, medir y preparar un ajuste controlado antes del corte; no desactivar límites improvisadamente.
4. Comprobar inventario y movimientos iguales al corte. Verificar versiones, triggers, índices y referencias. Si hay históricos relacionales incoherentes, documentarlos y resolver el ensayo; no borrarlos para pasar la migración.
5. Aplicar permisos de aplicación con cuenta separada. Crear administrador por terminal interactiva cuando no exista. No distribuir su contraseña ni conceder permisos ALMACENERO de administración.
6. Publicar servidor y frontend del mismo commit, con mantenimiento externo todavía activo. MAINTENANCE_MODE=1 en el candidato bloquea mutaciones y PDF pero permite readiness. Los servicios viejos deben seguir detenidos/aislados aunque Render solape procesos durante el cambio.
7. Verificar HTTP, DB, usuarios, roles, TLS/origen, datos, reportes y descargas existentes. No inventar despachos de prueba en producción: usar comprobaciones de lectura y el ensayo aislado.
8. Desactivar mantenimiento interno bajo cobertura del mantenimiento externo; completar comprobaciones; retirar el mantenimiento externo únicamente con aprobación del encargado. Recargar clientes antiguos y comprobar revisiones antes de registrar nuevos movimientos.
9. Supervisar primeras operaciones reales, errores 409/503/429, memoria, latencia y conexiones. Guardar evidencia del corte y revisar conciliación diaria.

## Reversión sin perder movimientos posteriores

**Antes de reabrir**, si no hubo operaciones nuevas: revertir a un código compatible y conservar tablas nuevas. 005 rechaza el escritor antiguo; no volver a una versión que omita el protocolo. Una retirada excepcional de protecciones solo puede evaluarse con escritura congelada, respaldo y autorización independiente. No aplicar una migración descendente destructiva.

**Después de reabrir**:

1. Bloquear nuevas escrituras y esperar transacciones; preservar formularios y resultados inciertos mediante sus IDs de operación.
2. Obtener un respaldo actualizado y enumerar las operaciones desde la huella del corte: compras, salidas, inventario, solicitudes, despachos, documentos, auditoría y revisiones. La auditoría y claves idempotentes ayudan a reconciliar, pero no existe un sistema automático de reproducción general del historial.
3. Preferir corrección hacia adelante o última versión compatible con 005. No reconectar el UPSERT antiguo.
4. Si fuera necesaria una restauración, recuperar primero en una base paralela. Reconciliar los movimientos posteriores desde el respaldo actualizado mediante un procedimiento ensayado y revisado: mismos IDs, cantidades exactas, vínculos e idempotencia; sin descontar de nuevo salidas ya contabilizadas.
5. Comparar stock, Kardex, saldos de solicitudes, estados, vínculos y documentos. Si la reconciliación no está completa, mantener mantenimiento; no reabrir una base antigua incompleta.
6. Redirigir únicamente después de aprobar la conciliación; conservar la base actual y sus respaldos para investigación.

Un dump previo o una recuperación temporal anterior al fallo pueden omitir movimientos válidos posteriores. Nunca sobrescribir la base actual con ese estado sin recuperación y reconciliación de dichos movimientos.

## Puertas para Fase 5B

- Copia real de producción restaurada y ensayo con volumen real completado.
- Todos los escritores y propietarios identificados; aislamiento y reapertura ensayados.
- Privilegios efectivos, conexiones pooled/directas, TLS, proxy, origen y región comprobados.
- Firefox, Safari/iOS, celulares/tablets reales e impresión física validados o pendientes aceptados explícitamente.
- Almacenamiento externo cifrado, retención, monitoreo, alertas y responsables operativos definidos.
- Consumo/costos verificados dentro del presupuesto; versión LTS revisada nuevamente.
- Autorización expresa para cambiar credenciales, migrar Neon y publicar Render.
