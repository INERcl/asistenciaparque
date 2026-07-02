# Modelo reconciliado — INER Check-in

Referencia única del modelo de datos. Reconcilia `PLAN.md` (event-log oficial,
offline-first) con el prototipo del usuario `flujo no oficial.jpg`. El esquema vive en
`supabase/migrations/0001_init.sql` + migraciones incrementales; el seed en `supabase/seed.sql`.
El downstream (n8n → Google Sheets) está en `PLAN_N8N.md` y `ASISTENCIA_EXTERNA.md`.

Migraciones incrementales sobre 0001:
- **0002** — `reporte_externo` con `evento_id` + rama "día de standby"; vista **`resumen_asistencia`**
  (Consolidado externo, 1 fila por parque) para el branch de n8n.
- **0003** — `reporte_externo`: `finalizar_parque` cierra el día igual que `salida_parque`;
  `esfuerzo_inicio`/`traslado_min` desde el ts de `traslado_maquina`.
- **0004** — config por país en `paises` (`permite_interno/externo`, `usa_almuerzo/equipos`); la app
  filtra parques por país del técnico y ajusta el set de botones (data-driven).

## Principios

- **`eventos` append-only es la base.** Cada botón es un evento con hora exacta que cierra
  el segmento anterior. El UUID de cliente hace los inserts idempotentes (reintentar no
  duplica) — clave para la cola offline.
- **`flujo` del prototipo NO es una tabla:** es la fila final de la planilla, que se obtiene
  como **vista derivada** (`reporte_planilla`) pivoteando los eventos por día.
- **Offline 1-2 días** (no semanas): cola en IndexedDB + UUID idempotente; al reconectar se
  sube todo y n8n parsea por fecha.
- **Sesión persistente:** login una vez; *finalizar parque NO desloguea* (solo cierra la
  asignación). Gate: ¿sesión? → ¿asignación activa? → check-in.
- **Auth en Supabase Auth:** `tecnicos` 1:1 con `auth.users`; nunca se guarda contraseña.

## Entidades

| Tabla | Rol | Notas |
|---|---|---|
| `paises` | catálogo + **TZ** + config | `tz` IANA centraliza TZ_POR_PAIS; `permite_interno/externo` y `usa_almuerzo/equipos` (0004) limitan la vista del técnico (data-driven) |
| `empresas` | operadores | solo Chile agrupa por empresa |
| `parques` | catálogo | `turbinas` = conteo; `empresa_id` nullable (AR sin empresa) |
| `aeros` | **catálogo de aerogeneradores** | uno por turbina; el técnico elige el número |
| `equipos` | equipos de inspección | **solo AR interna** (X-C, F-K) |
| `tecnicos` | perfil 1:1 auth.users | `usuario` (login, unique), `nombre` (planilla), `subtipo` interno/externo, `equipo_id` nullable, `activo`. Contraseña en `auth.users` |
| `asignaciones` | parque activo por técnico | una activa (índice único parcial) |
| `jornadas` | día por asignación | `id = {asignacion_id}_{fecha}`, `fecha` en TZ del país |
| `eventos` | **append-only** | UUID, `tipo`, `maquina_id`→aero, `motivo`, `updated_at` |

### Eventos (botones) y categoría

| Botón / acción | `tipo` | categoría |
|---|---|---|
| Ingreso a parque | `entrada_parque` | traslado |
| Traslado a aero (1ª vez) | `traslado_maquina` | traslado |
| Ingreso a aero (elige nº) | `entrada_wtg` | productivo |
| Salida de aero (+3 palas) | `salida_wtg` | traslado |
| Almuerzo | `inicio_almuerzo` | almuerzo |
| Stand-by (motivo) | `inicio_standby` | stand_by |
| Salida de parque | `salida_parque` | **terminal — cierra el DÍA** |
| Finalizar parque | `finalizar_parque` | **terminal — cierra el PARQUE** |

- **`traslado_maquina` se registra una sola vez** (el primer traslado del día): marca la hora
  real de inicio de operaciones (`inicio_actividades`). Entre máquinas es
  `entrada_wtg → salida_wtg` sin nada intermedio.
- **Interno y externo usan el mismo set de botones** (el externo también entra/sale de aeros —
  ver pestaña `03. C. Naretto`). La diferencia es el **ruteo** (interno AR agrupa por equipo;
  externo por persona) y el **ancho** de la planilla (3 WTG vs 11 AERO), no los eventos.
