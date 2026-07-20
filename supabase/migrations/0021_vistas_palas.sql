-- =====================================================================
-- 0021 — Vistas para la inspección interna por palas (usa eventos.palas de 0020)
-- Correr una vez en el SQL Editor. Idempotente (create or replace).
--
-- Unidad = cavidad (pala A/B/C × lado TEC/LEC = 6 por turbina). Una turbina está
-- COMPLETA cuando la unión de las cavidades de TODAS sus visitas (equipo/parque,
-- cross-jornada) cubre las 6. Retrocompat: salida_wtg con palas null = turbina
-- entera (externo/legado); cierre de día/parque con el aero abierto = entera.
--
-- OJO create or replace: solo permite AGREGAR columnas al final (no quitar ni
-- reordenar); sí se puede cambiar la EXPRESIÓN de una columna existente si conserva
-- nombre y tipo. Por eso `visitas_aero` y `resumen_interno` conservan su orden.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers de cavidades. inmutables → usables en vistas/índices.
-- ---------------------------------------------------------------------
create or replace function public.palas_de_cavidades(cavs text[])
returns int language sql immutable as $$
  -- Palas (A/B/C) con sus DOS lados (TEC y LEC) presentes.
  select count(*)::int
  from (values ('A'), ('B'), ('C')) as b(p)
  where (b.p || '-TEC') = any(coalesce(cavs, '{}'))
    and (b.p || '-LEC') = any(coalesce(cavs, '{}'));
$$;

create or replace function public.cavidades_faltantes(cavs text[])
returns text[] language sql immutable as $$
  select coalesce(array_agg(c order by c), '{}')
  from unnest(array['A-TEC','A-LEC','B-TEC','B-LEC','C-TEC','C-LEC']) as c
  where not (c = any(coalesce(cavs, '{}')));
$$;

-- ---------------------------------------------------------------------
-- visitas_aero — se le AGREGA `cavidades` (text[]) = cavidades cerradas en esa
-- visita. Vacío si el ingreso no cerró; las 6 si cerró sin detalle (legado) o si
-- lo cerró el fin del día/parque con el aero abierto.
-- ---------------------------------------------------------------------
-- Nota: `eventos_ctx` (0001) se creó con `select e.*`, que expande las columnas al
-- crear la vista → NO incluye la nueva `eventos.palas`. En vez de recrear eventos_ctx
-- (insertaría palas en el medio y rompería create or replace), traemos `palas`
-- uniendo directo a `eventos` por id.
create or replace view public.visitas_aero as
with x as (
  select ec.*, e.palas,
         lead(ec.tipo)           over w as next_tipo,
         lead(ec.ts_dispositivo) over w as next_ts,
         lead(e.palas)           over w as next_palas
  from public.eventos_ctx ec
  join public.eventos e on e.id = ec.id
  window w as (partition by ec.jornada_id order by ec.ts_dispositivo)
)
select x.grupo_clave, x.pais, x.parque_id, x.parque_nombre, x.fecha, x.tecnico_id,
       x.maquina_id, a.numero, a.nombre,
       x.ts_dispositivo as ingreso,
       case when x.next_tipo in ('salida_wtg','salida_parque','finalizar_parque')
            then x.next_ts end as salida,
       (x.next_tipo in ('salida_wtg','salida_parque','finalizar_parque')) as inspeccionado,
       -- NUEVO: cavidades de esta visita.
       case
         when x.next_tipo = 'salida_wtg' and x.next_palas is not null
           then array(select jsonb_array_elements_text(x.next_palas))
         when x.next_tipo in ('salida_wtg','salida_parque','finalizar_parque')
           then array['A-TEC','A-LEC','B-TEC','B-LEC','C-TEC','C-LEC']
         else array[]::text[]
       end as cavidades
from x
left join public.aeros a on a.id = x.maquina_id
where x.tipo = 'entrada_wtg';

