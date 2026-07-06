-- =====================================================================
-- 0008 — Policy de DELETE para asignaciones propias.
-- Correr una vez en el SQL Editor de Supabase. Idempotente.
--
-- Habilita "Cambiar de parque": si el técnico eligió el parque equivocado,
-- puede cancelar (borrar) su asignación activa y volver a elegir, SIN cerrar
-- sesión. La app solo borra cuando la asignación no tiene jornadas (chequea
-- antes); si las tuviera, el cascade limpiaría jornadas/eventos, por eso el
-- botón se ofrece únicamente antes de registrar actividad.
-- =====================================================================

drop policy if exists asignaciones_delete_own on public.asignaciones;
create policy asignaciones_delete_own on public.asignaciones for delete to authenticated
  using (tecnico_id = auth.uid());
