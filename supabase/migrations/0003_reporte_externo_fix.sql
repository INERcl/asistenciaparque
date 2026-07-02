-- =====================================================================
-- 0003 — Fix de reporte_externo: cierre por finalizar_parque + ts del traslado
-- Correr una vez en el SQL Editor de Supabase. Idempotente (create or replace).
-- Supersede la definición de reporte_externo de 0002 (mantiene evento_id y la
-- rama de "día de standby completo"). Ver ASISTENCIA_EXTERNA.md.
--
-- Cambios respecto de 0002:
--   1) finalizar_parque cuenta como cierre terminal (igual que visitas_aero /
--      reporte_planilla): antes, si el último día se cerraba con "Finalizar
--      parque", el último aero perdía esfuerzo_final/inicio_aero y la jornada
--      perdía salida_de_parque/tiempo_min.
--   2) traslado_maquina entra a la cadena: como el flujo externo obliga a
--      registrar "Traslado" antes de cada "Parada de aero", el lag de cada
--      entrada_wtg pasa a ser el ts de ese traslado_maquina, así:
--        · esfuerzo_inicio = inicio del traslado a ese aero (no la salida
--          anterior), y
--        · traslado_min    = parada_aero − traslado_maquina = traslado real.
--      Si faltara el Traslado (dato viejo), el lag cae en la salida anterior:
--      mismo comportamiento que antes (fallback sin cambios de esquema).
-- =====================================================================

create or replace view public.reporte_externo as
with base as (   -- eventos de externos que forman la cadena, por jornada
  select ec.id as evento_id,
         ec.jornada_id, ec.fecha, ec.grupo_clave, ec.tecnico_id, ec.pais,
         ec.parque_id, ec.parque_nombre, ec.tipo, ec.ts_dispositivo, ec.maquina_id
  from public.eventos_ctx ec
  where ec.subtipo = 'inspector_externo'
    and ec.tipo in ('entrada_parque','traslado_maquina','entrada_wtg',
                    'salida_wtg','salida_parque','finalizar_parque')
),
seq as (
  select b.*,
         lag(ts_dispositivo)  over w as prev_ts,   -- traslado a este aero (o salida anterior)
         lead(ts_dispositivo) over w as next_ts,
         lead(tipo)           over w as next_tipo
  from base b
  window w as (partition by jornada_id order by ts_dispositivo)
),
cierre as (   -- por jornada: salida de parque (o finalizar) y última salida de aero
  select jornada_id,
         max(ts_dispositivo) filter (where tipo in ('salida_parque','finalizar_parque')) as salida_de_parque,
         max(ts_dispositivo) filter (where tipo = 'salida_wtg')                          as ultima_salida_wtg
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
  s.prev_ts        as esfuerzo_inicio,             -- = traslado a este aero (o salida anterior/llegada)
  s.ts_dispositivo as parada_aero,                 -- = entrada_wtg
  greatest(0, round(extract(epoch from (s.ts_dispositivo - s.prev_ts)) / 60.0))::int as traslado_min,
  case when s.next_tipo in ('salida_wtg','salida_parque','finalizar_parque') then s.next_ts end as esfuerzo_final,
  case when s.next_tipo in ('salida_wtg','salida_parque','finalizar_parque') then s.next_ts end as inicio_aero,
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
