# Fase 0 — Migración INER Check-in a Supabase + Vercel

> Documento autocontenido para **generar el proyecto nuevo en otra carpeta**.
> Crea cada archivo con el contenido indicado dentro de `Check-in-app-INER-Next/`.
> Stack: **Next.js (App Router) + TypeScript + Tailwind** · backend **Supabase
> (Postgres + Auth + RLS)** · sync offline **PowerSync** (entra en Fase 1).

## Contexto y decisiones

- Se **elimina Firebase**. Backend = Supabase (Postgres + Auth + RLS).
- Frontend nuevo en **Next.js** desplegado en **Vercel** (no se conserva el Vue).
- **Offline real obligatorio** (técnicos en parques sin señal) → **PowerSync**
  sobre Postgres. Su runtime es Fase 1; el schema ya queda compatible.
- **Tramos = vista SQL** (`LEAD()`), cero copias de `calcularTramos`.
- **Empezar limpio** (sin migrar histórico de Firestore).
- **n8n** queda aguas abajo leyendo Postgres (Fase 4).
- El **nombre** del técnico pasa a columna real; la **empresa** pasa a FK del
  parque (no se copia en el perfil).

### Roadmap (esta entrega = solo Fase 0)
```
Fase 0  Setup: Supabase (schema+RLS+seed) + scaffold Next.js en Vercel   <-- AQUÍ
Fase 1  Auth Supabase + PowerSync (login técnico, escritura offline)
Fase 2  Check-in: lógica de eventos/jornada en la isla cliente (PWA)
Fase 3  Vista de tramos + dashboard ejecutivo (Next SSR + gráficos)
Fase 4  n8n -> Postgres (SELECT vista tramos 20:00) + pg_cron cierre auto
```

### Alcance Fase 0
Backend de datos en pie y verificable + esqueleto del front desplegado leyendo de
Supabase. **SIN** auth funcional, **SIN** PowerSync runtime, **SIN** check-in.
Criterio de listo: una página Next en Vercel lista los 22 parques desde Supabase.

### Prerrequisitos manuales (una vez)
- Crear **proyecto Supabase** (región São Paulo). Anotar `Project URL`,
  `anon key`, `service_role key`.
- Crear cuenta **Vercel** y conectarla al repo nuevo.
- Crear cuenta **PowerSync** (se usa en Fase 1).

---

## Árbol de archivos a generar

```
Check-in-app-INER-Next/
├─ package.json
├─ tsconfig.json
├─ next.config.mjs
├─ postcss.config.mjs
├─ tailwind.config.ts
├─ .gitignore
├─ .env.local.example
├─ README.md
├─ app/
│  ├─ globals.css
│  ├─ layout.tsx
│  └─ page.tsx
├─ lib/
│  ├─ catalogos.ts
│  ├─ tiempo.ts
│  └─ supabase/
│     ├─ client.ts
│     └─ server.ts
└─ supabase/
   ├─ migrations/0001_init.sql
   └─ seed.sql
```

---

## 1) `supabase/migrations/0001_init.sql`

