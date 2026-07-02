-- =====================================================================
-- 0002 — Asistencia externa (PLOM) + Consolidado por parque
-- Correr una vez en el SQL Editor de Supabase. Idempotente (create or
-- replace / drop if exists). Ver ASISTENCIA_EXTERNA.md para el mapeo a n8n.
--
-- Cambios:
--   1) public.reporte_externo  → agrega evento_id (match estable para n8n)
--      y una rama para días de standby completo (jornada sin ningún aero).
--   2) public.resumen_asistencia (NUEVA) → una fila por parque de externos
--      (pestaña "Consolidado" del libro real).
--   3) grant select de la vista nueva a n8n_reader.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) reporte_externo — misma proyección PLOM, con dos añadidos:
--    · evento_id = id del evento entrada_wtg (o del inicio_standby en la
--      fila de día-standby): clave estable para el Append-or-Update de n8n.
--    · rama UNION ALL: emite una fila por jornada de externo con standby y
--      sin ningún entrada_wtg (mismo predicado que reporte_externo_resumen.sb),
--      así el detalle cuadra con los "Día Stand By" del libro real.
-- ---------------------------------------------------------------------
create or replace view public.reporte_externo as
with base as (   -- eventos de externos que forman la cadena, por jornada
  select ec.id as evento_id,
         ec.jornada_id, ec.fecha, ec.grupo_clave, ec.tecnico_id, ec.pais,
         ec.parque_id, ec.parque_nombre, ec.tipo, ec.ts_dispositivo, ec.maquina_id
  from public.eventos_ctx ec
  where ec.subtipo = 'inspector_externo'
    and ec.tipo in ('entrada_parque','entrada_wtg','salida_wtg','salida_parque')
),
seq as (
  select b.*,
         lag(ts_dispositivo)  over w as prev_ts,   -- salida anterior / llegada
         lead(ts_dispositivo) over w as next_ts,
         lead(tipo)           over w as next_tipo
  from base b
  window w as (partition by jornada_id order by ts_dispositivo)
),
cierre as (   -- por jornada: salida de parque y última salida de aero
  select jornada_id,
         max(ts_dispositivo) filter (where tipo = 'salida_parque') as salida_de_parque,
         max(ts_dispositivo) filter (where tipo = 'salida_wtg')    as ultima_salida_wtg
  from base
  group by jornada_id
),
obs as (   -- observación por jornada: standby (motivo) + comentarios (todos los eventos)
  select ec.jornada_id,
         nullif(concat_ws(' · ',
           string_agg(distinct case when ec.tipo = 'inicio_standby'
                                    then coalesce(ec.motivo_otro, ec.motivo) end, ' · '),
           string_agg(distinct nullif(trim(coalesce(ec.comentario,'')), ''), ' · ')
         ), '') as observacion
  from public.eventos_ctx ec
  where ec.subtipo = 'inspector_externo'
  group by ec.jornada_id
),
standby_dias as (   -- jornadas de externo con standby y SIN ningún entrada_wtg
  select ec.jornada_id, ec.grupo_clave, ec.tecnico_id, ec.pais,
         ec.parque_id, ec.parque_nombre, ec.fecha,
         (array_agg(ec.id order by ec.ts_dispositivo)
            filter (where ec.tipo = 'inicio_standby'))[1] as evento_id,
         nullif(concat_ws(' · ',
           string_agg(distinct case when ec.tipo = 'inicio_standby'
                                    then coalesce(ec.motivo_otro, ec.motivo) end, ' · '),
           string_agg(distinct nullif(trim(coalesce(ec.comentario,'')), ''), ' · ')
         ), '') as observacion
  from public.eventos_ctx ec
  where ec.subtipo = 'inspector_externo'
  group by ec.jornada_id, ec.grupo_clave, ec.tecnico_id, ec.pais,
           ec.parque_id, ec.parque_nombre, ec.fecha
  having count(*) filter (where ec.tipo = 'inicio_standby') > 0
     and count(*) filter (where ec.tipo = 'entrada_wtg')    = 0
)
-- Filas por visita (una por entrada_wtg):
select
  s.grupo_clave, s.tecnico_id, s.pais, s.parque_id, s.parque_nombre,
  s.fecha,
  extract(day   from s.fecha)::int as dia,
  extract(month from s.fecha)::int as mes,
  extract(year  from s.fecha)::int as anio,
  a.numero as wtg, a.nombre as wtg_nombre,
  s.prev_ts        as esfuerzo_inicio,             -- = salida anterior (o llegada en el 1º)
  s.ts_dispositivo as parada_aero,                 -- = entrada_wtg
  greatest(0, round(extract(epoch from (s.ts_dispositivo - s.prev_ts)) / 60.0))::int as traslado_min,
  case when s.next_tipo in ('salida_wtg','salida_parque') then s.next_ts end as esfuerzo_final,
  case when s.next_tipo in ('salida_wtg','salida_parque') then s.next_ts end as inicio_aero,
  c.salida_de_parque,
  greatest(0, round(extract(epoch from (c.salida_de_parque - c.ultima_salida_wtg)) / 60.0))::int as tiempo_min,
  o.observacion,
  s.evento_id
