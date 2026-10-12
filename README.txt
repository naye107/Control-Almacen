JAPURIMA — CANDIDATA DE PRODUCCIÓN 1.6.0-rc.1
Preparación, no despliegue. Consultar ../../docs/preparacion-corte-seguro-2026-10-12.txt.
Arranque previsto: npm ci; npm start. Requiere NODE_ENV=production, PostgreSQL autorizado con migraciones 001–007 registradas, PUBLIC_ORIGIN HTTPS exacto y credenciales privadas restringidas. No iniciar sobre producción durante la preparación.
El comando migrate conserva el bloqueo de producción. No eludir staging-policy. Falta ejecutor específico autorizado para la ventana y validación real en copia nueva.
Prueba local sin PostgreSQL ni conexiones externas: node --test test/*.test.cjs.
Los datos sintéticos de test/ no se cargan al arrancar el servicio. No hay datos ni usuarios predeterminados en el paquete.
