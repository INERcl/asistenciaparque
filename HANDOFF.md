# HANDOFF — INER Check-in (contexto completo para retomar)

> Documento de traspaso. Si sos otro agente/desarrollador que retoma el proyecto en otro
> dispositivo, **empezá por acá**. Resume qué es el proyecto, qué está construido, qué está
> aplicado en Supabase y qué falta. Los detalles finos están en los docs que se referencian.

Última actualización: **2026-07-01**.

---

## 1. Qué es

**INER Check-in**: PWA (app web instalable) para que **técnicos que inspeccionan parques
eólicos** registren su jornada desde el celular, **funcionando offline** y sincronizando al
recuperar señal. Los eventos se guardan en **Supabase**; después **n8n** (a construir) lee unas
vistas SQL y **llena las planillas Google Sheets** que usa el equipo no técnico.

Flujo macro: `App (offline) → Supabase (Postgres+Auth+RLS) → n8n (cron) → Google Sheets`.

Hay **dos perfiles de técnico** con terminología y reporte distintos, pero **la misma base de
datos** (un log de eventos + vistas derivadas):
- **Interno** (Argentina, agrupado por equipos X-C / F-K): planilla clásica.
- **Externo** (`inspector_externo`): formato **PLOM** (una fila por aero con cadena de tiempos).

---

## 2. Stack e infraestructura

- **Front:** Next.js 15 (App Router) + TypeScript + Tailwind v3 + PWA con `@serwist/next`.
- **Backend:** **Supabase** (Postgres + Auth + RLS). Proyecto real: `jfkojbdlxerlydlrolwa`
  (`https://jfkojbdlxerlydlrolwa.supabase.co`), región São Paulo.
- **Offline:** cola propia en **IndexedDB** (lib `idb`), escribe directo a Supabase con upsert
  idempotente (no PowerSync).
- **Deploy previsto:** Vercel (app) + Supabase cloud. Repo en **Gitea self-hosted**
  (`100.127.72.128`, Tailscale). **n8n** self-hosted (a montar).
- **Claves (`.env.local`, GITIGNOREADO — recrear en cada dispositivo):**
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (= `sb_publishable_...`),
  `SUPABASE_SERVICE_ROLE_KEY` (= `sb_secret_...`). Formato nuevo de claves Supabase (`sb_*`).
  Pedirle las claves al dueño del proyecto; no están versionadas.

Detalle y justificación: **`STACK.md`**.

---

## 3. Estado actual (qué está hecho)

### Aplicado en Supabase (real)
- ✅ Migración `supabase/migrations/0001_init.sql` aplicada (SQL Editor).
- ✅ Seed aplicado: 4 países, 6 empresas (CL), **23 parques** (7 CL + 16 AR), aeros, 2 equipos.
- ✅ **Punta Lomitas** agregado (parque `ar_punta_lomitas`, **57 aeros** con numeración salteada).
- ✅ **10 técnicos** creados (auth + fila `tecnicos`) vía `scripts/crear-tecnicos.mjs`.
- ✅ Vistas externas `reporte_externo` / `reporte_externo_resumen` creadas.
- ✅ Migración `0002_asistencia_externa.sql`: `reporte_externo` con `evento_id` + rama "día de
  standby"; vista **`resumen_asistencia`** (Consolidado, 1 fila por parque) + grant a `n8n_reader`.
- ✅ Migración `0003_reporte_externo_fix.sql`: `reporte_externo` maneja `finalizar_parque` como
  cierre y usa el ts de `traslado_maquina` para `esfuerzo_inicio`/`traslado_min`.
- ✅ Migración `0004_paises_config.sql`: columnas de config por país en `paises`
  (`permite_interno/externo`, `usa_almuerzo/equipos`); seed actualizado.
- ⏳ **Pendiente inmediato:** tras aplicar `0002`/`0003`/`0004`, refrescar el esquema de PostgREST:
  `NOTIFY pgrst, 'reload schema';` en el SQL Editor. Después, smoke-test del formato externo (ver §7).

### App (código, compila — `npm run build` verde)
- ✅ Sistema de diseño **INER** (verde `#044245`, gris `#707070`, ámbar `#FFA700`, Montserrat,
  tema claro). Logos/iconos en `public/` (traídos del proyecto hermano `Checklist-Iner`).
- ✅ **Gate cliente** en `app/page.tsx`: login → onboarding (elegir parque) → check-in, según
  sesión Supabase + cache IndexedDB (arranca offline).
- ✅ **Login por nombre de usuario** (no correo): `carlos.naretto` → email sintético
  `carlos.naretto@checkin.iner` (dominio interno oculto; no necesita existir). Ver `lib/usuario.ts`.
- ✅ **Capa offline** (`lib/offline/`): outbox IndexedDB + `registrarEvento` + `sync` a Supabase.
- ✅ **Máquina de estados de botones** por `subtipo` (`lib/offline/estado.ts`): habilita/inhabilita
  según los eventos del día; la jornada la abre `entrada_parque`; tras el cierre del día queda
  bloqueada (no se reabre/regenera).
