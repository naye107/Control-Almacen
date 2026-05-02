# Publicar JAPURIMA en Render

Para usar el sistema desde cualquier lugar necesita publicarlo en un hosting con URL publica.

## Opcion recomendada: Render

El proyecto ya incluye `render.yaml`, que crea:

- Un Web Service Node.js.
- Un disco persistente en `/var/data`.
- Health check en `/api/health`.

## Pasos

1. Cree una cuenta en Render: https://render.com
2. Suba este proyecto a GitHub.
3. En Render, vaya a `New` y elija `Blueprint`.
4. Conecte el repositorio de GitHub donde subio este proyecto.
5. Render detectara `render.yaml`.
6. Apruebe la creacion del servicio.
7. Cuando termine el deploy, Render le dara una URL como:
   - `https://japurima-almacen.onrender.com`

## Variables

En Render quedaran asi:

- `DATA_DIR=/var/data`

El archivo de datos se guardara en:

```text
/var/data/inventory.json
```

## Comandos de Render

Render usara:

```text
Build Command: npm install
Start Command: npm start
```

## Importante

- No use un servicio gratuito sin disco para datos reales.
- El disco persistente evita que se pierda `inventory.json` cuando Render redeploya o reinicia.
- Si cambia codigo en GitHub, Render redeploya automaticamente.

## Recomendacion

Para comenzar, use un solo servicio con disco persistente. Mas adelante, si el sistema crece, conviene migrar los datos a una base de datos real como PostgreSQL.

## Seguridad

Si publica el sistema sin usuario y clave, cualquier persona con la URL podra entrar.

Para volver a activar clave, agregue estas variables en Render:

```text
APP_USER=admin
APP_PASSWORD=una-clave-segura
```