```sql
-- =====================================================================
-- INER Check-in — Fase 0: schema inicial (Supabase / Postgres)
-- Espejo del modelo Firestore (src/lib/catalogos.js, firestore.rules).
-- Migración limpia (sin histórico). Tipos text + CHECK (PowerSync-friendly).
-- =====================================================================

-- Catálogo: empresas (operadores). Solo Chile agrupa parques por empresa.
create table if not exists public.empresas (
  id     text primary key,
  nombre text not null,
  pais   text not null
);

-- Catálogo: parques. empresa_id NULL donde no aplica (p.ej. Argentina).
-- La EMPRESA del técnico se DERIVA del parque (no se copia en el perfil).
create table if not exists public.parques (
  id         text primary key,
  nombre     text not null,
  pais       text not null check (pais in ('argentina','chile','peru','uruguay')),
  empresa_id text references public.empresas(id),
  turbinas   int,
  activo     boolean not null default true,
  orden      int
);

-- Técnicos (perfil): 1:1 con auth.users. El NOMBRE vive aquí.
-- El rol viaja como claim (app_metadata), no como columna.
create table if not exists public.tecnicos (
  id        uuid primary key references auth.users(id) on delete cascade,
  nombre    text,
  subtipo   text check (subtipo in ('interno','inspector_externo')),
  pais      text check (pais in ('argentina','chile','peru','uruguay')),
  creado_ts timestamptz not null default now()
);

-- Jornadas: una por técnico por día. id = '{tecnico_id}_{fecha}' (idempotente).
-- pais NO se guarda: se deriva por JOIN a parques.
create table if not exists public.jornadas (
  id          text primary key,
  tecnico_id  uuid not null references public.tecnicos(id) on delete cascade,
  parque_id   text not null references public.parques(id),
  fecha       date not null,
  subtipo     text check (subtipo in ('interno','inspector_externo')),
  estado      text not null default 'abierta'
              check (estado in ('abierta','cerrada','incompleta','anulada')),
  cierre_tipo text check (cierre_tipo in ('salida_parque','auto_2000')),
  abierta_ts  timestamptz,
  cerrada_ts  timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists jornadas_fecha_idx   on public.jornadas (fecha);
create index if not exists jornadas_tecnico_idx on public.jornadas (tecnico_id);

-- Eventos: append-only. id = eventoId (UUID de cliente) → reintento no duplica.
create table if not exists public.eventos (
  id             uuid primary key,
  jornada_id     text not null references public.jornadas(id) on delete cascade,
  tipo           text not null check (tipo in (
                   'entrada_parque','entrada_wtg','salida_wtg','inicio_capacitacion',
                   'inicio_almuerzo','inicio_standby','reanudar','salida_parque')),
  categoria      text check (categoria in ('productivo','traslado','stand_by','almuerzo')),
  anulado        boolean not null default false,
  ts_dispositivo timestamptz not null,
  ts_servidor    timestamptz not null default now(),
  maquina_id     text,
  motivo         text,
  motivo_otro    text,
  comentario     text
);
create index if not exists eventos_jornada_ts_idx
  on public.eventos (jornada_id, ts_dispositivo);

-- =====================================================================
-- Vista TRAMOS — reemplaza calcularTramos (cero copias de lógica).
-- Empareja eventos consecutivos no anulados, ordena por ts_dispositivo,
-- descarta salida_parque como apertura, duracion_min = max(0, round(Δmin)).
-- security_invoker => respeta RLS de las tablas base.
-- =====================================================================
create or replace view public.tramos with (security_invoker = on) as
with ord as (
  select e.*, j.fecha, j.tecnico_id, j.parque_id, j.subtipo,
         j.estado as estado_jornada,
         lead(e.ts_dispositivo) over w as fin_ts,
         lead(e.tipo)           over w as tipo_fin
  from public.eventos e
  join public.jornadas j on j.id = e.jornada_id
  where e.anulado = false
  window w as (partition by e.jornada_id order by e.ts_dispositivo)
)
select
  fecha, parque_id, tecnico_id, subtipo, estado_jornada,
  coalesce(categoria, case tipo
    when 'entrada_parque'      then 'traslado'
    when 'entrada_wtg'         then 'productivo'
    when 'salida_wtg'          then 'traslado'
    when 'inicio_capacitacion' then 'productivo'
    when 'inicio_almuerzo'     then 'almuerzo'
    when 'inicio_standby'      then 'stand_by'
    when 'reanudar'            then 'productivo'
    else 'stand_by' end) as categoria,
  tipo as tipo_inicio, tipo_fin,
  ts_dispositivo as inicio, fin_ts as fin,
  greatest(0, round(extract(epoch from (fin_ts - ts_dispositivo)) / 60.0))::int as duracion_min,
  maquina_id, motivo, motivo_otro, comentario
from ord
where fin_ts is not null          -- el último evento no abre tramo
  and tipo <> 'salida_parque';    -- salida_parque es terminal

-- =====================================================================
-- Row Level Security (espejo de firestore.rules)
-- =====================================================================
alter table public.empresas enable row level security;
alter table public.parques  enable row level security;
alter table public.tecnicos enable row level security;
alter table public.jornadas enable row level security;
alter table public.eventos  enable row level security;

-- Catálogo de SOLO LECTURA y público (datos no sensibles). Lo escribe el seed
-- con service_role (salta RLS).
drop policy if exists empresas_read on public.empresas;
create policy empresas_read on public.empresas
  for select to anon, authenticated using (true);

-- NOTA: `turbinas` queda legible por `anon` (catálogo público). Es un dato
-- operativo no sensible; decisión consciente. Si se quisiera ocultar, mover el
-- conteo a una tabla aparte solo-authenticated o exponer una vista sin la columna.
drop policy if exists parques_read on public.parques;
create policy parques_read on public.parques
  for select to anon, authenticated using (true);

-- Técnicos: cada uno su propia fila; admin (claim) lee todo.
drop policy if exists tecnicos_select_own on public.tecnicos;
create policy tecnicos_select_own on public.tecnicos
  for select to authenticated
  using (id = auth.uid()
         or (auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');

drop policy if exists tecnicos_insert_self on public.tecnicos;
create policy tecnicos_insert_self on public.tecnicos
  for insert to authenticated with check (id = auth.uid());

drop policy if exists tecnicos_update_own on public.tecnicos;
create policy tecnicos_update_own on public.tecnicos
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Jornadas: propias (técnico) o todas (admin).
drop policy if exists jornadas_select on public.jornadas;
create policy jornadas_select on public.jornadas
  for select to authenticated
  using (tecnico_id = auth.uid()
         or (auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');

drop policy if exists jornadas_insert_own on public.jornadas;
create policy jornadas_insert_own on public.jornadas
  for insert to authenticated with check (tecnico_id = auth.uid());

drop policy if exists jornadas_update_own on public.jornadas;
create policy jornadas_update_own on public.jornadas
  for update to authenticated
  using (tecnico_id = auth.uid()) with check (tecnico_id = auth.uid());

-- Eventos: append-only, ligados a una jornada propia (admin lee todo).
-- Sin UPDATE/DELETE → inmutables.
drop policy if exists eventos_select on public.eventos;
create policy eventos_select on public.eventos
  for select to authenticated
  using (
    exists (select 1 from public.jornadas j
            where j.id = jornada_id and j.tecnico_id = auth.uid())
    or (auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin'
  );

drop policy if exists eventos_insert_own on public.eventos;
create policy eventos_insert_own on public.eventos
  for insert to authenticated
  with check (
    exists (select 1 from public.jornadas j
            where j.id = jornada_id and j.tecnico_id = auth.uid())
  );

-- NOTA (Fase 2): `eventos.anulado` es un soft-delete que la vista `tramos`
-- filtra (where anulado = false). Hoy NO hay política UPDATE → nadie puede
-- setear anulado, por lo que los eventos son inmutables en Fase 0 (no hay
-- check-in todavía). Cuando llegue el check-in se habilita una UPDATE acotada
-- al dueño y al flag. Política prevista (NO habilitar en Fase 0):
-- create policy eventos_anular_own on public.eventos
--   for update to authenticated
--   using (exists (select 1 from public.jornadas j
--                  where j.id = jornada_id and j.tecnico_id = auth.uid()))
--   with check (exists (select 1 from public.jornadas j
--                       where j.id = jornada_id and j.tecnico_id = auth.uid()));

-- =====================================================================
-- PowerSync (Fase 1): publicación de replicación lógica.
-- Supabase corre con wal_level=logical. Sync rules por-usuario en su panel.
-- =====================================================================
drop publication if exists powersync;
create publication powersync for table
  public.tecnicos, public.parques, public.empresas,
  public.jornadas, public.eventos;
```

