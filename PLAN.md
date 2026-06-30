# Plan — App INER Check-in (PWA offline + Supabase + n8n)

## Contexto

Lo que empezó como "analizar el `.md`" se amplió: ahora se define **la aplicación completa**,
y **todo el código debe vivir en `C:\Users\Matias\Desktop\Proyectos\Asistencia-app-iner`**
(NO en la carpeta hermana `Check-in-app-INER-Next/`, que fue una generación intermedia y se
elimina). El doc `FASE0_SUPABASE_VERCEL.md` queda como referencia histórica del backend.

**Producto:** PWA para técnicos que inspeccionan parques eólicos. Debe funcionar **offline
por 1–2 semanas o más** y sincronizar al recuperar señal. Datos de sesión y de parque
asignado son **persistentes en el dispositivo**. Aguas abajo, **n8n** lee la base todos los
días a las 20:00 y vuelca la información a un **CSV pre-estructurado por país** para el equipo
no técnico.

> **Alcance de ESTA sesión:** no se desarrolla la app. Solo se **inicializa git** en
> `Asistencia-app-iner/`, se copia este plan a `PLAN.md`, se commitea junto con
> `FASE0_SUPABASE_VERCEL.md` (referencia) y se hace **push a Gitea**
> (`http://100.127.72.128:3000/admin/asistencia-parque-iner.git`). La construcción (Partes A–D)
> queda para sesiones siguientes, tras aprobar el plan.

### Decisiones tomadas (clarificadas con el usuario)
- **Eventos:** `entrada_parque`, `traslado_maquina`, `entrada_wtg`, `salida_wtg`,
  `inicio_almuerzo`, `inicio_standby`, `finalizar_parque`. (Se eliminan `reanudar` y
  `inicio_capacitacion` del modelo viejo; cada botón cierra el segmento anterior.)
- **Stand-by motivos:** `clima`, `documentacion`, `programacion_tecnica`, `otros` (con texto).
  Se elimina `produccion`.
- **Offline/sync:** **cola propia en IndexedDB** + service worker (PWA). Sin PowerSync.
- **n8n:** corre 20:00 diario, agrupa por parque/país, **agrega filas a un CSV pre-estructurado**
  accesible para el equipo no técnico (destino exacto se define al montar n8n).
- **Auth:** usuarios creados por nosotros (correo + contraseña). Sin registro público.
- **Zona horaria:** se **deriva del país del parque** (`TZ_POR_PAIS`). La fecha de jornada y
  el corte de las 20:00 quedan en **hora local de cada parque** (Argentina −03, Chile −04/−03,
  Perú −05, Uruguay −03).

---

## Flujo de la app

```
                 ┌─────────────────────────────────────────────┐
 1ª vez online   │  /login  (correo + contraseña, 1 sola vez)  │  sesión → cache persistente
                 └───────────────────┬─────────────────────────┘
                                     ▼
                 ┌─────────────────────────────────────────────┐
 1ª vez online   │  /onboarding/parque  (elige parque, 1 vez)  │  asignación activa → cache
                 └───────────────────┬─────────────────────────┘
                                     ▼
        ┌────────────────────────────────────────────────────────────────┐
 Uso    │  /  (vista check-in)   — funciona online y OFFLINE              │
 diario │  Botones: Ingreso a parque · Traslado a máquina ·              │
        │  Ingreso a turbina (pide nº máquina) · Salida de turbina ·     │
        │  Almuerzo · Stand-by (modal motivos)                          │
        │  Cada botón ⇒ evento con fecha/hora exacta → cola IndexedDB     │
        │  [Finalizar parque] ⇒ cierra asignación → vuelve a onboarding   │
        │  Indicador de sync: online/offline + nº de eventos pendientes  │
        └────────────────────────────────────────────────────────────────┘
                                     │ al reconectar
                                     ▼
                 Sync: vacía la cola a Supabase (inserts idempotentes por UUID)
                                     │
                                     ▼ 20:00 diario
                 n8n lee la BD → agrupa por parque/país → CSV pre-estructurado
```

**Gate de navegación** (componente raíz): si no hay sesión cacheada → `/login`; si hay sesión
pero no hay asignación activa cacheada → `/onboarding/parque`; si hay ambas → vista check-in.
Las dos primeras pantallas **no se vuelven a mostrar** los días siguientes (online u offline).

---

## Parte A — Modelo de datos (revisar `supabase/migrations/0001_init.sql`)

Como nada está desplegado aún, se **edita** la migración 0001 al modelo final (no se agrega 0002).

