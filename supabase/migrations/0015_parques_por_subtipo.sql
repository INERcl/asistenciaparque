-- =====================================================================
-- 0015 — Parques por subtipo: la interna y la externa no visitan los mismos
-- parques. Correr una vez en el SQL Editor de Supabase. Idempotente.
--
-- Espeja el patrón data-driven de `paises` (ver 0004_paises_config.sql): dos
-- banderas independientes, porque hay parques que visitan AMBOS flujos.
--
--   paises  → qué flujos existen en el país.
--   parques → cuáles de esos flujos aplican a cada parque.  ← esta migración
--
-- La app filtra el catálogo con la bandera que corresponde al `subtipo` del
-- técnico (ver columnaParquePermitida() en lib/catalogos.ts).
--
-- Los defaults dejan a todo parque como "solo externo", que es el estado real
-- de Chile y Perú; los parques de la interna se marcan abajo.
-- =====================================================================

begin;

alter table public.parques
  add column if not exists permite_interno boolean not null default false,
  add column if not exists permite_externo boolean not null default true;

-- ---------------------------------------------------------------------
-- Los 15 parques que visita la interna. Hoy son un subconjunto estricto de la
-- externa: los 15 son mixtos (permite_externo se queda en true por default) y
-- no hay ningún parque de solo-interna, por eso no hay un update que ponga
-- permite_externo = false.
--
-- Ojo: filtrar por la columna `pais`, nunca por el prefijo del id — el parque
-- 'ar_punta_lomitas' tiene prefijo ar_ pero su pais es 'peru'.
-- ---------------------------------------------------------------------
update public.parques set permite_interno = true
  where id in (
    'ar_buenaventura',
    'ar_de_la_bahia',
    'ar_general_levalle',
    'ar_genoveva_1',
    'ar_genoveva_2',
    'ar_la_castellana',
    'ar_la_elbita',
    'ar_la_rinconada',
    'ar_llano_iv',
    'ar_los_olivos',
    'ar_manque',
    'ar_olavarria',
    'ar_pepe_vi',
    'ar_san_luis',
    'ar_vivorata'
  );

-- Guardia: si el update de arriba no marcó exactamente 15 parques, algún id
-- cambió o falta un parque; aborta antes de dejar el catálogo a medias.
do $$
declare n int;
begin
  select count(*) into n from public.parques where permite_interno;
  if n <> 15 then
    raise exception 'Se esperaban 15 parques internos, hay %', n;
  end if;
end $$;

commit;

-- Verificación (correr aparte):
--   select permite_interno, permite_externo, count(*), array_agg(id order by orden)
--     from public.parques where pais = 'argentina' and activo
--    group by 1, 2;
