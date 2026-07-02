-- =====================================================================
-- 0004 — Config por país (data-driven) para limitar las vistas del técnico.
-- Correr una vez en el SQL Editor de Supabase. Idempotente (add column if not
-- exists / update). La app lee estas banderas (policy de lectura pública ya
-- existe, ver 0001) y las usa para filtrar parques y el set de botones.
--
-- Matriz acordada:
--   Argentina        → interno + externo, con almuerzo y equipos (X-C / F-K)
--   Chile/Perú/Uruguay → solo externo (PLOM), sin almuerzo ni equipos
-- Los defaults dejan a todo país como "solo externo"; Argentina se abre abajo.
-- =====================================================================

alter table public.paises
  add column if not exists permite_interno boolean not null default false,
  add column if not exists permite_externo boolean not null default true,
  add column if not exists usa_almuerzo    boolean not null default false,
  add column if not exists usa_equipos     boolean not null default false;

update public.paises
  set permite_interno = true,
      permite_externo = true,
      usa_almuerzo    = true,
      usa_equipos     = true
  where id = 'argentina';

-- Chile / Perú / Uruguay se quedan con los defaults (externo, sin almuerzo/equipos).