- ✅ **Vista por subtipo** (`lib/catalogos.ts` + `CheckIn.tsx`): interno vs externo con etiquetas
  y botones distintos (mismos eventos de fondo).
- ✅ **Límites por país (data-driven)**: onboarding filtra parques por el país del técnico; el set de
  botones se ajusta por país (almuerzo solo donde `usa_almuerzo`). Config leída de `paises` y
  cacheada offline (`lib/catalogos.ts` `PAIS_CONFIG`/`paisConfigDe`, `lib/offline/sesion.ts`).
- ✅ **Logout** (botón "Salir" en el header del check-in: `signOut` + limpia cache local, la outbox
  sobrevive) + **revalidación** de la asignación cacheada contra el server al abrir (`app/page.tsx`).
- ✅ **Iconos PWA propios** generados desde `logo-iner-mono` sobre verde INER (`public/icon-*`,
  `apple-touch-icon`).

### Pendiente (no hecho)
- ⏳ **n8n**: versionar el JSON del workflow en `n8n/` (export del cliente) y pegar los IDs reales de
  libro AR. Rol read-only y branches externo/Consolidado especificados (ver `n8n/README.md` y
  `PLAN_N8N.md`). Branch **interno** (`reporte_planilla`) todavía por armar.
- ⏳ Smoke-test del formato externo PLOM (tras el `NOTIFY pgrst` de arriba).
- ⏳ Vista SQL/n8n del externo: refinar la métrica `standby` del resumen con datos reales.
- ⏳ Formato de planilla para CL/PE/UY (se asume similar a AR hasta tener sus archivos).

---

## 4. Modelo de datos (unificado; la diferencia interno/externo vive en VISTAS)

Fuente de verdad: **`eventos` append-only** + **vistas derivadas**. NO hay tablas separadas por
subtipo (decisión firme). Esquema en `supabase/migrations/0001_init.sql`; detalle en
**`MODELO_RECONCILIADO.md`**.

**Tablas:** `paises` (con TZ IANA), `empresas`, `parques`, `aeros` (por parque), `equipos`
(AR interna: `ar_x_c`, `ar_f_k`), `tecnicos` (perfil 1:1 con `auth.users`; columnas `usuario`
unique, `nombre` para planilla, `subtipo`, `pais`, `equipo_id`, `activo`), `asignaciones`
(parque activo por técnico; índice único de una activa), `jornadas` (`id = {asignacion_id}_{fecha}`,
`fecha` en TZ del país), `eventos` (UUID cliente, `tipo`, `ts_dispositivo`, `maquina_id`→aero,
`motivo`, `comentario`, `anulado`, `updated_at`).

**Eventos (`eventos.tipo`):** `entrada_parque`, `traslado_maquina`, `entrada_wtg`, `salida_wtg`,
`inicio_almuerzo`, `inicio_standby`, `salida_parque` (cierra el DÍA/jornada), `finalizar_parque`
(cierra el PARQUE/asignación). Motivos de standby: `clima`, `documentacion`,
`programacion_tecnica`, `otros` (texto en `motivo_otro`).

**Vistas:** `tramos` (tramos por LEAD), `eventos_ctx` (contexto + `grupo_clave` de ruteo:
`equipo:<id>` si AR interna con equipo, si no `tecnico:<uuid>`), `visitas_aero` (pares
entrada/salida de aero, flag `inspeccionado`, join a `aeros` con numero/nombre).
**Dos familias de reporte:**
- Interno → **`reporte_planilla`** (fila por grupo/parque/día, visitas en JSON) + **`reporte_resumen`**.
- Externo → **`reporte_externo`** (fila por aero visitado, cadena PLOM: `esfuerzo_inicio`,
  `traslado_min`, `parada_aero`, `esfuerzo_final`/`inicio_aero`, `salida_de_parque`, `tiempo_min`,
  `observacion`) + **`reporte_externo_resumen`**.

Las vistas de reporte NO usan `security_invoker` (corren como owner) y tienen `revoke` a
anon/authenticated → solo las lee el rol read-only de n8n (o service_role).

---

## 5. Flujo del check-in (por perfil)

**Interno:** `entrada_parque` → `traslado_maquina` (1×/día = inicio de actividades) →
[`entrada_wtg` → `salida_wtg`]… → `inicio_almuerzo` (1×) → `salida_parque`/`finalizar_parque`.
Un `salida_wtg` (o el cierre) marca el aero como inspeccionado (+3 palas, regla fija).

**Externo (PLOM):** `entrada_parque` (Llegada) → por cada aero [`traslado_maquina` (Traslado) →
`entrada_wtg` (Parada de aero) → `salida_wtg` (Inicio de aero)] → `salida_parque`. **Sin almuerzo.**
El botón "Traslado" es UX; el reporte encadena `esfuerzo_inicio` = salida anterior (o llegada en
el 1º), `traslado_min` = `parada − esfuerzo_inicio`. Referencia real: el Excel
`2026.07.01.Horas OT PLOM junio 2026.xlsx` (analizado; la lógica se reproduce en `reporte_externo`).

