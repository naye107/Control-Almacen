# Publicar JAPURIMA en Render

Para usar el sistema desde cualquier lugar necesita publicarlo en un hosting con URL publica.

## Opcion recomendada: Render

El proyecto ya incluye `render.yaml`, que crea:

- Un Web Service Node.js.
- Un disco persistente en `/var/data`.
- Variables secretas para el login.
- Health check en `/api/health`.

## Pasos

1. Cree una cuenta en Render: https://render.com
2. Suba este proyecto a GitHub.
3. En Render, vaya a `New` y elija `Blueprint`.
4. Conecte el repositorio de GitHub donde subio este proyecto.
5. Render detectara `render.yaml`.
6. Cuando Render pida variables secretas, escriba:
   - `APP_USER`: su usuario, por ejemplo `admin`
   - `APP_PASSWORD`: una clave segura
7. Apruebe la creacion del servicio.
8. Cuando termine el deploy, Render le dara una URL como:
   - `https://japurima-almacen.onrender.com`

## Variables

En Render quedaran asi:

- `DATA_DIR=/var/data`
- `APP_USER`: secreto, lo escribe usted
- `APP_PASSWORD`: secreto, lo escribe usted

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

Use una clave larga y cambiela si sospecha que alguien mas la conoce.
