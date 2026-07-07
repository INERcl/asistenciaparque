-- =====================================================================
-- 0012 — Un técnico puede LEER las jornadas y eventos de su equipo.
-- Correr una vez en el SQL Editor (DESPUÉS de 0011, que define equipo_de).
-- Idempotente.
--
-- Objetivo: jornadas compartidas a nivel equipo. Si un solo operador registra
-- los eventos, su compañero (mismo equipo) ve esas jornadas y el mismo avance
-- en la vista Jornadas, sin haber registrado nada. Solo LECTURA: el insert/
-- update sigue acotado al dueño (jornadas_insert_own / eventos_insert_own).
--
-- Solo aplica a técnicos con equipo (AR interna). Externos (equipo_id null) no
-- se ven afectados: equipo_de(...) es null y la condición no matchea.
-- =====================================================================

begin;

-- Jornadas del mismo equipo (además de la propia, que ya cubre jornadas_select).
drop policy if exists jornadas_select_equipo on public.jornadas;
create policy jornadas_select_equipo on public.jornadas for select to authenticated
  using (
    public.equipo_de(auth.uid()) is not null
    and public.equipo_de(tecnico_id) = public.equipo_de(auth.uid())
  );

-- Eventos de jornadas del mismo equipo (para expandir el resumen del compañero).
drop policy if exists eventos_select_equipo on public.eventos;
create policy eventos_select_equipo on public.eventos for select to authenticated
  using (
    public.equipo_de(auth.uid()) is not null
    and exists (
      select 1 from public.jornadas j
      where j.id = jornada_id
        and public.equipo_de(j.tecnico_id) = public.equipo_de(auth.uid())
    )
  );

commit;

-- Verificación (dentro de la app, logueado como el compañero que NO registró):
-- la vista Jornadas debe listar las jornadas del operador del equipo.
