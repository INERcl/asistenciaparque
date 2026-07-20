-- =====================================================================
-- 0020 — Inspección interna por palas: columna `eventos.palas`
-- Correr una vez en el SQL Editor. Idempotente.
--
-- El operador interno inspecciona 3 palas (A, B, C), cada una con 2 lados/
-- cavidades: TEC y LEC → 6 cavidades por aerogenerador. En la SALIDA de máquina
-- (`salida_wtg`) se registran las cavidades cerradas EN ESA VISITA, como un array
-- JSON de strings tipo ["A-TEC","A-LEC","B-TEC", ...]. Append-only y acumulable:
-- una turbina está COMPLETA cuando la unión de todas sus salidas cubre las 6.
--
-- Retrocompatible: `palas = null` (salidas viejas / externo) = turbina entera;
-- `palas = []` = nada acreditado en esa visita. La `maquina_id` del salida_wtg del
-- interno ahora viaja (antes iba nula), para juntar entrada→salida sin lead().
-- =====================================================================
alter table public.eventos
  add column if not exists palas jsonb;

comment on column public.eventos.palas is
  'Cavidades cerradas en esta salida_wtg (interno): array JSON ["A-TEC","B-LEC",…]. '
  'null = turbina entera (externo/legado); [] = nada. Ver 0021_vistas_palas.sql.';
