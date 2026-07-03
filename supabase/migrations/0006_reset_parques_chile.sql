-- =====================================================================
-- 0006 — Reset de parques de Chile: reemplaza la lista completa y la
-- reingresa en orden. Correr una vez en el SQL Editor de Supabase.
--
-- Scope: SOLO Chile (Argentina intacta). Reemplaza los parques chilenos
-- de prueba por la lista definitiva (8 parques, en orden). Los IDs se
-- mantienen descriptivos y estables (estilo `cl_...`).
--
-- Orden de borrado (por las FK sin cascade a parques):
--   · asignaciones.parque_id / jornadas.parque_id NO cascadean a parques,
--     así que hay que borrarlas antes que el parque.
--   · Borrar una asignación cascadea a sus jornadas y estas a sus eventos.
--   · Borrar el parque cascadea a sus aeros.
-- Como solo hay datos de prueba en Chile, el borrado es seguro.
--
-- empresa_id queda en NULL (operador sin asignar). Si se define el operador
-- de cada parque, se completa después (las 6 empresas del seed siguen ahí).
-- =====================================================================

begin;

-- 1) Datos de prueba dependientes de parques chilenos (asignaciones →
--    cascadea jornadas → cascadea eventos). Las jornadas sueltas se borran
--    aparte por defensa (parque_id no cascadea).
delete from public.asignaciones a
using public.parques p
where a.parque_id = p.id and p.pais = 'chile';

delete from public.jornadas j
using public.parques p
where j.parque_id = p.id and p.pais = 'chile';

-- 2) Parques chilenos (sus aeros caen por ON DELETE CASCADE).
delete from public.parques where pais = 'chile';

-- 3) Lista nueva, en orden (orden = 1..8).
insert into public.parques (id, nombre, pais, empresa_id, turbinas, activo, orden) values
  ('cl_el_arrayan',        'El Arrayan',          'chile', null, 50, true, 1),
  ('cl_cabo_leones_1_ext', 'Cabo Leones I Ext',   'chile', null, 12, true, 2),
  ('cl_cabo_leones_3_ext', 'Cabo Leones III Ext', 'chile', null, 22, true, 3),
  ('cl_cabo_leones_2',     'Cabo Leones II',      'chile', null, 49, true, 4),
  ('cl_tchamma',           'Tchamma',             'chile', null, 35, true, 5),
  ('cl_la_estrella',       'La Estrella',         'chile', null, 11, true, 6),
  ('cl_calama',            'Calama',              'chile', null, 22, true, 7),
  ('cl_llanos_del_viento', 'Llanos Del Viento',   'chile', null, 32, true, 8);

-- 4) Aeros 1..turbinas por parque (id '{parque}_{n}', nombre 'WTG NN').
insert into public.aeros (id, parque_id, numero, nombre)
select p.id || '_' || g, p.id, g, 'WTG ' || lpad(g::text, 2, '0')
from public.parques p
cross join lateral generate_series(1, coalesce(p.turbinas, 0)) as g
where p.pais = 'chile'
on conflict (id) do nothing;

commit;

-- Verificación rápida (opcional):
--   select orden, id, nombre, turbinas,
--          (select count(*) from public.aeros a where a.parque_id = p.id) as aeros
--   from public.parques p where pais = 'chile' order by orden;
