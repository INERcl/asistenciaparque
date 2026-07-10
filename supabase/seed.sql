-- =====================================================================
-- INER Check-in — Seed
-- Países (+TZ) · empresas (6, Chile) · parques (8 CL + 37 AR + 1 PE) ·
-- aeros generados desde parques.turbinas (+ `orden`). Equipos AR interna (X-C, F-K).
-- Idempotente (on conflict do update). UY sin parques aún (intencional).
-- Chile: lista reingresada en orden (ver 0006); empresa_id sin asignar (null).
-- Punta Lomitas: parque de Perú (ver 0009); id `ar_punta_lomitas` conservado.
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

-- Parques. Chile (8) en orden, empresa_id sin asignar (null); Argentina (16) sin empresa.
insert into public.parques (id, nombre, pais, empresa_id, turbinas, activo, orden) values
  -- Chile
  ('cl_el_arrayan',        'El Arrayan',          'chile', null, 50, true, 1),
  ('cl_cabo_leones_1_ext', 'Cabo Leones I Ext',   'chile', null, 12, true, 2),
  ('cl_cabo_leones_3_ext', 'Cabo Leones III Ext', 'chile', null, 22, true, 3),
  ('cl_cabo_leones_2',     'Cabo Leones II',      'chile', null, 49, true, 4),
  ('cl_tchamma',           'Tchamma',             'chile', null, 35, true, 5),
  ('cl_la_estrella',       'La Estrella',         'chile', null, 11, true, 6),
  ('cl_calama',            'Calama',              'chile', null, 22, true, 7),
  ('cl_llanos_del_viento', 'Llanos Del Viento',   'chile', null, 32, true, 8),
  -- Argentina
  ('ar_buenaventura',     'PE Buenaventura',           'argentina', null, 24, true, 1),
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
  ('ar_san_luis',         'PE San Luis',               'argentina', null, 25, true, 14),
  ('ar_vivorata',         'PE VIVORATA',               'argentina', null, 11, true, 15),
  ('ar_punta_lomitas',    'PE Punta Lomitas',          'peru',      null, 57, true, 16),
  -- Argentina (parques faltantes del inventario real, ver 0013)
  ('ar_villalonga', 'PE Villalonga', 'argentina', null, 15, true, 16),
  ('ar_villalonga_ii', 'PE Villalonga II', 'argentina', null, 1, true, 17),
  ('ar_san_jorge', 'PE San Jorge', 'argentina', null, 24, true, 18),
  ('ar_rawson_i_ii', 'PE Rawson I y II', 'argentina', null, 43, true, 19),
  ('ar_rawson_iii', 'PE Rawson III', 'argentina', null, 12, true, 20),
  ('ar_pampa_energia', 'PE Pampa Energía', 'argentina', null, 14, true, 21),
  ('ar_puerto_madryn_i', 'PE Puerto Madryn I', 'argentina', null, 20, true, 22),
  ('ar_puerto_madryn_ii', 'PE Puerto Madryn II', 'argentina', null, 42, true, 23),
  ('ar_necochea', 'PE Necochea', 'argentina', null, 11, true, 24),
  ('ar_manantiales', 'PE Manantiales', 'argentina', null, 15, true, 25),
  ('ar_manantiales_ii', 'PE Manantiales II', 'argentina', null, 15, true, 26),
  ('ar_mataco_iii', 'PE Mataco III', 'argentina', null, 8, true, 27),
  ('ar_llano_i', 'PE Llano I', 'argentina', null, 14, true, 28),
  ('ar_llano_ii', 'PE Llano II', 'argentina', null, 17, true, 29),
  ('ar_llano_iii', 'PE Llano III', 'argentina', null, 14, true, 30),
  ('ar_la_banderita', 'PE La Banderita', 'argentina', null, 11, true, 31),
  ('ar_garayalde', 'PE Garayalde', 'argentina', null, 7, true, 32),
  ('ar_corti', 'PE Corti', 'argentina', null, 29, true, 33),
  ('ar_el_mataco', 'PE El Mataco', 'argentina', null, 27, true, 34),
  ('ar_chubut_norte', 'PE Chubut Norte', 'argentina', null, 8, true, 35),
  ('ar_bicentenario', 'PE Bicentenario', 'argentina', null, 28, true, 36),
  ('ar_bicentenario_ii', 'PE Bicentenario II', 'argentina', null, 7, true, 37)
-- permite_interno/permite_externo quedan en su default (solo externo) y NO se
-- listan en el do update: el reparto por flujo lo fija 0015_parques_por_subtipo.sql
-- y un re-seed no debe pisarlo.
on conflict (id) do update set
  nombre = excluded.nombre, pais = excluded.pais,
  empresa_id = excluded.empresa_id, turbinas = excluded.turbinas,
  activo = excluded.activo, orden = excluded.orden;

-- Punta Lomitas (Perú): 57 aeros reales, numeración NO contigua (faltan 5,7,10,
-- 48,49; llega hasta 62). Números extraídos del Excel PLOM (hoja "Parque 1",
-- columna WTG). `orden` = posición en la lista (with ordinality).
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_punta_lomitas_' || n, 'ar_punta_lomitas', n, 'WTG ' || lpad(n::text, 2, '0'), ord
from unnest(array[
  1,2,3,4,6,8,9,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,
  31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,50,51,52,53,54,55,56,57,
  58,59,60,61,62
]) with ordinality as t(n, ord)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;

-- Chile — inventario real (numero + orden del template, etiqueta propia por
-- parque). Ver 0010. Los demás parques de Chile siguen con 1..N hasta su template.
-- Cabo Leones II: AE01..AE49 (contiguos).
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'cl_cabo_leones_2_' || numero, 'cl_cabo_leones_2', numero,
       'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[
  1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,
  26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49
]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;

