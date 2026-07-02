-- =====================================================================
-- INER Check-in — Seed
-- Países (+TZ) · empresas (6, Chile) · parques (23: 7 CL + 16 AR) ·
-- aeros generados desde parques.turbinas. Equipos AR interna (X-C, F-K).
-- Idempotente (on conflict do update). PE/UY sin parques aún (intencional).
-- =====================================================================

-- Países + zona horaria (TZ_POR_PAIS) + config data-driven (ver 0004).
-- Argentina: interno + externo, con almuerzo y equipos. Resto: solo externo.
insert into public.paises
  (id, nombre, tz, permite_interno, permite_externo, usa_almuerzo, usa_equipos) values
  ('argentina', 'Argentina', 'America/Argentina/Buenos_Aires', true,  true, true,  true),
  ('chile',     'Chile',     'America/Santiago',                false, true, false, false),
  ('peru',      'Perú',      'America/Lima',                    false, true, false, false),
  ('uruguay',   'Uruguay',   'America/Montevideo',              false, true, false, false)
on conflict (id) do update set
  nombre = excluded.nombre, tz = excluded.tz,
  permite_interno = excluded.permite_interno, permite_externo = excluded.permite_externo,
  usa_almuerzo = excluded.usa_almuerzo, usa_equipos = excluded.usa_equipos;

-- Empresas (operadores) — solo Chile.
insert into public.empresas (id, nombre, pais) values
  ('enel_green_power',     'ENEL Green Power Chile', 'chile'),
  ('engie_chile',          'Engie Chile',            'chile'),
  ('ibereolica_chile',     'Ibereólica Chile',       'chile'),
  ('innergex_chile',       'Innergex Chile',         'chile'),
  ('nordex_chile',         'Nordex Chile',           'chile'),
  ('siemens_gamesa_chile', 'Siemens Gamesa Chile',   'chile')
on conflict (id) do update set nombre = excluded.nombre, pais = excluded.pais;

-- Parques. Chile (7) con empresa_id; Argentina (15) sin empresa.
insert into public.parques (id, nombre, pais, empresa_id, turbinas, activo, orden) values
  -- Chile
  ('cl_los_buenos_aires', 'PE Los Buenos Aires',       'chile', 'enel_green_power',     12, true, 1),
  ('cl_monte_redondo',    'PE Monte Redondo',          'chile', 'engie_chile',          24, true, 2),
  ('cl_atacama',          'PE Atacama',                'chile', 'ibereolica_chile',     29, true, 3),
  ('cl_cuel',             'CUEL',                      'chile', 'innergex_chile',       22, true, 4),
  ('cl_sarco',            'SARCO',                     'chile', 'innergex_chile',       50, true, 5),
  ('cl_puelche_sur',      'Parque Eólico Puelche Sur', 'chile', 'nordex_chile',         32, true, 6),
  ('cl_el_arrayan',       'PE EL Arrayan',             'chile', 'siemens_gamesa_chile', 51, true, 7),
  -- Argentina
  ('ar_buenaventura',     'PE Buenaventura',           'argentina', null, 48, true, 1),
  ('ar_de_la_bahia',      'PE DE LA BAHIA',            'argentina', null, 18, true, 2),
  ('ar_general_levalle',  'PE GENERAL LEVALLE',        'argentina', null, 25, true, 3),
  ('ar_genoveva_1',       'PE Genoveva1',              'argentina', null, 21, true, 4),
  ('ar_genoveva_2',       'PE Genoveva2',              'argentina', null, 11, true, 5),
  ('ar_la_castellana',    'PE La Castellana',          'argentina', null,  4, true, 6),
  ('ar_la_elbita',        'PE LA ELBITA',              'argentina', null, 36, true, 7),
  ('ar_la_rinconada',     'PE La Rinconada',           'argentina', null, 21, true, 8),
  ('ar_llano_iv',         'PE LLANO IV',               'argentina', null, 18, true, 9),
  ('ar_los_olivos',       'PE Los Olivos',             'argentina', null,  6, true, 10),
  ('ar_manque',           'PE MANQUE',                 'argentina', null, 15, true, 11),
  ('ar_olavarria',        'PE OLAVARRIA',              'argentina', null, 22, true, 12),
  ('ar_pepe_vi',          'PE PEPE VI',                'argentina', null, 31, true, 13),
  ('ar_san_luis',         'PE San Luis',               'argentina', null, 50, true, 14),
  ('ar_vivorata',         'PE VIVORATA',               'argentina', null, 11, true, 15),
  ('ar_punta_lomitas',    'PE Punta Lomitas',          'argentina', null, 57, true, 16)
on conflict (id) do update set
  nombre = excluded.nombre, pais = excluded.pais,
  empresa_id = excluded.empresa_id, turbinas = excluded.turbinas,
  activo = excluded.activo, orden = excluded.orden;

-- Aeros: se generan 1..turbinas por parque (id '{parque}_{n}', nombre 'WTG NN').
-- Reemplazar luego por el inventario real si los aeros tienen nombres propios.
-- Punta Lomitas se excluye acá: su numeración es salteada (ver insert explícito abajo).
-- Solo se generan para parques SIN aeros aún: así el seed no pelea con inventario
-- ya cargado (evita chocar la unique (parque_id, numero) contra aeros de prueba
-- creados con otro id). Para recargar un parque, borrá antes sus aeros.
insert into public.aeros (id, parque_id, numero, nombre)
select p.id || '_' || g, p.id, g, 'WTG ' || lpad(g::text, 2, '0')
from public.parques p
cross join lateral generate_series(1, coalesce(p.turbinas, 0)) as g
where p.id <> 'ar_punta_lomitas'
  and not exists (select 1 from public.aeros a where a.parque_id = p.id)
on conflict (id) do nothing;

-- Punta Lomitas: 57 aeros reales, numeración NO contigua (faltan 5,7,10,48,49;
-- llega hasta 62). Números extraídos del Excel PLOM (hoja "Parque 1", columna WTG).
insert into public.aeros (id, parque_id, numero, nombre)
select 'ar_punta_lomitas_' || n, 'ar_punta_lomitas', n, 'WTG ' || lpad(n::text, 2, '0')
from unnest(array[
  1,2,3,4,6,8,9,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,
  31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,50,51,52,53,54,55,56,57,
  58,59,60,61,62
]) as n
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero, nombre = excluded.nombre;

-- Equipos de inspección interna (Argentina).
insert into public.equipos (id, nombre, pais) values
  ('ar_x_c',     'Equipo X-C',  'argentina'),
  ('ar_f_k',     'Equipo F-K',  'argentina')
on conflict (id) do update set nombre = excluded.nombre, pais = excluded.pais;