Reglas de bloqueo (máquina de estados, `lib/offline/estado.ts`): cada botón se habilita según el
estado del día; `entrada_parque` una vez (abre jornada); no entrar a un aero si ya estás dentro;
externo exige Traslado antes de cada Parada; tras `salida_parque`/`finalizar_parque` todo queda
bloqueado hasta el día siguiente.

---

## 6. n8n (próximo bloque) — ver `PLAN_N8N.md`

n8n es **downstream y de solo lectura**: cron por país (20:00 hora local `paises.tz`) → lee las
vistas de reporte con el rol `n8n_reader` → transforma → **Append/Update** en Google Sheets
(idempotente por `row_key`). No toca la app ni escribe en la base.

- **Rol read-only:** `supabase/n8n_role.sql` (crear en Supabase; da SELECT solo sobre las 4 vistas
  de reporte). Conexión desde n8n: cadena Postgres del **pooler modo sesión (5432)** con `n8n_reader`.
- **Mapa de columnas por pestaña** (interno vs externo PLOM): en `PLAN_N8N.md` (derivado de los
  CSV en `csv/` y del Excel PLOM). Interno mapea por posición a las hojas legadas; externo produce
  el detalle PLOM + una hoja RESUMEN.
- **Falta del lado humano:** credencial Google Sheets OAuth2, los `spreadsheetId` por país/cliente,
  y el mapa grupo→hoja. Luego construir el workflow y versionarlo en `n8n/`.

El **plan detallado y ejecutable de n8n está en `PLAN_N8N.md`** (flujo, nodos, mapeos, conflictos,
verificación, orden de ejecución).

---

## 7. Cómo correr / continuar

```bash
npm install
# .env.local con las 3 claves de Supabase (pedirlas; está gitignoreado)
npm run dev        # http://localhost:3000
npm run build      # ⚠ NO buildear con el dev server corriendo (corrompe .next; si pasa: rm -rf .next)
```

- **Aplicar cambios de esquema:** re-ejecutar `supabase/migrations/0001_init.sql` en el SQL Editor
  (idempotente). Tras crear vistas, correr `NOTIFY pgrst, 'reload schema';`.
- **Alta de técnicos:** `scripts/README.md` → completar `scripts/tecnicos.json` (gitignoreado) →
  `node --env-file=.env.local scripts/crear-tecnicos.mjs`. Genera contraseñas temporales.
- **Técnicos ya creados (10):** internos AR `carlos.rodriguez`, `xavier.leon` (X-C),
  `kevin.digoy`, `fernando.avila` (F-K); externo AR `carlos.naretto`; externos CL
  `tomas.caballero`, `nicolas.caballero`, `lucas.alvarez`, `matias.ramos`, `matias.jofre`.
  Contraseñas temporales (resetear en Supabase → Authentication → Users si hace falta).
- **Auth Supabase:** el login usa email sintético `usuario@checkin.iner`. "Confirm email" no es
  necesario (el script crea con `email_confirm: true`). Conviene apagar signups públicos.
- **Probar externo (smoke):** login `carlos.naretto` → parque **Punta Lomitas** → Llegada →
  (Traslado → Parada de aero → Inicio de aero)×N → Salida de parque → consultar `reporte_externo`.
  (Requiere el `NOTIFY pgrst` hecho.)

---

## 8. Índice de documentos

| Doc | Contenido |
|---|---|
| **`HANDOFF.md`** (este) | Contexto completo + estado + cómo continuar |
| `STACK.md` | Stack tecnológico justificado |
| `MODELO_RECONCILIADO.md` | Modelo de datos (tablas, eventos, vistas, dos familias de reporte) |
| `PLAN.md` | Plan general de la app (roadmap Partes A–D, flujo, conflictos offline) |
| `PLAN_N8N.md` | **Plan de n8n** (flujo, mapeos de columnas, rol read-only, verificación) |
| `supabase/migrations/0001_init.sql` | Esquema + vistas + RLS |
| `supabase/seed.sql` | Catálogos (países/empresas/parques/aeros/equipos) |
| `supabase/n8n_role.sql` | Rol read-only para n8n |
| `scripts/crear-tecnicos.mjs` + `README.md` | Alta de técnicos |
| `csv/` | CSV de la planilla legada AR (interna X-C/F-K + Naretto + Resumen) |
| `2026.07.01.Horas OT PLOM junio 2026.xlsx` | Ejemplo real del formato externo PLOM |

Contexto adicional del dueño: perfil externo confirmado usa el formato PLOM para **todos** los
externos; internos AR se agrupan por equipo; la base es **unificada** (nada de tablas por subtipo).