---

## 2) `supabase/seed.sql`

Datos reales portados de `scripts/seedParques.mjs` (6 empresas Chile + 22 parques).

> Nota: `peru` y `uruguay` están permitidos en los `CHECK` de `pais` pero **no**
> tienen parques en este seed (intencional en Fase 0; se agregan cuando haya datos).

```sql
-- Empresas (operadores) — solo Chile.
insert into public.empresas (id, nombre, pais) values
  ('enel_green_power',     'ENEL Green Power Chile', 'chile'),
  ('engie_chile',          'Engie Chile',            'chile'),
  ('ibereolica_chile',     'Ibereólica Chile',       'chile'),
  ('innergex_chile',       'Innergex Chile',         'chile'),
  ('nordex_chile',         'Nordex Chile',           'chile'),
  ('siemens_gamesa_chile', 'Siemens Gamesa Chile',   'chile')
on conflict (id) do update
  set nombre = excluded.nombre, pais = excluded.pais;

-- Parques. orden por país. Chile (7) con empresa_id; Argentina (15) sin empresa.
insert into public.parques (id, nombre, pais, empresa_id, turbinas, activo, orden) values
  -- Chile
  ('cl_los_buenos_aires', 'PE Los Buenos Aires',       'chile', 'enel_green_power',     12, true, 1),
  ('cl_monte_redondo',    'PE Monte Redondo',          'chile', 'engie_chile',          24, true, 2),
  ('cl_atacama',          'PE Atacama',                'chile', 'ibereolica_chile',     29, true, 3),
  ('cl_cuel',             'CUEL',                      'chile', 'innergex_chile',       22, true, 4),
  ('cl_sarco',            'SARCO',                     'chile', 'innergex_chile',       50, true, 5),
  ('cl_puelche_sur',      'Parque Eólico Puelche Sur', 'chile', 'nordex_chile',         32, true, 6),
  ('cl_el_arrayan',       'PE EL Arrayan',             'chile', 'siemens_gamesa_chile', 51, true, 7),
  -- Argentina
  ('ar_buenaventura',     'PE Buenaventura',           'argentina', null, 48, true, 1),
  ('ar_de_la_bahia',      'PE DE LA BAHIA',            'argentina', null, 18, true, 2),
  ('ar_general_levalle',  'PE GENERAL LEVALLE',        'argentina', null, 25, true, 3),
  ('ar_genoveva_1',       'PE Genoveva1',              'argentina', null, 21, true, 4),
  ('ar_genoveva_2',       'PE Genoveva2',              'argentina', null, 11, true, 5),
  ('ar_la_castellana',    'PE La Castellana',          'argentina', null,  4, true, 6),
  ('ar_la_elbita',        'PE LA ELBITA',              'argentina', null, 36, true, 7),
  ('ar_la_rinconada',     'PE La Rinconada',           'argentina', null, 21, true, 8),
  ('ar_llano_iv',         'PE LLANO IV',               'argentina', null, 18, true, 9),
  ('ar_los_olivos',       'PE Los Olivos',             'argentina', null,  6, true, 10),
  ('ar_manque',           'PE MANQUE',                 'argentina', null, 15, true, 11),
  ('ar_olavarria',        'PE OLAVARRIA',              'argentina', null, 22, true, 12),
  ('ar_pepe_vi',          'PE PEPE VI',                'argentina', null, 31, true, 13),
  ('ar_san_luis',         'PE San Luis',               'argentina', null, 50, true, 14),
  ('ar_vivorata',         'PE VIVORATA',               'argentina', null, 11, true, 15)
on conflict (id) do update set
  nombre = excluded.nombre, pais = excluded.pais,
  empresa_id = excluded.empresa_id, turbinas = excluded.turbinas,
  activo = excluded.activo, orden = excluded.orden;
```