-- ---------------------------------------------------------------------
-- reporte_planilla — UNA fila por (grupo, parque, día). Cambia:
--   · palas   = palas (blades) completadas ESE DÍA (antes 3 × turbinas),
--   · visitas = cada turbina suma `cavidades` (las de ese día) y `pendiente`
--               (la turbina aún no llega a 6/6 acumulando todas sus visitas),
-- para que n8n escriba "Palas insp" real y una observación de lo pendiente.
-- ---------------------------------------------------------------------
create or replace view public.reporte_planilla as
with cab as (
  select grupo_clave, pais, parque_id, parque_nombre, fecha,
         max(subtipo) as subtipo, max(equipo_id) as equipo_id,
         min(ts_dispositivo) filter (where tipo = 'entrada_parque')                         as llegada,
         min(ts_dispositivo) filter (where tipo in ('traslado_maquina','entrada_wtg'))      as inicio_actividades,
         min(ts_dispositivo) filter (where tipo = 'inicio_almuerzo')                        as colacion,
         max(ts_dispositivo) filter (where tipo in ('salida_parque','finalizar_parque'))     as termino,
         string_agg(distinct nullif(trim(coalesce(comentario,'')), ''), ' · ')              as comentarios,
         string_agg(distinct case when tipo = 'inicio_standby'
                                  then coalesce(motivo_otro, motivo) end, ' · ')            as standby
  from public.eventos_ctx
  group by grupo_clave, pais, parque_id, parque_nombre, fecha
),
comp as (   -- unión cumulativa de cavidades por turbina (cross-jornada), para completa/pendiente
  select v.grupo_clave, v.parque_id, v.maquina_id,
         coalesce(array_agg(distinct c) filter (where c is not null), '{}') as cavs
  from public.visitas_aero v
  left join lateral unnest(v.cavidades) as c on true
  group by v.grupo_clave, v.parque_id, v.maquina_id
),
diaturb as (   -- por turbina y día: horas + cavidades cerradas ese día
  select v.grupo_clave, v.parque_id, v.fecha, v.maquina_id, v.numero, v.nombre,
         min(v.ingreso) as ingreso, max(v.salida) as salida,
         bool_or(v.inspeccionado) as inspeccionado,
         coalesce(array_agg(distinct c) filter (where c is not null), '{}') as cav_dia
  from public.visitas_aero v
  left join lateral unnest(v.cavidades) as c on true
  group by v.grupo_clave, v.parque_id, v.fecha, v.maquina_id, v.numero, v.nombre
),
vis as (
  select dt.grupo_clave, dt.parque_id, dt.fecha,
         count(*) filter (where dt.inspeccionado)                        as aeros_inspeccionados,
         coalesce(sum(public.palas_de_cavidades(dt.cav_dia)), 0)         as palas, -- bigint (match tipo previo)
         jsonb_agg(jsonb_build_object(
           'aero', dt.maquina_id, 'numero', dt.numero, 'nombre', dt.nombre,
           'ingreso', dt.ingreso, 'salida', dt.salida,
           'cavidades', to_jsonb(dt.cav_dia),
           'palas', public.palas_de_cavidades(dt.cav_dia),
           'pendiente', public.palas_de_cavidades(coalesce(c.cavs, '{}')) < 3,
           'faltan', to_jsonb(public.cavidades_faltantes(coalesce(c.cavs, '{}'))))
           order by dt.ingreso)                                          as visitas
  from diaturb dt
  left join comp c
    on c.grupo_clave = dt.grupo_clave and c.parque_id = dt.parque_id
   and c.maquina_id = dt.maquina_id
  group by dt.grupo_clave, dt.parque_id, dt.fecha
)
select c.grupo_clave, c.equipo_id, c.subtipo, c.pais,
       c.parque_id, c.parque_nombre,
       c.fecha,
       extract(day   from c.fecha)::int as dia,
       extract(month from c.fecha)::int as mes,
       extract(year  from c.fecha)::int as anio,
       c.llegada, c.inicio_actividades, c.colacion, c.termino,
       coalesce(v.aeros_inspeccionados, 0) as aeros_inspeccionados,
       coalesce(v.palas, 0)               as palas,
       v.visitas,
       nullif(concat_ws(' · ', c.standby, c.comentarios), '') as observaciones
from cab c
left join vis v
  on v.grupo_clave = c.grupo_clave and v.parque_id = c.parque_id and v.fecha = c.fecha;