from seq s
join public.aeros a on a.id = s.maquina_id
left join cierre c on c.jornada_id = s.jornada_id
left join obs    o on o.jornada_id = s.jornada_id
where s.tipo = 'entrada_wtg'
union all
-- Filas de día de standby completo (sin aero):
select
  sd.grupo_clave, sd.tecnico_id, sd.pais, sd.parque_id, sd.parque_nombre,
  sd.fecha,
  extract(day   from sd.fecha)::int as dia,
  extract(month from sd.fecha)::int as mes,
  extract(year  from sd.fecha)::int as anio,
  null::int          as wtg,
  null::text         as wtg_nombre,
  null::timestamptz  as esfuerzo_inicio,
  null::timestamptz  as parada_aero,
  null::int          as traslado_min,
  null::timestamptz  as esfuerzo_final,
  null::timestamptz  as inicio_aero,
  null::timestamptz  as salida_de_parque,
  null::int          as tiempo_min,
  sd.observacion,
  sd.evento_id
from standby_dias sd;

-- ---------------------------------------------------------------------
-- 2) resumen_asistencia — pestaña "Consolidado": UNA fila por parque de
--    externos. Vista definer (sin security_invoker) → n8n_reader la lee sin
--    tocar RLS. Reutiliza patrones de reporte_resumen (objetivo/avance) y
--    reporte_externo_resumen (fechas/promedio), pero agregando por parque.
-- ---------------------------------------------------------------------
create or replace view public.resumen_asistencia as
with obj as (   -- turbinas objetivo del parque (catálogo)
  select p.id as parque_id, p.nombre as parque, p.pais,
         coalesce(p.turbinas, count(a.id))::int as turbinas_objetivo
  from public.parques p
  left join public.aeros a on a.parque_id = p.id
  group by p.id, p.nombre, p.pais, p.turbinas
),
ext as (   -- actividad de externos por parque (eventos_ctx ya trae subtipo)
  select ec.parque_id,
         count(distinct ec.fecha) filter (where ec.tipo = 'entrada_wtg') as dias_trabajados,
         min(ec.fecha) as fecha_inicio,
         max(ec.fecha) as fecha_termino
  from public.eventos_ctx ec
  where ec.subtipo = 'inspector_externo'
  group by ec.parque_id
),
insp as (   -- aeros distintos inspeccionados por parque (solo externos)
  select v.parque_id,
         count(distinct v.maquina_id) filter (where v.inspeccionado) as inspeccionadas
  from public.visitas_aero v
  join public.tecnicos t on t.id = v.tecnico_id
  where t.subtipo = 'inspector_externo'
  group by v.parque_id
),
resp as (   -- responsable = técnico con más días trabajados en el parque
  select distinct on (parque_id) parque_id, tecnico_id
  from (
    select ec.parque_id, ec.tecnico_id,
           count(distinct ec.fecha) filter (where ec.tipo = 'entrada_wtg') as d
    from public.eventos_ctx ec
    where ec.subtipo = 'inspector_externo'
    group by ec.parque_id, ec.tecnico_id
  ) q
  order by parque_id, d desc, tecnico_id
),
sb as (   -- horas de standby en tiempo: suma de tramos inicio_standby → evento siguiente
  select parque_id, sum(dur_min)::int as horas_standby_min
  from (
    select ec.parque_id,
           greatest(0, round(extract(epoch from (
             lead(ec.ts_dispositivo) over (partition by ec.jornada_id order by ec.ts_dispositivo)
             - ec.ts_dispositivo)) / 60.0))::int as dur_min,
           ec.tipo
    from public.eventos_ctx ec
    where ec.subtipo = 'inspector_externo'
  ) w
  where tipo = 'inicio_standby' and dur_min is not null
  group by parque_id
)
select
  o.pais, o.parque_id, o.parque,
  tr.nombre as responsable,
  o.turbinas_objetivo,
  coalesce(i.inspeccionadas, 0)                                             as inspeccionadas,
  greatest(0, o.turbinas_objetivo - coalesce(i.inspeccionadas, 0))          as pendientes,
  round(100.0 * coalesce(i.inspeccionadas, 0) / nullif(o.turbinas_objetivo, 0), 2) as pct_avance,
  coalesce(s.horas_standby_min, 0)                                          as horas_standby_min,
  e.dias_trabajados,
  round(coalesce(i.inspeccionadas, 0)::numeric / nullif(e.dias_trabajados, 0), 2) as prom_diario,
  e.fecha_inicio, e.fecha_termino
from ext e
join obj  o  on o.parque_id = e.parque_id
left join insp i on i.parque_id = e.parque_id
left join resp r on r.parque_id = e.parque_id
left join public.tecnicos tr on tr.id = r.tecnico_id
left join sb   s on s.parque_id = e.parque_id;

-- ---------------------------------------------------------------------
-- 3) Grant a n8n_reader (la vista es definer → lee sin RLS ni tablas base).
-- ---------------------------------------------------------------------
grant select on public.resumen_asistencia to n8n_reader;

-- Limpieza: asistencia_wtg quedó deprecada por reporte_externo.
-- Descomentar si la base viva la tiene creada de una sesión previa:
-- drop view if exists public.asistencia_wtg;