---

## 3) `package.json`

```json
{
  "name": "iner-checkin-next",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@supabase/ssr": "^0.5.2",
    "@supabase/supabase-js": "^2.48.1",
    "next": "^15.1.6",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.7",
    "@types/react": "^19.0.7",
    "@types/react-dom": "^19.0.3",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.5.1",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.3"
  }
}
```

## 4) `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

## 5) `next.config.mjs`

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

## 6) `postcss.config.mjs`

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

## 7) `tailwind.config.ts`

Paleta dark industrial del `CLAUDE.md` (azul medianoche · amarillo oro · teal).

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        midnight: {
          DEFAULT: "#0A1929", // base azul medianoche
          800: "#0F2238",
          700: "#15324F",
        },
        oro: "#F5C518",   // amarillo oro — cifras clave / datos de impacto
        // DEFAULT (no string) para no pisar la escala teal-50…900 de Tailwind:
        // `text-teal` usa el DEFAULT; `teal-500` etc. siguen disponibles.
        teal: { DEFAULT: "#14B8A6" }, // verde azulado — acción / innovación
      },
    },
  },
  plugins: [],
};
export default config;
```

## 8) `.gitignore`

```
node_modules
.next
out
.env*.local
.DS_Store
*.tsbuildinfo
next-env.d.ts
```

## 9) `.env.local.example`

```
# Supabase (Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...anon...
# Solo servidor (NUNCA en el cliente / NEXT_PUBLIC):
SUPABASE_SERVICE_ROLE_KEY=eyJ...service_role...
```

---

## 10) `lib/supabase/client.ts` (browser)

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

## 11) `lib/supabase/server.ts` (server components / route handlers, Next 15)

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies(); // Next 15: cookies() es async

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Llamado desde un Server Component sin response: se ignora.
          }
        },
      },
    },
  );
}
```

---

## 12) `lib/catalogos.ts`

Port TS de `src/lib/catalogos.js` (mismos valores; fuente única para UI,
validaciones y `categoria` de la vista). Sin lógica de tramos (vive en SQL).

