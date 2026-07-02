# Asistencia externa (PLOM) + Consolidado — spec de n8n

Cambios de n8n que consumen las vistas de la migración
`supabase/migrations/0002_asistencia_externa.sql`. Se aplican en la UI de n8n contra la
instancia del cliente; el JSON del workflow todavía **no** se versiona en el repo (ver "Fuera
de alcance"). Libro real de referencia: **"INS Externa Chile - Horas OT"**
(`1k9eQn7VL5xkWrHSwTnbC4gMmZ72gzcB0bzfSdtuEJrY`).

## Vistas de origen

| Vista | Uso | Grant a `n8n_reader` |
|---|---|---|
| `public.reporte_externo` | detalle por visita (hoja del parque) | sí (preexistente) |
| `public.resumen_asistencia` | Consolidado (fila por parque) | sí (0002) |

Ambas son *definer* (sin `security_invoker`), así que `n8n_reader` las lee sin tocar RLS ni
las tablas base. La conexión Postgres de n8n usa el usuario `n8n_reader` (ver
`supabase/n8n_role.sql`).

## Branch 1 — Hoja del parque ↔ `reporte_externo`

Con 0002, `reporte_externo` trae `evento_id` (clave de match estable) y una fila por día de
standby completo (`wtg`/horas en `null`, `observacion` = motivo del standby). Con **0003**
(`supabase/migrations/0003_reporte_externo_fix.sql`): `esfuerzo_inicio`/`traslado_min` salen del
ts del evento `traslado_maquina` (traslado real a cada aero), y `finalizar_parque` cierra el día
igual que `salida_parque` (antes, cerrar con "Finalizar parque" dejaba el último aero sin
`esfuerzo_final`/`salida_de_parque`/`tiempo_min`).

Mapeo columna del Sheet → campo de la vista → formato en el nodo Code:

| Columna Sheet | Campo | Formato |
|---|---|---|
| Día / Fecha | `dia` (+ `fecha`) | número / fecha |
| Año | `anio` | número |
| WTG | `wtg` | número (vacío en fila de standby) |
| Esfuerzo inicio | `esfuerzo_inicio` | hora `HH:MM` |
| Traslado | `traslado_min` | **duración** `H:MM` |
| STOP | `parada_aero` | hora `HH:MM` |
| Esfuerzo Final | `esfuerzo_final` | hora `HH:MM` |
| RUN | `inicio_aero` | hora `HH:MM` |
| Salida de parque | `salida_de_parque` | hora `HH:MM` |
| Tiempo | `tiempo_min` | **duración** `H:MM` |
| Observaciones | `observacion` | texto |
| (columna de match, oculta) | `evento_id` → `visita_id` | RAW |

Nodos:

1. **Postgres "Leer reporte_externo"**
   `select * from public.reporte_externo where pais = $1 order by fecha, parada_aero nulls last;`
   **Sin watermark**: el dataset (campaña externa) es chico y el *Append or Update* dedupe por
   `evento_id`; un sync completo por corrida auto-sana anulaciones y sincronizaciones tardías.
   Se puede quitar el nodo "Guardar watermark" de este branch.

2. **Code "Formatear asistencia"** — mapea a las columnas de arriba. Dos correcciones respecto
   del formateo previo:
   - `Traslado` = **duración** de `traslado_min` (minutos → `H:MM`), no una hora. Desde 0003 es
     `parada_aero − ts(traslado_maquina)` = tiempo real de traslado a ese aero.
   - `Tiempo` = **duración** de `tiempo_min` (ya viene como `salida_de_parque − última salida
     del día` desde la vista).
   Emitir solo las columnas del Sheet + `visita_id = evento_id`.

3. **Google Sheets "hoja del parque"** — operación *Append or Update*:
   - `documentId`: por expresión país → libro (placeholders `REEMPLAZAR_ID_LIBRO_ASISTENCIA_AR/CL`).
   - `sheetName`: `{{ $json.parque_nombre }}`.
   - `matchingColumns`: `["visita_id"]`.
   - `cellFormat`: `RAW`.

## Branch 2 — Consolidado ↔ `resumen_asistencia`

Cuelga del disparador "Países a las 20:00". Encabezado real de la pestaña `Consolidado`:
`N° · Parque · Responsable · Turbinas a Inspeccionar · Turbinas Inspeccionadas · WTG PEND ·
% Avance · Horas Stan By · Promedio Insp diaria · Fecha Inicio · Fecha Termino`.

Mapeo:

| Columna Sheet | Campo | Formato |
|---|---|---|
| N° | (índice + 1) | número |
| Parque | `parque` | texto |
| Responsable | `responsable` | texto |
| Turbinas a Inspeccionar | `turbinas_objetivo` | número |
| Turbinas Inspeccionadas | `inspeccionadas` | número |
| WTG PEND | `pendientes` | número |
| % Avance | `pct_avance` | `NN.NN%` |
| Horas Stan By | `horas_standby_min` | `H:MM:SS` |
| Promedio Insp diaria | `prom_diario` | número |
| Fecha Inicio | `fecha_inicio` | `DD-MM-YYYY` |
| Fecha Termino | `fecha_termino` | `DD-MM-YYYY` |

Nodos:

1. **Postgres "Leer resumen_asistencia"**
   `select * from public.resumen_asistencia where pais = $1 order by parque;`

2. **Code "Formatear consolidado"** — arma la matriz de filas: `N°` = índice + 1, `% Avance`
   como `NN.NN%`, `Horas Stan By` = `horas_standby_min` (minutos → `H:MM:SS`), fechas
   `DD-MM-YYYY`.

3. **Google Sheets "Consolidado"** — operación *Update* (no Append): sobreescribe el bloque de
   datos desde `Consolidado!B2` en cada corrida → idempotente, respeta el orden del `N°`, sin
   columna de match. La fila 1 (título/encabezado) no se toca.

## Fuera de alcance

- Versionar el JSON del workflow en `n8n/` y pegar los IDs reales de libro AR/CL.
- Reporte **interno** (`reporte_planilla` + `reporte_resumen`) en su propio libro/branch.