-- ---------------------------------------------------------------------
-- resumen_interno — tablero de la pestaña "Resumen" interna. Cambios:
--   · inspeccionadas = turbinas COMPLETAS (6/6, unión cross-jornada),
--   · pendientes / pct_avance / palas / *_parque recalculados sobre completas,
--   · reinspeccionadas = turbinas completas con cavidades cerradas de más (>6),
--   · NUEVO al final: parciales, cavidades_hechas, pct_avance_cav.
-- Se conserva EXACTO el orden de columnas de 0016 y se agregan las nuevas al final.
-- ---------------------------------------------------------------------
create or replace view public.resumen_interno as
with obj as (   -- turbinas objetivo del parque (catálogo)
  select p.id as parque_id, p.nombre as parque_nombre, p.pais,
         coalesce(p.turbinas, count(a.id))::int as turbinas_objetivo
  from public.parques p
  left join public.aeros a on a.parque_id = p.id
  group by p.id, p.nombre, p.pais, p.turbinas
),
vis as (   -- visitas internas con sus cavidades
  select v.grupo_clave, v.parque_id, v.maquina_id, v.numero, v.fecha,
         v.inspeccionado, v.cavidades
  from public.visitas_aero v
  join public.tecnicos t on t.id = v.tecnico_id
  where t.subtipo = 'interno'
),
cav as (   -- unión de cavidades por turbina (el lateral explota filas: solo distinct)
  select grupo_clave, parque_id, maquina_id, max(numero) as numero,
         coalesce(array_agg(distinct c) filter (where c is not null), '{}') as cavs
  from vis
  left join lateral unnest(vis.cavidades) as c on true
  group by grupo_clave, parque_id, maquina_id
),
cierres as (   -- total de cavidades cerradas (con repetición) por turbina, sin lateral
  select grupo_clave, parque_id, maquina_id,
         coalesce(sum(coalesce(array_length(cavidades, 1), 0)), 0) as cierres_cav
  from vis
  group by grupo_clave, parque_id, maquina_id
),
turb as (   -- unión de cavidades + total de cierres (para reinspección)
  select c.grupo_clave, c.parque_id, c.maquina_id, c.numero, c.cavs,
         coalesce(ci.cierres_cav, 0) as cierres_cav
  from cav c
  join cierres ci using (grupo_clave, parque_id, maquina_id)
),
ins as (   -- por grupo/parque: completas, parciales, palas y cavidades
  select grupo_clave, parque_id,
         count(*) filter (where public.palas_de_cavidades(cavs) >= 3)              as inspeccionadas,
         count(*) filter (where public.palas_de_cavidades(cavs) < 3
                            and coalesce(array_length(cavs, 1), 0) > 0)            as parciales,
         coalesce(sum(public.palas_de_cavidades(cavs)), 0)                         as palas,
         coalesce(sum(coalesce(array_length(cavs, 1), 0)), 0)                      as cavidades_hechas
  from turb
  group by grupo_clave, parque_id
),
reinsp as (   -- completas con cavidades cerradas de más (una cavidad revisada 2+ veces)
  select grupo_clave, parque_id,
         count(*)                                       as reinspeccionadas,
         string_agg(numero::text, ', ' order by numero) as reinsp_wtg
  from turb
  where public.palas_de_cavidades(cavs) >= 3 and cierres_cav > 6
  group by grupo_clave, parque_id
),
turb_p as (   -- unión de cavidades por turbina a nivel PARQUE (todos los grupos internos)
  select parque_id, maquina_id,
         coalesce(array_agg(distinct c) filter (where c is not null), '{}') as cavs
  from vis
  left join lateral unnest(vis.cavidades) as c on true
  group by parque_id, maquina_id
),
ins_p as (
  select parque_id,
         count(*) filter (where public.palas_de_cavidades(cavs) >= 3) as inspeccionadas
  from turb_p
  group by parque_id
),
dias as (   -- días sitio/productivos + equipo_id, SOLO internos
  select ec.grupo_clave, ec.parque_id,
         max(ec.equipo_id) as equipo_id,
         count(distinct ec.fecha) as dias_sitio,
         count(distinct ec.fecha) filter (
           where exists (select 1 from vis v
                         where v.grupo_clave = ec.grupo_clave and v.parque_id = ec.parque_id
                           and v.fecha = ec.fecha and v.inspeccionado)) as dias_productivos
  from public.eventos_ctx ec
  where ec.subtipo = 'interno'
  group by ec.grupo_clave, ec.parque_id
)
select
  d.grupo_clave, d.equipo_id, o.pais, o.parque_id, o.parque_nombre,
  o.turbinas_objetivo,
  -- Desempeño por Equipo (por grupo):
  coalesce(i.inspeccionadas, 0)                                     as inspeccionadas,
  greatest(0, o.turbinas_objetivo - coalesce(i.inspeccionadas, 0))  as pendientes,
  round(100.0 * coalesce(i.inspeccionadas, 0)
        / nullif(o.turbinas_objetivo, 0), 2)                        as pct_avance,
  coalesce(i.palas, 0)                                              as palas,
  d.dias_sitio,
  d.dias_productivos,
  round(100.0 * d.dias_productivos / nullif(d.dias_sitio, 0), 2)    as pct_productividad,
  round(coalesce(i.inspeccionadas, 0)::numeric
        / nullif(d.dias_productivos, 0), 2)                         as turb_dia,
  -- Resumen Operacional (por parque; repetido en cada fila del parque):
  coalesce(ip.inspeccionadas, 0)                                    as inspeccionadas_parque,
  greatest(0, o.turbinas_objetivo - coalesce(ip.inspeccionadas, 0)) as pendientes_parque,
  round(100.0 * coalesce(ip.inspeccionadas, 0)
        / nullif(o.turbinas_objetivo, 0), 2)                        as pct_avance_parque,
  -- Reinspecciones (0016):
  coalesce(re.reinspeccionadas, 0)                                  as reinspeccionadas,
  re.reinsp_wtg,
  -- NUEVO (0021): parciales y avance fino por cavidad:
  coalesce(i.parciales, 0)                                          as parciales,
  coalesce(i.cavidades_hechas, 0)                                   as cavidades_hechas,
  round(100.0 * coalesce(i.cavidades_hechas, 0)
        / nullif(o.turbinas_objetivo * 6, 0), 2)                    as pct_avance_cav
from dias d
join obj o        on o.parque_id = d.parque_id
left join ins i   on i.grupo_clave = d.grupo_clave and i.parque_id = d.parque_id
left join ins_p ip on ip.parque_id = d.parque_id
left join reinsp re on re.grupo_clave = d.grupo_clave and re.parque_id = d.parque_id;

-- Permisos (las vistas definer saltan RLS; create or replace conserva los grants
-- previos, pero re-asegura n8n_reader por si esta es una base nueva).
revoke all on public.resumen_interno from anon, authenticated;
grant select on public.resumen_interno to n8n_reader;
