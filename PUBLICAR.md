# Publicar JAPURIMA en Render

Para usar el sistema desde cualquier lugar necesita publicarlo en un hosting con URL publica.

## Opcion recomendada: Render

El proyecto ya incluye `render.yaml`, que crea:

- Un Web Service Node.js.
- Conexion a PostgreSQL mediante `DATABASE_URL`.
- Variables secretas para el login.
- Health check en `/api/health`.

## Pasos

1. Cree una cuenta en Render: https://render.com
2. Suba este proyecto a GitHub.
3. En Render, vaya a `New` y elija `Blueprint`.
4. Conecte el repositorio de GitHub donde subio este proyecto.
5. Render detectara `render.yaml`.
6. Cree una base PostgreSQL gratuita en Neon o Supabase y copie su connection string.
7. Cuando Render pida variables secretas, escriba:
   - `DATABASE_URL`: la cadena de conexion PostgreSQL
   - `APP_USER`: su usuario, por ejemplo `admin`
   - `APP_PASSWORD`: una clave segura
8. Apruebe la creacion del servicio.
9. Cuando termine el deploy, Render le dara una URL como:
   - `https://japurima-almacen.onrender.com`

## Variables

En Render quedaran asi:

- `DATABASE_URL`: secreto, lo copia desde Neon o Supabase
- `APP_USER`: secreto, lo escribe usted
- `APP_PASSWORD`: secreto, lo escribe usted

Los datos se guardaran en PostgreSQL en la tabla:

```text
inventory_state
```

## Comandos de Render

Render usara:

```text
Build Command: npm install
Start Command: npm start
```

## Importante

- No guarde datos reales en archivo dentro de Render gratis.
- PostgreSQL evita que se pierdan datos cuando Render redeploya o reinicia.
- En produccion, el sistema no iniciara si falta `DATABASE_URL`.
- Si cambia codigo en GitHub, Render redeploya automaticamente.

## Recomendacion

Para comenzar, use Render para la web y Neon o Supabase para PostgreSQL gratuito.

## Seguridad

Use una clave larga y cambiela si sospecha que alguien mas la conoce.