```ts
// Catálogos del modelo de datos. Espejo del Documento Maestro §6.

export const EVENTO_TIPO = {
  ENTRADA_PARQUE: "entrada_parque",
  ENTRADA_WTG: "entrada_wtg",
  SALIDA_WTG: "salida_wtg",
  INICIO_CAPACITACION: "inicio_capacitacion",
  INICIO_ALMUERZO: "inicio_almuerzo",
  INICIO_STANDBY: "inicio_standby",
  REANUDAR: "reanudar",
  SALIDA_PARQUE: "salida_parque",
} as const;
export type EventoTipo = (typeof EVENTO_TIPO)[keyof typeof EVENTO_TIPO];
export const EVENTO_TIPOS = Object.values(EVENTO_TIPO);

export const EVENTO_TIPO_LABEL: Record<EventoTipo, string> = {
  [EVENTO_TIPO.ENTRADA_PARQUE]: "Entrada al parque",
  [EVENTO_TIPO.ENTRADA_WTG]: "Entrada a máquina",
  [EVENTO_TIPO.SALIDA_WTG]: "Salida de máquina",
  [EVENTO_TIPO.INICIO_CAPACITACION]: "Capacitación",
  [EVENTO_TIPO.INICIO_ALMUERZO]: "Almuerzo",
  [EVENTO_TIPO.INICIO_STANDBY]: "Stand-by",
  [EVENTO_TIPO.REANUDAR]: "Reanudar",
  [EVENTO_TIPO.SALIDA_PARQUE]: "Salida del parque",
};

export const EVENTOS_CON_MAQUINA = [EVENTO_TIPO.ENTRADA_WTG];

export const CATEGORIA = {
  PRODUCTIVO: "productivo",
  TRASLADO: "traslado",
  STAND_BY: "stand_by",
  ALMUERZO: "almuerzo",
} as const;
export type Categoria = (typeof CATEGORIA)[keyof typeof CATEGORIA];

// Categoría del tramo según el evento que lo abre (espejo de la vista SQL).
export const CATEGORIA_POR_EVENTO: Record<EventoTipo, Categoria> = {
  [EVENTO_TIPO.ENTRADA_PARQUE]: CATEGORIA.TRASLADO,
  [EVENTO_TIPO.ENTRADA_WTG]: CATEGORIA.PRODUCTIVO,
  [EVENTO_TIPO.SALIDA_WTG]: CATEGORIA.TRASLADO,
  [EVENTO_TIPO.INICIO_CAPACITACION]: CATEGORIA.PRODUCTIVO,
  [EVENTO_TIPO.INICIO_ALMUERZO]: CATEGORIA.ALMUERZO,
  [EVENTO_TIPO.INICIO_STANDBY]: CATEGORIA.STAND_BY,
  [EVENTO_TIPO.REANUDAR]: CATEGORIA.PRODUCTIVO,
  [EVENTO_TIPO.SALIDA_PARQUE]: CATEGORIA.STAND_BY, // terminal; no abre tramo
};

export function categoriaDeEvento(tipo: EventoTipo): Categoria {
  return CATEGORIA_POR_EVENTO[tipo] ?? CATEGORIA.STAND_BY;
}

export const STANDBY_MOTIVO = {
  CLIMA: "clima",
  PRODUCCION: "produccion",
  DOCUMENTACION: "documentacion",
  PROGRAMACION_TECNICA: "programacion_tecnica",
  OTROS: "otros",
} as const;
export type StandbyMotivo = (typeof STANDBY_MOTIVO)[keyof typeof STANDBY_MOTIVO];
export const STANDBY_MOTIVOS = Object.values(STANDBY_MOTIVO);

export const STANDBY_MOTIVO_LABEL: Record<StandbyMotivo, string> = {
  [STANDBY_MOTIVO.CLIMA]: "Clima",
  [STANDBY_MOTIVO.PRODUCCION]: "Producción",
  [STANDBY_MOTIVO.DOCUMENTACION]: "Documentación",
  [STANDBY_MOTIVO.PROGRAMACION_TECNICA]: "Programación técnica",
  [STANDBY_MOTIVO.OTROS]: "Otros (especificar)",
};

export const MOTIVOS_REQUIEREN_TEXTO = [STANDBY_MOTIVO.OTROS];

export const ROL = { TECNICO: "tecnico", ADMIN: "admin" } as const;

export const SUBTIPO = {
  INTERNO: "interno",
  INSPECTOR_EXTERNO: "inspector_externo",
} as const;
export type Subtipo = (typeof SUBTIPO)[keyof typeof SUBTIPO];
export const SUBTIPOS = Object.values(SUBTIPO);

export const SUBTIPO_LABEL: Record<Subtipo, string> = {
  [SUBTIPO.INTERNO]: "Interna",
  [SUBTIPO.INSPECTOR_EXTERNO]: "Externa",
};

export const SUBTIPOS_TECNICO = [
  { id: SUBTIPO.INTERNO, label: "Interna" },
  { id: SUBTIPO.INSPECTOR_EXTERNO, label: "Externa" },
];

// Eventos permitidos por subtipo. El inspector externo no entra a turbinas.
export const EVENTOS_POR_SUBTIPO: Partial<Record<Subtipo, EventoTipo[]>> = {
  [SUBTIPO.INSPECTOR_EXTERNO]: [
    EVENTO_TIPO.ENTRADA_PARQUE,
    EVENTO_TIPO.INICIO_STANDBY,
    EVENTO_TIPO.INICIO_ALMUERZO,
    EVENTO_TIPO.REANUDAR,
    EVENTO_TIPO.SALIDA_PARQUE,
  ],
};

export function eventosPorSubtipo(subtipo: Subtipo | null): EventoTipo[] {
  return (subtipo && EVENTOS_POR_SUBTIPO[subtipo]) || EVENTO_TIPOS;
}

export const PAIS = {
  ARGENTINA: "argentina",
  CHILE: "chile",
  PERU: "peru",
  URUGUAY: "uruguay",
} as const;
export type Pais = (typeof PAIS)[keyof typeof PAIS];
export const PAISES_IDS = Object.values(PAIS);

export const PAIS_LABEL: Record<Pais, string> = {
  [PAIS.ARGENTINA]: "Argentina",
  [PAIS.CHILE]: "Chile",
  [PAIS.PERU]: "Perú",
  [PAIS.URUGUAY]: "Uruguay",
};

export const PAISES = [
  { id: PAIS.ARGENTINA, label: "Argentina" },
  { id: PAIS.CHILE, label: "Chile" },
  { id: PAIS.PERU, label: "Perú" },
  { id: PAIS.URUGUAY, label: "Uruguay" },
];

export const ESTADO_JORNADA = {
  ABIERTA: "abierta",
  CERRADA: "cerrada",
  INCOMPLETA: "incompleta",
  ANULADA: "anulada",
} as const;
export type EstadoJornada = (typeof ESTADO_JORNADA)[keyof typeof ESTADO_JORNADA];
export const ESTADOS_JORNADA = Object.values(ESTADO_JORNADA);

export const CIERRE_TIPO = {
  SALIDA_PARQUE: "salida_parque",
  AUTO_2000: "auto_2000",
} as const;
```

