# JAPURIMA

Sistema web simple para controlar fertilizantes en almacen.

## Modulos

- Productos: nombre comercial, materia activa, categoria, presentacion, unidad, stock inicial y stock minimo.
- Compras: registra entradas por proveedor, cantidad, lote y documento.
- Salidas: registra egresos por destino, cantidad, motivo y responsable.
- Existencias: muestra stock actual, alertas y kardex.

## Uso en una computadora

1. Abra `iniciar-sistema.bat`.
2. Se abrira una ventana llamada `JAPURIMA Servidor`. Deje esa ventana abierta.
3. El navegador debe abrir `http://localhost:8080` automaticamente.

La informacion se guarda en `data/inventory.json`, dentro de esta carpeta del sistema.

Usuario local por defecto:

- Usuario: `admin`
- Clave: `admin123`

## Uso desde celular u otra computadora

1. La computadora que ejecuta `iniciar-sistema.bat` y los demas equipos deben estar en la misma red WiFi.
2. En el celular o computadora, abra la direccion de red que aparece en la ventana `JAPURIMA Servidor`, por ejemplo `http://192.168.1.20:8080`.
3. Si Windows pregunta por permiso de red para Node.js, permita el acceso en redes privadas.

Si el sistema esta publicado en Render, todos deben entrar con la misma URL publica de Render. Los cambios se sincronizan automaticamente cada pocos segundos; tambien puede actualizar la pagina para verlos al instante.

En Render, los datos se guardan en PostgreSQL mediante `DATABASE_URL`.

## Nota

Para entrar desde fuera del local o desde cualquier internet, publique el sistema siguiendo [PUBLICAR.md](PUBLICAR.md).
