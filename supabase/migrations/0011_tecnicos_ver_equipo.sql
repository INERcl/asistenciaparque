-- =====================================================================
-- 0011 — Un técnico puede ver a sus compañeros de equipo.
-- Correr una vez en el SQL Editor de Supabase. Idempotente.
--
-- El resumen de la jornada interna muestra "Equipo: Nombre1 - Nombre2", así que
-- cada técnico necesita leer el `nombre` de los demás integrantes de SU equipo.
-- Hoy `tecnicos_select_own` sólo deja leer la fila propia.
--
-- Se agrega una política de SELECT acotada al mismo equipo. Para no recursar la
-- RLS (consultar `tecnicos` dentro de una política de `tecnicos`), el equipo del
-- llamador se resuelve con una función SECURITY DEFINER que salta la RLS.
-- =====================================================================

begin;

-- Equipo del técnico (bypassa RLS: SECURITY DEFINER). STABLE: mismo resultado
-- dentro de la query. search_path fijo por seguridad.
create or replace function public.equipo_de(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select equipo_id from public.tecnicos where id = uid
$$;

-- Compañeros de equipo: SELECT de las filas de técnicos con el mismo equipo_id
-- (no nulo) que el llamador. La política propia (tecnicos_select_own) sigue.
drop policy if exists tecnicos_select_equipo on public.tecnicos;
create policy tecnicos_select_equipo on public.tecnicos for select to authenticated
  using (equipo_id is not null and equipo_id = public.equipo_de(auth.uid()));

commit;

-- Verificación (opcional, logueado como un técnico con equipo):
--   select nombre from public.tecnicos where equipo_id = public.equipo_de(auth.uid());
