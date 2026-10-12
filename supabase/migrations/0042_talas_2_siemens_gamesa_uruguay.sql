-- =====================================================================
-- 0042 — Uruguay: empresa Siemens Gamesa Uruguay + PE Talas 2 (TM01..TM25)
-- y operador Pablo Silva. Correr una vez en el SQL Editor. Idempotente.
--
-- Aplicar DESPUÉS de crear la cuenta con scripts/crear-tecnicos.mjs
-- (usuario 'pablo.silva', externo, pais 'uruguay'): el paso 4 solo lo acota a
-- la empresa (mismo patrón que Franco en 0023 y Tomás en 0026).
--
-- Los aeros se llaman TM01..TM25 (no "WTG NN"): la app y el resumen muestran
-- `aeros.nombre`. `numero` es 1..25 (clave interna, orden y salida de
-- n8n/vistas); el nombre visible lleva el prefijo TM.
-- foto_evidencia = true: STOP/RUN con foto (requiere 0022). Uruguay ya la usa por
-- país (usaFotoEvidencia); el flag lo deja explícito como en Siemens AR.
-- Uruguay ya es solo externo, sin almuerzo ni equipos (0004).
-- =====================================================================
begin;

-- 1) Empresa (patrón <fabricante>_<pais>).
insert into public.empresas (id, nombre, pais) values
  ('siemens_gamesa_uruguay', 'Siemens Gamesa Uruguay', 'uruguay')
on conflict (id) do update set nombre = excluded.nombre, pais = excluded.pais;

-- 2) Parque.
insert into public.parques (id, nombre, pais, empresa_id, turbinas, activo, orden, foto_evidencia) values
  ('uy_talas_2', 'PE Talas 2', 'uruguay', 'siemens_gamesa_uruguay', 25, true, 1, true)
on conflict (id) do update set
  nombre = excluded.nombre, pais = excluded.pais, empresa_id = excluded.empresa_id,
  turbinas = excluded.turbinas, activo = excluded.activo, orden = excluded.orden,
  foto_evidencia = excluded.foto_evidencia;

-- 3) Aeros TM01..TM25 (id '{parque}_{numero}').
delete from public.aeros where parque_id = 'uy_talas_2';
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'uy_talas_2_' || n, 'uy_talas_2', n, 'TM' || lpad(n::text, 2, '0'), n
from generate_series(1, 25) as n;

-- 4) Operador: Pablo Silva acotado a Siemens Gamesa Uruguay.
update public.tecnicos set empresa_id = 'siemens_gamesa_uruguay'
where usuario = 'pablo.silva';

commit;

-- Verificación (correr aparte):
--   select id, nombre, empresa_id, turbinas from public.parques where pais = 'uruguay';
--   select count(*), min(nombre), max(nombre) from public.aeros where parque_id = 'uy_talas_2';
--     -- esperado: 25, TM01, TM25
--   select usuario, pais, subtipo, empresa_id from public.tecnicos where usuario = 'pablo.silva';