### A1. Nueva tabla `asignaciones` (parque asignado, persistente)
Una asignación **activa** por técnico; "Finalizar parque" la pasa a `finalizada`.
```sql
create table if not exists public.asignaciones (
  id         uuid primary key,                 -- UUID de cliente (idempotente offline)
  tecnico_id uuid not null references public.tecnicos(id) on delete cascade,
  parque_id  text not null references public.parques(id),
  estado     text not null default 'activa' check (estado in ('activa','finalizada')),
  inicio_ts  timestamptz not null,
  fin_ts     timestamptz,
  updated_at timestamptz not null default now()
);
-- Como mucho UNA asignación activa por técnico:
create unique index if not exists asignaciones_una_activa
  on public.asignaciones (tecnico_id) where estado = 'activa';
```
`jornadas.parque_id` se deriva de la asignación activa (la app lo toma del cache). La
`jornadas.fecha` se calcula en la **TZ del país del parque** (ver B5), no en UTC ni en Chile.

**Corrección de `jornadas.id` (evita colisión):** el id pasa de `{tecnico_id}_{fecha}` a
**`{asignacion_id}_{fecha}`**. Motivo: si un técnico finaliza el parque A y arranca el B el
**mismo día**, `{tecnico_id}_{fecha}` colisiona y el upsert pisaría el `parque_id`. Atándolo a
la asignación, cada estadía en un parque tiene su propia jornada por día (ver Conflicto C1).

### A2. Revisar `eventos.tipo` y la categoría
Nuevo CHECK de `tipo`:
```sql
tipo text not null check (tipo in (
  'entrada_parque','traslado_maquina','entrada_wtg','salida_wtg',
  'inicio_almuerzo','inicio_standby','finalizar_parque'))
```
Mapeo botón → evento → categoría (espejo en la vista `tramos` y en `catalogos.ts`):

| Botón | `tipo` | `categoria` |
|---|---|---|
| Ingreso a parque | `entrada_parque` | traslado |
| Traslado a máquina | `traslado_maquina` | traslado |
| Ingreso a turbina | `entrada_wtg` | productivo |
| Salida de turbina | `salida_wtg` | traslado |
| Almuerzo | `inicio_almuerzo` | almuerzo |
| Stand-by | `inicio_standby` | stand_by |
| Finalizar parque | `finalizar_parque` | (terminal, no abre tramo) |

### A3. Vista `tramos`
Igual que hoy pero: el `case` de categoría usa el mapeo nuevo, y el terminal pasa de
`salida_parque` a **`finalizar_parque`** (`where ... and tipo <> 'finalizar_parque'`).

### A4. Motivos de stand-by
`eventos.motivo` y `catalogos.ts`: dejar `clima`, `documentacion`, `programacion_tecnica`,
`otros`. Quitar `produccion`.

### A5. RLS de `asignaciones`
```sql
alter table public.asignaciones enable row level security;
-- select propio o admin; insert propio; update propio (para finalizar).
create policy asignaciones_select on public.asignaciones for select to authenticated
  using (tecnico_id = auth.uid()
         or (auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');
create policy asignaciones_insert_own on public.asignaciones for insert to authenticated
  with check (tecnico_id = auth.uid());
create policy asignaciones_update_own on public.asignaciones for update to authenticated
  using (tecnico_id = auth.uid()) with check (tecnico_id = auth.uid());
```
Agregar `public.asignaciones` a la publicación lógica (por si se usa en reporting).

### A6. Política `UPDATE` de `eventos.anulado`
Ahora **sí** se habilita (la app permite anular un evento mal cargado): la política
`eventos_anular_own` que estaba comentada se activa, acotada al dueño.

### A7. Vista de reporte para n8n
Vista `public.reporte_diario` = `tramos` + `nombre`/`pais`/`empresa` del parque, para que la
consulta de n8n sea trivial (filtra por fecha y agrupa por país). Expone una **clave de tramo**
(`jornada_id || '|' || inicio || '|' || tipo_inicio`) y `ts_servidor` para permitir la
deduplicación e idempotencia del CSV (ver Conflicto C5).

### A8. Seed
Sin cambios (6 empresas + 22 parques). Mantener nota `peru`/`uruguay` sin datos.

---

## Parte B — App Next.js (PWA) en `Asistencia-app-iner/`

