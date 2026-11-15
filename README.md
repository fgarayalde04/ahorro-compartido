# Ahorro Compartido · MVP

Beneficio de ahorro con aporte compartido: la empresa iguala lo que ahorra cada empleado (1 a 1, hasta el 15% del sueldo) y todo se invierte en ETF globales (MSCI World o S&P 500), en una subcuenta a nombre de cada empleado.

Proyecto de **Nuevos Emprendimientos · Universidad ORT Uruguay · 2026**.

## Qué tiene

| Ruta | Para quién | Qué hace |
| --- | --- | --- |
| `/app` | Empresas y empleados | **El producto.** La empresa se registra, define cuánto aporta (iguala hasta 1 a 1, con tope) y el vesting, carga a sus empleados con su sueldo y les manda un link de invitación. Cada empleado crea su cuenta, elige aporte y ETF (URTH o SPY) y autoriza el descuento. La empresa aprueba el cierre de cada mes y el sistema registra las cuotas al precio real de mercado. El empleado ve el valor de su cuenta, el rendimiento, la TIR, el vesting y sus movimientos. |
| `/` | Todos | Página del producto, con acceso para empresas y empleados. |
| `/encuesta` | Empleados | Encuesta de validación: calcula el ahorro, pregunta si se sumarían y guarda la respuesta. Para medir por empresa: `/encuesta#isl`. |
| `/admin` | Equipo | Panel con resultados en vivo: embudo, métricas contra los umbrales, respuestas, pedidos de propuesta, registro de entrevistas y descarga en CSV. |

Para medir la encuesta por empresa, cada link lleva un código: `https://TU-DOMINIO/encuesta#isl`, `/encuesta#prometeo`.

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

- Es un MVP concierge: el sistema calcula y registra todo con precios reales (Yahoo Finance), pero la transferencia del dinero y la compra en el custodio las ejecuta el equipo a mano.
- Sin `DATABASE_URL` la app usa una base en memoria (`pg-mem`) para desarrollo; `PRICE_MOCK=1` genera precios sintéticos sin internet.
- La landing aclara a los participantes que es un proyecto de estudiantes y que sus respuestas son anónimas, salvo que dejen su contacto.