---

## 13) `lib/tiempo.ts`

Port TS de `src/lib/tiempo.js`. Timestamps ISO con offset chileno real.

> **DEUDA (Fase 2/4) — TZ multi-país.** Esta lib ancla todo a `America/Santiago`,
> pero 15 de los 22 parques son argentinos (y el `CHECK` admite `peru`/`uruguay`).
> Como `timestamptz` guarda el instante absoluto, las **duraciones** de `tramos`
> salen correctas. Lo que depende de la **fecha local** sí se ve afectado: el
> `fecha`/`id` de jornada y el futuro cierre `auto_2000` (20:00 local) pueden caer
> en el día equivocado para técnicos no chilenos. Antes de Fase 2/4 hay que derivar
> la TZ del **país del parque** (p.ej. un `TZ_POR_PAIS` y pasar la TZ a
> `fechaHoy*`/`ahoraISO*`). En Fase 0 no hay check-in que dependa de la fecha local,
> así que se deja la deuda registrada sin cambiar la lógica.

```ts
// Utilidades de fecha/hora ancladas a America/Santiago.
// Los timestamps se guardan como ISO 8601 con el offset chileno real del
// instante (-04:00 / -03:00 según horario de verano), nunca en UTC.

export const TZ = "America/Santiago";

/** Minutos → "Hh MMm" (ej: 135 → "2h 15m"). */
export function minutosAHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Fecha del día en Santiago como "YYYY-MM-DD" (locale sv-SE da ese formato). */
export function fechaHoyChile(date: Date = new Date()): string {
  return date.toLocaleDateString("sv-SE", { timeZone: TZ });
}

/** Offset del huso de Santiago para un instante, como "-04:00" / "-03:00". */
export function offsetChile(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const nombre =
    parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-04:00";
  const match = nombre.match(/GMT([+-]\d{2}:?\d{2})?/);
  if (!match || !match[1]) return "+00:00";
  return match[1].includes(":")
    ? match[1]
    : `${match[1].slice(0, 3)}:${match[1].slice(3)}`;
}

/** Instante actual como ISO 8601 con hora de pared de Santiago y su offset. */
export function ahoraISOChile(date: Date = new Date()): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const g = (t: string) => f.find((p) => p.type === t)?.value;
  let hora = g("hour");
  if (hora === "24") hora = "00";
  return `${g("year")}-${g("month")}-${g("day")}T${hora}:${g("minute")}:${g("second")}${offsetChile(date)}`;
}
```