Stack: **Next.js 15 (App Router) + TS + Tailwind + Supabase**. Raíz del repo = la app.
Se reutiliza casi todo lo ya generado (mover desde la carpeta hermana y adaptar):
`lib/supabase/{client,server}.ts`, `lib/catalogos.ts` (con eventos/motivos nuevos),
`lib/tiempo.ts`, `tailwind.config.ts`, configs, `app/globals.css`, `app/layout.tsx`.

### B1. Pantallas / rutas
- `app/login/page.tsx` — correo + contraseña (Supabase Auth `signInWithPassword`). Sesión
  persiste en localStorage (default de supabase-js) → no re-login los días siguientes.
- `app/onboarding/parque/page.tsx` — lista de parques (desde cache/catálogo); al elegir crea
  `asignaciones` (activa) y la cachea. Se omite si ya hay asignación activa cacheada.
- `app/page.tsx` — **vista check-in** (client component): los 7 botones, modal de máquina al
  `entrada_wtg`, modal de motivos al `inicio_standby` (`otros` pide texto), botón
  **Finalizar parque** (confirma → update asignación + evento terminal → vuelve a onboarding),
  e indicador de sync (online/offline + pendientes).
- `app/_components/Gate.tsx` (o lógica en layout) — decide login / onboarding / check-in según
  el cache local.

### B2. Capa offline (cola propia)
- `lib/offline/db.ts` — wrapper de IndexedDB (lib `idb`): stores `outbox` (mutaciones
  pendientes: eventos, upserts de jornadas y asignaciones), `catalogo` (parques/empresas),
  `sesion_parque` (asignación activa + perfil cacheados).
- `lib/offline/registrarEvento.ts` — al apretar un botón: arma el evento con
  `id = crypto.randomUUID()`, `ts_dispositivo = ahoraISO(tzParque)` (hora/fecha exacta con el
  offset local del parque), resuelve la jornada del día (`{tecnico_id}_{fecha}` con `fecha` en
  TZ del parque, upsert), lo encola en `outbox` y actualiza la UI optimista. Idempotente:
  reintentar no duplica (PK = UUID; jornadas/asignaciones por `id`).
- `lib/offline/sync.ts` — al estar online (`navigator.onLine` + evento `online` + reintento
  periódico): vacía `outbox` a Supabase en orden (tecnico→asignacion→jornada→eventos), con
  `upsert`/`insert ... on conflict do nothing`; al confirmar, borra de la cola. Requiere sesión
  válida (RLS por `auth.uid()`); el token se refresca al reconectar.

### B3. PWA / service worker
- `@serwist/next` (compatible Next 15 App Router) para cachear el app-shell + catálogo y
  permitir arranque offline. `app/manifest.ts` (nombre, iconos, `display: standalone`,
  tema azul medianoche). Iconos en `public/`.
- Nota persistencia: configurar expiración de refresh token de Supabase holgada; las escrituras
  van a la cola y solo requieren auth **al sincronizar**, no al apretar el botón.

### B4. Estilo
Dark industrial del `CLAUDE.md` (azul medianoche / oro para cifras / teal para acción), ya
reflejado en `tailwind.config.ts` y `globals.css`.

### B5. Zona horaria por país (generalizar `lib/tiempo.ts`)
- Agregar `TZ_POR_PAIS` (en `catalogos.ts`): `argentina→America/Argentina/Buenos_Aires`,
  `chile→America/Santiago`, `peru→America/Lima`, `uruguay→America/Montevideo`.
- Parametrizar `lib/tiempo.ts`: `fechaHoy(tz)`, `offset(date, tz)`, `ahoraISO(date, tz)`
  reciben la TZ (mantener wrappers `*Chile` por compatibilidad, marcados deprecated). La app
  pasa la TZ del país del parque de la asignación activa (cacheado).
- Así `ts_dispositivo` lleva el offset local real y `jornadas.fecha` es el día local del parque.

---

## Parte C — n8n (downstream)

- Workflow versionado en `n8n/checkin-export.json` (export del flujo) + `n8n/README.md`.
- **Cron 20:00 hora local de cada país** (un trigger por TZ: Argentina, Chile, Perú, Uruguay,
  o un cron que filtra por país según su hora local) → nodo **Postgres** (rol de **solo lectura**
  dedicado para n8n) que consulta `public.reporte_diario` del día de ese país → agrupa por
  `pais` → **agrega filas a un CSV pre-estructurado** (columnas fijas: fecha, país, parque,
  técnico, máquina, categoría, tipo_inicio, inicio, fin, duración_min, motivo, comentario) en
  el destino compartido del equipo no técnico (a definir al montar n8n: Drive / storage
  compartido).