-- Cabo Leones III Ext: AE-12..AE-23 + AE-35..AE-44.
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'cl_cabo_leones_3_ext_' || numero, 'cl_cabo_leones_3_ext', numero,
       'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[
  12,13,14,15,16,17,18,19,20,21,22,23,35,36,37,38,39,40,41,42,43,44
]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;

-- Cabo Leones I Ext: WTG-52..WTG-58 + WTG-64..WTG-68.
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'cl_cabo_leones_1_ext_' || numero, 'cl_cabo_leones_1_ext', numero,
       'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[
  52,53,54,55,56,57,58,64,65,66,67,68
]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;

-- Argentina — inventario real (numero + orden del template; ver 0013).
-- PE MANQUE
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_manque_' || numero, 'ar_manque', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[16,17,19,20,21,22,23,24,25,26,27,28,30,31,32]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Los Olivos
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_los_olivos_' || numero, 'ar_los_olivos', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[18,29,33,34,35,36]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Buenaventura
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_buenaventura_' || numero, 'ar_buenaventura', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Genoveva1
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_genoveva_1_' || numero, 'ar_genoveva_1', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Genoveva2
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_genoveva_2_' || numero, 'ar_genoveva_2', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE La Castellana
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_la_castellana_' || numero, 'ar_la_castellana', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE San Luis
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_san_luis_' || numero, 'ar_san_luis', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE La Rinconada
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_la_rinconada_' || numero, 'ar_la_rinconada', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE VIVORATA
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_vivorata_' || numero, 'ar_vivorata', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE OLAVARRIA
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_olavarria_' || numero, 'ar_olavarria', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE PEPE VI
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_pepe_vi_' || numero, 'ar_pepe_vi', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE DE LA BAHIA
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_de_la_bahia_' || numero, 'ar_de_la_bahia', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE GENERAL LEVALLE
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_general_levalle_' || numero, 'ar_general_levalle', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE LA ELBITA
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_la_elbita_' || numero, 'ar_la_elbita', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE LLANO IV
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_llano_iv_' || numero, 'ar_llano_iv', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[44,45,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Villalonga
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_villalonga_' || numero, 'ar_villalonga', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Villalonga II
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_villalonga_ii_' || numero, 'ar_villalonga_ii', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[16]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE San Jorge
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_san_jorge_' || numero, 'ar_san_jorge', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Rawson I y II
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_rawson_i_ii_' || numero, 'ar_rawson_i_ii', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Rawson III
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_rawson_iii_' || numero, 'ar_rawson_iii', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[44,45,46,47,48,49,50,51,52,53,54,55]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Pampa Energía
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_pampa_energia_' || numero, 'ar_pampa_energia', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Puerto Madryn I
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_puerto_madryn_i_' || numero, 'ar_puerto_madryn_i', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,9,10,11,12,16,17,18,19,22,23,24,25,28,29]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Puerto Madryn II
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_puerto_madryn_ii_' || numero, 'ar_puerto_madryn_ii', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Necochea
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_necochea_' || numero, 'ar_necochea', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Manantiales
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_manantiales_' || numero, 'ar_manantiales', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Manantiales II
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_manantiales_ii_' || numero, 'ar_manantiales_ii', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Mataco III
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_mataco_iii_' || numero, 'ar_mataco_iii', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[28,29,30,31,32,33,34,35]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Llano I
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_llano_i_' || numero, 'ar_llano_i', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Llano II
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_llano_ii_' || numero, 'ar_llano_ii', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Llano III
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_llano_iii_' || numero, 'ar_llano_iii', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[34,35,36,37,38,39,40,41,42,43,46,47,48,49]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE La Banderita
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_la_banderita_' || numero, 'ar_la_banderita', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Garayalde
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_garayalde_' || numero, 'ar_garayalde', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Corti
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_corti_' || numero, 'ar_corti', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE El Mataco
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_el_mataco_' || numero, 'ar_el_mataco', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Chubut Norte
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_chubut_norte_' || numero, 'ar_chubut_norte', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Bicentenario
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_bicentenario_' || numero, 'ar_bicentenario', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;
-- PE Bicentenario II
insert into public.aeros (id, parque_id, numero, nombre, orden)
select 'ar_bicentenario_ii_' || numero, 'ar_bicentenario_ii', numero, 'WTG ' || lpad(numero::text, 2, '0'), orden
from unnest(array[29,30,31,32,33,34,35]::int[]) with ordinality as t(numero, orden)
on conflict (id) do update set
  parque_id = excluded.parque_id, numero = excluded.numero,
  nombre = excluded.nombre, orden = excluded.orden;

-- Parques sin template todavía (Chile: El Arrayan, Tchamma, La Estrella, Calama,
-- Llanos del Viento): aeros 1..turbinas. Corre al final, así el `not exists` saltea
-- los parques que ya tienen inventario explícito arriba.
insert into public.aeros (id, parque_id, numero, nombre, orden)
select p.id || '_' || g, p.id, g, 'WTG ' || lpad(g::text, 2, '0'), g
from public.parques p
cross join lateral generate_series(1, coalesce(p.turbinas, 0)) as g
where not exists (select 1 from public.aeros a where a.parque_id = p.id)
on conflict (id) do nothing;

-- Equipos de inspección interna (Argentina).
insert into public.equipos (id, nombre, pais) values
  ('ar_x_c',     'Equipo X-C',  'argentina'),
  ('ar_f_k',     'Equipo F-K',  'argentina')
on conflict (id) do update set nombre = excluded.nombre, pais = excluded.pais;
