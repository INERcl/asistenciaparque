-- Inspección externa: salida_parque/finalizar_parque no equivalen a RUN.
-- Conserva la definición desplegada (incluidas las reglas de standby que
-- no están en las migraciones locales) y sus columnas, tipos y permisos.
-- No modifica eventos ni horas. Aplicar en el SQL Editor de Supabase.
begin;

do $migration$
declare
  vista text;
  cuerpo text;
  columnas text;
  condicion text;
  secuencia text := $sql$
    with secuencia_run as (
      select ec.*,
             lead(tipo) over w as siguiente_tipo
      from public.eventos_ctx ec
      where ec.anulado = false
        and ec.tipo in ('entrada_parque', 'traslado_maquina', 'entrada_wtg',
                        'salida_wtg', 'salida_parque', 'finalizar_parque')
      window w as (partition by jornada_id order by ts_dispositivo, id)
    ), runs_confirmados as (
      select * from secuencia_run
      where tipo = 'entrada_wtg' and siguiente_tipo = 'salida_wtg'
    )
  $sql$;
begin
  foreach vista in array array['visitas_aero', 'reporte_externo'] loop
    cuerpo := pg_get_viewdef(format('public.%I', vista)::regclass, true);
    -- Permite volver a ejecutar sin acumular capas sobre la misma vista.
    if position('runs_confirmados' in cuerpo) > 0 then
      raise notice '% ya tiene la regla RUN explícito', vista;
      continue;
    end if;
    cuerpo := regexp_replace(cuerpo, ';\s*$', '');

    if vista = 'visitas_aero' then
      condicion := $sql$
        not exists (
          select 1 from public.tecnicos t
          where t.id = r.tecnico_id and t.subtipo = 'inspector_externo'
        ) or exists (
          select 1 from runs_confirmados c
          where c.tecnico_id = r.tecnico_id and c.parque_id = r.parque_id
            and c.fecha = r.fecha and c.maquina_id = r.maquina_id
            and c.ts_dispositivo = r.ingreso
        )
      $sql$;
    else
      condicion := 'exists (select 1 from runs_confirmados c where c.id = r.evento_id)';
    end if;

    select string_agg(
      case
        when vista = 'visitas_aero' and a.attname = 'salida'
          then format('case when (%s) then r.salida else null end as salida', condicion)
        when vista = 'visitas_aero' and a.attname = 'inspeccionado'
          then format('(r.inspeccionado and (%s)) as inspeccionado', condicion)
        when vista = 'visitas_aero' and a.attname = 'cavidades'
          then format('case when (%s) then r.cavidades else array[]::text[] end as cavidades', condicion)
        when vista = 'reporte_externo' and a.attname in ('esfuerzo_final', 'inicio_aero')
          then format('case when r.wtg is null or (%s) then r.%I else null end as %I',
                      condicion, a.attname, a.attname)
        else format('r.%I', a.attname)
      end, ', ' order by a.attnum
    ) into columnas
    from pg_attribute a
    where a.attrelid = format('public.%I', vista)::regclass
      and a.attnum > 0 and not a.attisdropped;

    execute format('create or replace view public.%I as %s select %s from (%s) r',
                   vista, secuencia, columnas, cuerpo);
  end loop;
end;
$migration$;

commit;

-- Javier Sicoli, 09/09/2026, Rawson III, WTG 51:
-- RUN/esfuerzo_final e inicio_aero NULL; standby sigue en 7:52.
select fecha, wtg, parada_aero, esfuerzo_final, salida_de_parque, standby_hhmm
from public.reporte_externo
where evento_id = '68343d04-efb6-4f09-85b9-f4e01f4308c4';

-- salida NULL, inspeccionado false, cavidades vacías.
select fecha, numero, ingreso, salida, inspeccionado, cavidades
from public.visitas_aero
where tecnico_id = 'a4c8abef-7988-4228-b483-140feb9c8b4e'
  and parque_id = 'ar_rawson_iii' and fecha = '2026-09-09' and numero = 51;