---

## 14) `app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
}

body {
  background-color: #0a1929; /* azul medianoche */
  color: #e5e7eb; /* gris claro */
}
```

## 15) `app/layout.tsx`

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "INER Check-in",
  description: "Registro de jornadas de técnicos · parques eólicos",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-midnight text-gray-200 antialiased">
        {children}
      </body>
    </html>
  );
}
```

## 16) `app/page.tsx`

Health check de Fase 0: server component que lista los parques desde Supabase
(prueba conectividad + política de lectura pública del catálogo).

```tsx
import { createClient } from "@/lib/supabase/server";
import { PAIS_LABEL, type Pais } from "@/lib/catalogos";

export const dynamic = "force-dynamic";

type Parque = {
  id: string;
  nombre: string;
  pais: string;
  empresa_id: string | null;
  turbinas: number | null;
  orden: number | null;
};

export default async function Home() {
  let parques: Parque[] = [];
  let error: string | null = null;

  try {
    const supabase = await createClient();
    const { data, error: e } = await supabase
      .from("parques")
      .select("id, nombre, pais, empresa_id, turbinas, orden")
      .order("pais")
      .order("orden");
    if (e) throw e;
    parques = data ?? [];
  } catch (e) {
    error = e instanceof Error ? e.message : "Error desconocido";
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold text-white">
        INER Check-in <span className="text-oro">·</span> Fase 0
      </h1>
      <p className="mt-1 text-sm text-gray-400">
        Health check — parques leídos desde Supabase
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          <p className="font-semibold">No se pudo leer Supabase.</p>
          <p className="mt-1 break-all">{error}</p>
          <p className="mt-2 text-gray-400">
            Revisa <code>.env.local</code> y que la migración + seed estén aplicados.
          </p>
        </div>
      )}

      {!error && (
        <div className="mt-6">
          <p className="text-sm text-gray-400">
            <span className="text-oro font-semibold">{parques.length}</span>{" "}
            parques cargados
          </p>
          <ul className="mt-4 divide-y divide-midnight-700 rounded-lg border border-midnight-700">
            {parques.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div>
                  <p className="font-medium text-white">{p.nombre}</p>
                  <p className="text-xs text-gray-500">
                    {PAIS_LABEL[p.pais as Pais] ?? p.pais}
                    {p.empresa_id ? ` · ${p.empresa_id}` : ""}
                  </p>
                </div>
                {p.turbinas != null && (
                  <span className="text-sm text-teal">{p.turbinas} WTG</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
```

---

## 17) `README.md`

````markdown
# INER Check-in (Next.js + Supabase)

App de registro de jornadas de técnicos en parques eólicos. Reemplaza la versión
Vue + Firebase. Offline-first vía **PowerSync** (Fase 1).

## Setup

1. `npm install`
2. Copia `.env.local.example` a `.env.local` y completa las claves de Supabase.
3. En Supabase (SQL Editor) ejecuta, en orden:
   - `supabase/migrations/0001_init.sql`
   - `supabase/seed.sql`
4. `npm run dev` → http://localhost:3000 debe listar los 22 parques.

## Deploy (Vercel)

- Conecta el repo. Variables de entorno: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only).

## Notas de arquitectura

- **Tramos = vista SQL** (`public.tramos`). NO portar `calcularTramos`: la lógica
  vive en `0001_init.sql`. Si cambia el modelo de eventos, se actualiza la vista.
- **Empresa** se deriva del parque (FK `parques.empresa_id`), no se guarda en el
  perfil del técnico.
