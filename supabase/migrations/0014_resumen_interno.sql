-- =====================================================================
-- 0014 — resumen_interno (tablero de la pestaña "Resumen" de la planilla
-- interna). Vista NUEVA (no toca reporte_resumen). Una fila por
-- (equipo/grupo, parque) de subtipo interno. Definer + grant a n8n_reader.
--
-- Cubre las DOS tablas de la pestaña Resumen:
--   · "Resumen Operacional Inspección interna"  → columnas *_parque
--   · "Desempeño por Equipo"                    → columnas por grupo
-- (todas las métricas salen de acá; "Informes NL" es manual).
--
-- Notas de diseño:
--   · inspeccionadas / pendientes / pct_avance son POR GRUPO. Si dos equipos
--     comparten parque, sus filas no suman el avance del parque; para eso
--     están inspeccionadas_parque / pendientes_parque / pct_avance_parque,
--     iguales en todas las filas de un mismo parque.
--   · Se arranca desde `dias` (presencia en sitio) con left join a las
--     inspecciones: un grupo con días de puro standby aparece en 0%, no se
--     cae de la vista (mismo criterio que resumen_asistencia de 0002).
-- =====================================================================
create or replace view public.resumen_interno as
with obj as (   -- turbinas objetivo del parque (catálogo)
  select p.id as parque_id, p.nombre as parque_nombre, p.pais,
         coalesce(p.turbinas, count(a.id))::int as turbinas_objetivo
  from public.parques p
  left join public.aeros a on a.parque_id = p.id
  group by p.id, p.nombre, p.pais, p.turbinas
),
vis as (   -- visitas de internos (base de las dos agregaciones de abajo)
  select v.grupo_clave, v.parque_id, v.maquina_id, v.fecha, v.inspeccionado
  from public.visitas_aero v
  join public.tecnicos t on t.id = v.tecnico_id
  where t.subtipo = 'interno'
),
ins as (   -- inspeccionadas por grupo/parque
  select grupo_clave, parque_id,
         count(distinct maquina_id) filter (where inspeccionado) as inspeccionadas
  from vis
  group by grupo_clave, parque_id
),
ins_p as (   -- inspeccionadas por parque (todos los grupos internos juntos)
  select parque_id,
         count(distinct maquina_id) filter (where inspeccionado) as inspeccionadas
  from vis
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
  3 * coalesce(i.inspeccionadas, 0)                                 as palas,
  d.dias_sitio,
  d.dias_productivos,
  round(100.0 * d.dias_productivos / nullif(d.dias_sitio, 0), 2)    as pct_productividad,
  round(coalesce(i.inspeccionadas, 0)::numeric
        / nullif(d.dias_productivos, 0), 2)                         as turb_dia,
  -- Resumen Operacional (por parque; repetido en cada fila del parque):
  coalesce(ip.inspeccionadas, 0)                                    as inspeccionadas_parque,
  greatest(0, o.turbinas_objetivo - coalesce(ip.inspeccionadas, 0)) as pendientes_parque,
  round(100.0 * coalesce(ip.inspeccionadas, 0)
        / nullif(o.turbinas_objetivo, 0), 2)                        as pct_avance_parque
from dias d
join obj o        on o.parque_id = d.parque_id
left join ins i   on i.grupo_clave = d.grupo_clave and i.parque_id = d.parque_id
left join ins_p ip on ip.parque_id = d.parque_id;

-- ---------------------------------------------------------------------
-- Permisos. La vista es definer (sin security_invoker) → salta la RLS. Hay que
-- revocar el select que Supabase concede por defecto a anon/authenticated, o
-- cualquier usuario logueado de la app leería el avance de todos los equipos.
-- Mismo patrón que 0001_init.sql para las vistas reporte_*.
-- ---------------------------------------------------------------------
revoke all on public.resumen_interno from anon, authenticated;
grant select on public.resumen_interno to n8n_reader;

-- Fix retroactivo: a resumen_asistencia (0002) nunca se le hizo el revoke.
revoke all on public.resumen_asistencia from anon, authenticated;
