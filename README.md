# Ahorro Compartido · MVP

Beneficio de ahorro con aporte compartido: la empresa iguala lo que ahorra cada empleado (1 a 1, hasta el 15% del sueldo) y todo se invierte en ETF globales (MSCI World o S&P 500), en una subcuenta a nombre de cada empleado.

Proyecto de **Nuevos Emprendimientos · Universidad ORT Uruguay · 2026**.

## Qué tiene

| Ruta | Para quién | Qué hace |
| --- | --- | --- |
| `/` | Empleados | Landing para validar la demanda: calcula el ahorro, pregunta si se sumarían y guarda la respuesta. |
| `/demo` | Decisores de RR.HH. | Prototipo navegable del producto: portal de la empresa y app del empleado. Incluye el botón "Pedí la propuesta para tu empresa". |
| `/admin` | Equipo | Panel con resultados en vivo: embudo, métricas contra los umbrales, respuestas, pedidos de propuesta, registro de entrevistas y descarga en CSV. |

Para medir por empresa, cada link lleva un código: `https://TU-DOMINIO/#isl`, `/#prometeo`, `/#blend`.

## Publicar en Railway

1. Subir este proyecto a un repositorio de GitHub.
2. En [railway.com](https://railway.com): **New Project → Deploy from GitHub repo** y elegir el repositorio.
3. En el mismo proyecto: **New → Database → PostgreSQL**. Railway crea la variable `DATABASE_URL`.
4. En el servicio de la app, pestaña **Variables**:
   - `DATABASE_URL` → referenciar la de Postgres (`${{Postgres.DATABASE_URL}}`).
   - `ADMIN_PASSWORD` → la clave del panel del equipo.
5. En **Settings → Networking → Generate Domain** para obtener la URL pública.

Railway detecta Node, instala dependencias y corre `npm start`. La tabla se crea sola al iniciar.

## Correr localmente

```bash
npm install
ADMIN_PASSWORD=una-clave npm start
# http://localhost:3000
```

Sin `DATABASE_URL`, los datos se guardan en `data.json` (solo para desarrollo).

## Aclaraciones

- Es un MVP académico: no mueve dinero ni está conectado a un custodio. Los rendimientos del prototipo son simulados a partir del rendimiento histórico aproximado de los índices (~10% anual en dólares).
- La landing aclara a los participantes que es un proyecto de estudiantes y que sus respuestas son anónimas, salvo que dejen su contacto.