- Crear el rol read-only en la migración o en un script `supabase/n8n_role.sql`.
- (Opcional) `pg_cron` para cerrar jornadas a las 20:00 (`estado='cerrada'`); no bloquea n8n.

---

## Parte D — Consolidación de carpetas
1. Mover/regenerar todo el contenido de `Check-in-app-INER-Next/` dentro de
   `Asistencia-app-iner/` (raíz del repo).
2. **Eliminar** `Check-in-app-INER-Next/` para evitar duplicación.
3. Mantener `FASE0_SUPABASE_VERCEL.md` como referencia (queda superado por este plan).

---

## Archivos críticos (crear/editar)
- `supabase/migrations/0001_init.sql` — asignaciones, eventos nuevo set, tramos, RLS,
  reporte_diario, anular. `supabase/seed.sql` (sin cambios). `supabase/n8n_role.sql`.
- `lib/catalogos.ts` — eventos/categorías/motivos nuevos; `EVENTOS_POR_SUBTIPO` actualizado.
- `lib/offline/{db,registrarEvento,sync}.ts` — capa offline.
- `app/login/page.tsx`, `app/onboarding/parque/page.tsx`, `app/page.tsx`,
  `app/_components/Gate.tsx`, `app/manifest.ts`.
- `lib/supabase/{client,server}.ts`, `lib/tiempo.ts`, configs, `app/layout.tsx`,
  `app/globals.css` — reutilizar de lo ya generado.
- `n8n/checkin-export.json`, `n8n/README.md`.

---

## Posibles conflictos y mitigaciones

Riesgos reales del diseño (offline-first multi-país) y cómo los resolvemos. Orden por impacto.

### C1. Colisión de `jornadas.id` al cambiar de parque el mismo día — **resuelto en A**
Finalizar parque A y abrir B el mismo día generaba el mismo id `{tecnico}_{fecha}`.
→ `id = {asignacion_id}_{fecha}` (cada estadía su jornada). La vista `tramos` ya particiona por
`jornada_id`, así no mezcla parques.

### C2. Pérdida de datos por desalojo de almacenamiento (CRÍTICO)
La cola offline puede vivir semanas en IndexedDB; el navegador/OS puede **desalojar** storage
y borrar eventos no sincronizados.
→ Pedir `navigator.storage.persist()` al primer login; mostrar aviso si se deniega; nunca borrar
de la `outbox` hasta confirmar el insert en Supabase; contador de pendientes visible siempre.

### C3. Expiración de sesión tras semanas offline (CRÍTICO)
El refresh token de Supabase rota/expira; tras 1–2 semanas sin red, al reconectar el sync podría
dar 401 y, como el RLS de insert exige `auth.uid() = tecnico_id`, los eventos no entran.
→ Configurar expiración de refresh token holgada en Supabase; mantener `autoRefreshToken`; si el
token igual venció, forzar **re-login** (correo+contraseña) que **conserva la cola** y la vacía
tras autenticar. La cola nunca se pierde por un 401.

### C4. Doble asignación activa / orden de sincronización
Con la cola, "finalizar A" + "abrir B" + eventos de B se acumulan offline. Si se sincronizan
**fuera de orden**, el insert de la asignación B choca con el índice único `una_activa`. También
un segundo dispositivo podría crear otra asignación activa.
→ `outbox` **ordenada** (secuencia monótona) y vaciado en orden estricto
(tecnico→update asignación→insert asignación→jornada→eventos). En conflicto del índice único,
el sync **reconcilia**: lee la asignación activa real del servidor y reusa su id en vez de
duplicar. Login en dispositivo nuevo: primero **traer** la asignación activa del servidor.

### C5. Datos tardíos vs. corte de las 20:00 + idempotencia del CSV (IMPORTANTE)
Un técnico que sincroniza **después de las 20:00** (o al día siguiente) no entra en el CSV ya
generado; y "agregar filas" puede **duplicar** si n8n re-corre o llegan datos tarde.
→ n8n consulta por **ventana** (p.ej. `ts_servidor` de las últimas 48 h, no solo "hoy") y
**deduplica por clave de tramo** (`jornada_id + inicio + tipo_inicio`) antes de agregar; o
**regenera el bloque del día** en vez de append ciego. El CSV pre-estructurado debe tener una
columna de id de tramo para poder deduplicar.