- **PowerSync / sync rules**: pendientes de Fase 1 (la publicación `powersync` ya
  está creada en la migración).
- `lib/catalogos.ts` y `lib/tiempo.ts` son ports de `src/lib/*` del proyecto Vue;
  mantener los valores en sync mientras conviva el código viejo.
````

---

## Verificación (fin de Fase 0)

1. Ejecutar `0001_init.sql` en Supabase sin error.
2. Ejecutar `seed.sql` → `SELECT count(*) FROM parques` = **22**; `FROM empresas` = **6**.
3. `SELECT * FROM tramos` → vacío (sin eventos) y sin error de sintaxis.
4. **Smoke de la vista** (con service_role en SQL Editor): insertar 1 técnico
   ficticio + 1 jornada + 3 eventos y comprobar que `SELECT * FROM tramos`
   devuelve 2 tramos con `duracion_min`/`categoria` correctos; luego borrar.
5. `npm run dev` → la home lista los 22 parques (prueba lectura pública del catálogo).
6. Deploy a Vercel con las env vars → misma página en producción.

### Snippet smoke de la vista (paso 4, opcional)

`tecnicos.id` referencia `auth.users(id)`, así que un UUID inventado viola la FK.
Para un smoke autocontenido en el SQL Editor, **soltar temporalmente** la FK dentro
de una transacción, insertar los datos de prueba, verificar y limpiar, y **restituir**
la FK. Todo en un solo bloque para que no quede a medias:

```sql
begin;

-- 1) Soltar la FK a auth.users SOLO durante el smoke.
alter table public.tecnicos drop constraint tecnicos_id_fkey;

-- 2) Datos de prueba (técnico + jornada + 3 eventos).
insert into public.tecnicos (id, nombre, subtipo, pais)
  values ('00000000-0000-0000-0000-000000000001','Test','interno','chile');
insert into public.jornadas (id, tecnico_id, parque_id, fecha, subtipo, estado, abierta_ts)
  values ('00000000-0000-0000-0000-000000000001_2026-06-30',
          '00000000-0000-0000-0000-000000000001','cl_atacama','2026-06-30',
          'interno','cerrada', now());
insert into public.eventos (id, jornada_id, tipo, categoria, ts_dispositivo) values
  (gen_random_uuid(),'00000000-0000-0000-0000-000000000001_2026-06-30','entrada_parque','traslado',  '2026-06-30T08:00:00-04:00'),
  (gen_random_uuid(),'00000000-0000-0000-0000-000000000001_2026-06-30','entrada_wtg','productivo','2026-06-30T08:30:00-04:00'),
  (gen_random_uuid(),'00000000-0000-0000-0000-000000000001_2026-06-30','salida_parque',null,        '2026-06-30T17:00:00-04:00');

-- 3) Verificar la vista.
select tipo_inicio, tipo_fin, duracion_min, categoria from public.tramos
  where tecnico_id = '00000000-0000-0000-0000-000000000001'
  order by inicio;
-- Esperado: 2 tramos (entrada_parque→entrada_wtg = 30 min traslado;
--           entrada_wtg→salida_parque = 510 min productivo).

-- 4) Limpieza (eventos/jornadas caen por ON DELETE CASCADE).
delete from public.tecnicos where id = '00000000-0000-0000-0000-000000000001';

-- 5) Restituir la FK exactamente como en la migración.
alter table public.tecnicos
  add constraint tecnicos_id_fkey foreign key (id)
  references auth.users(id) on delete cascade;

commit;
-- Si algo falla, `rollback;` deja todo (incluida la FK) como estaba.
```

> Alternativa sin tocar la FK: crear un usuario real con
> `select auth.uid` … (mejor desde Authentication → Add user en el panel) y usar ese
> UUID en los inserts. El bloque de arriba es el camino reproducible 100% en SQL.

## Fuera de alcance (fases siguientes)
- **TZ por país** en `lib/tiempo.ts` (derivar huso del parque; ver DEUDA §13). Fase 2/4.
- PowerSync runtime + sync rules + login (Fase 1).
- Check-in del técnico / botón "Salir de parque" / colección `asignaciones`
  (Fase 2; el diseño de `asignaciones` sigue EN ESPERA de tu actualización).
- Dashboard ejecutivo y gráficos (Fase 3).
- n8n → Postgres + `pg_cron` cierre auto 20:00 (Fase 4).
