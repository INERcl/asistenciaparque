# n8n — Export Check-in → Google Sheets

n8n lee las **vistas de reporte** de Supabase (nunca las tablas base) y llena la **planilla
Google Sheets legada** que usa el equipo no técnico. La base es la fuente de verdad; el pivot lo
hacen las vistas en Postgres y n8n solo mueve filas a la pestaña correcta, idempotente.

- Modelo de datos y ruteo: `../MODELO_RECONCILIADO.md`, `../PLAN_N8N.md`.
- Mapeo de columnas del branch externo + Consolidado: `../ASISTENCIA_EXTERNA.md`.
- Rol read-only y grants: `../supabase/n8n_role.sql`.

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `checkin-export.workflow.json` | **Export del workflow** desde la instancia del cliente. Ver "Versionar el workflow". |
| `README.md` | Este documento (import, credenciales, mapa de libros, cómo correr). |

## Branches del workflow

Un cron por país a las **20:00 hora local** (TZ de `paises.tz`); cada trigger setea `{{pais}}` y el
`spreadsheetId` del libro de ese país.

1. **Interno (planilla legada AR)** — `public.reporte_planilla` / `reporte_resumen`.
   Formato ancho, 1 fila por (grupo, parque, día); turbinas WTG 1/2/3 expandidas desde el JSON
   `visitas`. Ruteo: `subtipo='interno' & pais='argentina'` → pestaña del equipo (X-C / F-K).
   Idempotencia: `row_key = grupo_clave|parque_id|fecha`. *(Branch pendiente de armar; ver
   `../PLAN_N8N.md`.)*
2. **Externo (PLOM)** — `public.reporte_externo`. 1 fila **por aero visitado** (más una fila por
   día de standby completo). Idempotencia: **`visita_id = evento_id`** (Append or Update).
   Mapeo de columnas: `../ASISTENCIA_EXTERNA.md` §Branch 1.
3. **Consolidado** — `public.resumen_asistencia`. 1 fila por parque; operación *Update* del bloque
   `Consolidado!B2` (idempotente, sin columna de match). Mapeo: `../ASISTENCIA_EXTERNA.md` §Branch 2.

> Nota de datos (migración `0003`): en `reporte_externo`, `esfuerzo_inicio`/`traslado_min` salen del
> ts del evento `traslado_maquina`, y `finalizar_parque` cierra el día igual que `salida_parque`
> (el último aero ya no pierde `esfuerzo_final`/`salida_de_parque`). Reaplicar el `NOTIFY pgrst`
> tras correr la migración para refrescar el esquema de PostgREST.

## Credenciales (configurar en n8n, una vez)

1. **Postgres** → usuario `n8n_reader` (solo lectura). Cadena del pooler de Supabase, puerto 5432
   modo sesión, db `postgres`. Crear el rol con `../supabase/n8n_role.sql`.
2. **Google Sheets OAuth2** → cuenta del equipo con permiso de edición sobre los libros.

## Mapa país → libro (spreadsheetId)

Configurar en un nodo `Set` / variables de entorno. Reemplazar los placeholders por los IDs reales.

| País | Variable | spreadsheetId |
|---|---|---|
| Chile (externo) | `SHEET_CL` | `1k9eQn7VL5xkWrHSwTnbC4gMmZ72gzcB0bzfSdtuEJrY` — "INS Externa Chile - Horas OT" |
| Argentina | `SHEET_AR` | `REEMPLAZAR_ID_LIBRO_ASISTENCIA_AR` |
| Perú / Uruguay | `SHEET_PE` / `SHEET_UY` | *(sin datos aún)* |

Dentro de cada libro, el nombre de la **pestaña** del branch externo = `{{ $json.parque_nombre }}`;
el `Consolidado` es una pestaña fija. Para el branch interno: `equipo → pestaña` (`01. Equipo X-C`,
`02. Equipo F-K`) y `Resumen`.

## Versionar el workflow

El JSON del workflow todavía se edita en la UI de n8n contra la instancia del cliente. Para dejarlo
en el repo:

1. En n8n: abrir el workflow → menú `⋯` → **Download** (o *Export*).
2. Guardar el archivo como `n8n/checkin-export.workflow.json`.
3. Antes de commitear, reemplazar cualquier secreto embebido (IDs de credenciales están OK; **no**
   commitear tokens ni contraseñas) y dejar los `spreadsheetId` reales o los placeholders `SHEET_*`.

## Correr

- **Manual**: abrir el workflow → *Execute Workflow* (o *Test step* sobre el nodo Schedule del país).
- **Cron**: activar el workflow; cada Schedule dispara a las 20:00 de su TZ. Verificar que la TZ del
  trigger coincida con `paises.tz`.

## Verificación

Ver `../PLAN_N8N.md` §Verificación (idempotencia por re-corrida, anulaciones/datos tardíos) y
`../ASISTENCIA_EXTERNA.md` para el formato esperado de cada hoja.