### C6. Reloj del dispositivo desincronizado
`ts_dispositivo` sale del reloj del móvil; offline sin NTP puede estar corrido → timestamps y
`fecha` de jornada erróneos.
→ Guardar **ambos** `ts_dispositivo` y `ts_servidor` (ya está); al sincronizar, si el desfase
`|ts_servidor − ts_dispositivo|` supera un umbral, **marcar** el evento (campo/flag) para
revisión. No se corrige automático (el offline es legítimo), pero queda trazado.

### C7. Segmentos que cruzan medianoche
Un evento antes de medianoche y el siguiente después caen en **jornadas distintas** → `tramos`
no los empareja y ese tramo se pierde.
→ Aceptable para inspección diurna; documentarlo. Si aparece trabajo nocturno real, evaluar
cerrar el tramo a medianoche y reabrir (regla en la vista). No se implementa ahora.

### C8. Doble toque / eventos duplicados
Dos toques rápidos generan dos eventos (UUID distinto) que no se deduplican.
→ **Debounce** del botón (deshabilitar ~1–2 s tras el toque) y, opcional, ignorar mismo `tipo`
dentro de N segundos. La vista usa `greatest(0, …)` así un tramo de 0 min no rompe nada.

### C9. Alta del perfil `tecnicos` en el primer login
El RLS de jornadas/eventos exige `tecnico_id = auth.uid()`, pero el admin solo crea el usuario
en `auth.users`; si no existe la fila en `public.tecnicos`, los inserts fallan.
→ En el primer login, la app hace **upsert** del perfil (`tecnicos_insert_self` lo permite) con
nombre/subtipo/país antes de habilitar el check-in.

### C10. Acceso de n8n con RLS activo
El rol de solo-lectura de n8n no es `authenticated`, así que las policies no le aplican y no
vería nada.
→ Rol dedicado con **BYPASSRLS** (solo lectura) o `GRANT SELECT` directo sobre `reporte_diario`
y tablas base + policy específica para ese rol. Definir al montar n8n (Parte C).

### C11. Actualización del service worker vs. estabilidad offline
Desplegar una versión nueva mientras hay técnicos offline por semanas puede romper la app
cacheada o, al revés, dejarlos en una versión vieja.
→ Estrategia de SW conservadora: no `skipWaiting` agresivo durante una jornada; activar versión
nueva solo al reabrir sin pendientes; versionar el shell. La capa de datos (IndexedDB) es
independiente del shell, así que un cambio de UI no invalida la cola.

### C12. Catálogo de parques desactualizado offline
Cambios de catálogo durante semanas offline no se reflejan.
→ Aceptable: la asignación ya está hecha; el catálogo se refresca al reconectar. Sin acción.

---

## Verificación (end-to-end, tras el OK)

1. **DB:** correr migración + seed; `parques`=22, `empresas`=6; `select * from tramos` y
   `reporte_diario` sin error. Smoke con la transacción de prueba (FK drop/restore) → tramos
   con las categorías nuevas correctas.
2. **Auth:** crear 1 usuario de prueba; login en `/login`; recargar → no pide login otra vez.
3. **Onboarding:** elegir parque → se crea asignación activa; recargar → entra directo a la
   vista check-in.
4. **Offline:** en DevTools → Network **Offline**: apretar la secuencia de botones (incl.
   stand-by con motivo y entrada a turbina con nº máquina); verificar que se encolan en
   IndexedDB y la UI responde. Volver **Online** → la cola se vacía y los eventos aparecen en
   Supabase (sin duplicados al forzar reintento).
5. **Finalizar parque:** cierra la asignación (estado `finalizada`) y vuelve a onboarding;
   se puede elegir un parque nuevo.
6. **PWA:** instalable (manifest), arranca offline con el app-shell cacheado.
7. **n8n:** ejecutar el workflow manualmente → genera/append al CSV por país con las columnas
   esperadas.
8. **Deploy Vercel** con las env vars (`NEXT_PUBLIC_SUPABASE_URL`, `..._ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`).

---

## Orden de ejecución propuesto (cuando des el OK)
1. Parte D (consolidar en `Asistencia-app-iner/`, borrar carpeta hermana).
2. Parte A (modelo de datos final).
3. Parte B (offline + pantallas + PWA).
4. Parte C (n8n) — se puede dejar al final, depende de la BD ya cargada.
5. Verificación end-to-end.

> TZ resuelta en este plan (B5 + Parte C): se deriva del país del parque vía `TZ_POR_PAIS`;
> la fecha de jornada y el corte 20:00 de n8n son hora local de cada parque.