- **Dos niveles de cierre** (jerarquía **asignación → jornada**):
  - `salida_parque` = fin del **día** → cierra la **jornada** y cuenta la última turbina como
    inspeccionada. El técnico sigue asignado (vuelve al día siguiente = nueva jornada).
  - `finalizar_parque` = fin del **parque** → cierra la **asignación** (vuelve a onboarding);
    si la jornada sigue abierta, también la cierra y cuenta la última WTG.
- **Standby** arranca con `inicio_standby` (hora + motivo) a nivel día; **cualquier evento
  siguiente lo cierra** (lo calcula la vista `tramos` con `LEAD()`).
- **Aero inspeccionado** = `entrada_wtg` con un `salida_wtg` **o un cierre**
  (`salida_parque`/`finalizar_parque`) posterior. Cada inspección imputa **3 palas** (regla
  fija; se computa en las vistas, no se almacena).
- Motivos standby: `clima`, `documentacion`, `programacion_tecnica`, `otros` (texto en
  `motivo_otro`).

## Derivación (vistas)

- **`tramos`** — empareja eventos consecutivos por jornada (productivo/traslado/standby/
  almuerzo con duración). `security_invoker` → respeta RLS de la app.
- **`eventos_ctx`** — eventos + contexto, calcula `grupo_clave` de ruteo:
  `'equipo:<id>'` si **AR interna con equipo**, si no `'tecnico:<uuid>'`.
- **`visitas_aero`** — `entrada_wtg` con su cierre (`salida_wtg` o cierre de día/parque) →
  flag `inspeccionado`; join a `aeros` expone `numero`/`nombre` (para etiquetar/ubicar en la
  planilla).
- **`reporte_planilla`** — **una fila por (grupo, parque, día)**: cabecera (llegada, inicio
  actividades = 1er traslado/entrada_wtg, colación, término = `salida_parque`/`finalizar_parque`,
  observaciones = standby + comentarios) + las visitas como **JSON**
  (`{aero, numero, nombre, ingreso, salida}`). n8n expande el JSON a columnas WTG 1..N (evita
  fijar el ancho: 3 en internas, 11 en Naretto).
- **`reporte_resumen`** — tablero por (grupo, parque): turbinas objetivo, inspeccionadas,
  pendientes, % avance, días en sitio vs productivos, % productividad, turb/día, palas.

### Dos familias de reporte (misma base de eventos, distinta proyección)

La diferencia **interno/externo** vive en las **vistas**, no en tablas:
- **Interno →** `reporte_planilla` / `reporte_resumen` (formato planilla clásico).
- **Externo →** `reporte_externo` / `reporte_externo_resumen` + **`resumen_asistencia`**
  (Consolidado, 1 fila por parque; ver 0002) — **formato PLOM**, estándar para todos los externos.
  `reporte_externo`: una fila por aero visitado con la **cadena** de tiempos
  (`esfuerzo_inicio` = ts del `traslado_maquina` a ese aero · `parada_aero` = entrada_wtg ·
  `traslado_min` = parada − esfuerzo_inicio · `esfuerzo_final`/`inicio_aero` = salida_wtg ·
  `salida_de_parque` · `tiempo_min` · `observacion`), más una fila por día de standby completo.
  Derivado de `entrada_parque`/`traslado_maquina`/`entrada_wtg`/`salida_wtg`/`salida_parque`/
  `finalizar_parque` (0003: el botón "Traslado" del externo ahora alimenta `esfuerzo_inicio`, y
  `finalizar_parque` cierra el día igual que `salida_parque`).

## Ruteo a la planilla (pestañas)

`if subtipo='interno' and pais='argentina' → pestaña = equipo (X-C, F-K)`
`else → pestaña = técnico (externa / otros países)`.
Calza con los CSV de `csv/`: `01. Equipo X-C`, `02. Equipo F-K`, `03. C. Naretto`, `Resumen`.

## Diferencias con el prototipo `flujo no oficial.jpg`

- `flujo` (fila ancha) → **vista** `reporte_planilla`, no tabla.
- `grupo` con `id_usuario` + `usuario.FK grupo` (circular) → `equipos` + `tecnicos.equipo_id`.
- `usuario.contrasena` → **eliminado** (Supabase Auth).
- `standby` como tabla → `eventos.tipo='inicio_standby'` + `motivo`.
- `pais`/`dueno_parque` (texto) → tablas `paises` (con TZ) y `empresas`.

## Pendiente (fases siguientes)

- App PWA (login/onboarding/check-in, selección de aero, capa offline, SW/manifest).
- n8n (workflow, credenciales Google Sheets, rol read-only `n8n_reader`).
- Infra (Supabase, Vercel, host n8n, push Gitea); provisión de usuarios manual en Supabase.
- Formato de planilla CL/PE/UY (se asume similar a AR hasta tener su CSV).
