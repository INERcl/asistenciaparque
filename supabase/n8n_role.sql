-- =====================================================================
-- Rol de solo lectura para n8n (downstream). Solo ve las VISTAS de reporte,
-- nunca las tablas base. Correr en el SQL Editor de Supabase (una vez).
-- Reemplazar <PONER-SECRETO> por una contraseña fuerte y guardarla en n8n.
-- =====================================================================

create role n8n_reader login password '<PONER-SECRETO>'
  nosuperuser nocreatedb nocreaterole nobypassrls;

grant usage on schema public to n8n_reader;

-- Las vistas reporte_* corren con privilegios del owner (no security_invoker) y
-- tienen revoke a anon/authenticated, así que este rol las lee sin tocar las
-- tablas base ni la RLS de la app.
grant select on
  public.reporte_planilla,       -- interno: fila por grupo/parque/día
  public.reporte_resumen,        -- interno: tablero
  public.reporte_externo,        -- externo (PLOM): fila por aero visitado
  public.reporte_externo_resumen, -- externo (PLOM): RESUMEN
  public.resumen_asistencia      -- externo: Consolidado (una fila por parque) — 0002
  to n8n_reader;

-- Nota: el grant de resumen_asistencia lo aplica también la migración
-- supabase/migrations/0002_asistencia_externa.sql (esta línea deja constancia).

-- Conexión desde n8n (credencial Postgres):
--   host = <pooler de Supabase>   port = 5432 (modo sesión)   db = postgres
--   user = n8n_reader             password = <PONER-SECRETO>
-- (Settings → Database → Connection string → "Session" pooler, cambiando el usuario.)
