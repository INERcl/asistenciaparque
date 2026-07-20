// Acumulado offline de CAVIDADES inspeccionadas por turbina, por asignación.
// Interno: 3 palas × 2 lados (TEC/LEC) = 6 cavidades por aero; una turbina está
// completa con las 6. Externo: cada salida acredita la turbina entera (las 6).
// Sirve para el tinte de la grilla (gris/ámbar/verde), la precarga del modal de
// salida y el resumen de fin de día.
//
// Se alimenta al registrar cada salida (registrarEvento) y se siembra desde
// Supabase en el onboarding / al entrar al parque (verde compartido del equipo).
// Vive en el store `sesion` bajo `inspeccionados:{asignacion_id}` y sobrevive al
// logout (igual que la outbox); se limpia al finalizar el parque.

import { CAVIDADES, EVENTO_TIPO } from "@/lib/catalogos";
import { cacheGet, cacheSet } from "./db";

const keyInspeccionados = (asignacionId: string) => `inspeccionados:${asignacionId}`;

/** Mapa maquina_id (`aeros.id`) → cavidades inspeccionadas en la asignación. */
export type CavidadesPorAero = Record<string, string[]>;

export async function leerInspeccionados(
  asignacionId: string,
): Promise<CavidadesPorAero> {
  return (
    (await cacheGet<CavidadesPorAero>("sesion", keyInspeccionados(asignacionId))) ?? {}
  );
}

/** Suma cavidades a una turbina (unión idempotente). `cavidades` undefined/null =
 *  turbina entera (externo o salida legada); `[]` = nada acreditado esta visita. */
export async function agregarInspeccionado(
  asignacionId: string,
  maquinaId: string,
  cavidades?: readonly string[] | null,
): Promise<void> {
  const nuevas = cavidades == null ? CAVIDADES : cavidades;
  if (nuevas.length === 0) return;
  const mapa = await leerInspeccionados(asignacionId);
  const previas = mapa[maquinaId] ?? [];
  const union = [...new Set([...previas, ...nuevas])];
  if (union.length === previas.length) return; // nada nuevo
  await cacheSet("sesion", keyInspeccionados(asignacionId), {
    ...mapa,
    [maquinaId]: union,
  });
}

/** Une lo del server con lo local (no pisa lo registrado offline sin sync). */
export async function sembrarInspeccionados(
  asignacionId: string,
  mapa: CavidadesPorAero,
): Promise<void> {
  const actual = await leerInspeccionados(asignacionId);
  const merged: CavidadesPorAero = { ...actual };
  for (const [maq, cavs] of Object.entries(mapa)) {
    merged[maq] = [...new Set([...(merged[maq] ?? []), ...cavs])];
  }
  await cacheSet("sesion", keyInspeccionados(asignacionId), merged);
}

export async function limpiarInspeccionados(asignacionId: string): Promise<void> {
  await cacheSet("sesion", keyInspeccionados(asignacionId), null);
}

// ---------- Aero abierto (subida/STOP sin salida) ----------
// `jornada_eventos` solo guarda tipos; acá se persiste QUÉ aero quedó abierto
// para poder acreditarlo al salir (o al cierre del día con el aero abierto).

interface AeroActual {
  jornadaId: string;
  maquinaId: string;
}

export async function guardarAeroActual(
  jornadaId: string,
  maquinaId: string | null,
): Promise<void> {
  await cacheSet(
    "sesion",
    "aero_actual",
    maquinaId ? ({ jornadaId, maquinaId } satisfies AeroActual) : null,
  );
}

/** Aero abierto (subida/STOP) en esa jornada (null si no hay o es de otra jornada). */
export async function leerAeroActual(jornadaId: string): Promise<string | null> {
  const a = await cacheGet<AeroActual | null>("sesion", "aero_actual");
  return a && a.jornadaId === jornadaId ? a.maquinaId : null;
}

// ---------- Siembra desde el server ----------

export interface EventoParaSiembra {
  tipo: string;
  maquina_id: string | null;
  palas?: string[] | null; // cavidades cerradas en la salida (null = turbina entera)
  jornada_id: string;
  ts_dispositivo: string;
}

/** Mapa maquina_id → cavidades inspeccionadas según la secuencia de eventos de la
 *  asignación (mismo criterio de cadena que `visitas_aero`): dentro de cada jornada,
 *  un entrada_wtg cuenta si el siguiente evento de la cadena lo cierra. Las cavidades
 *  salen del `palas` de esa salida (null/cierre por parque = turbina entera). */
export function inspeccionadosDesdeEventos(
  eventos: EventoParaSiembra[],
): CavidadesPorAero {
  const cadena = eventos
    .filter((e) =>
      [
        EVENTO_TIPO.ENTRADA_WTG,
        EVENTO_TIPO.SALIDA_WTG,
        EVENTO_TIPO.SALIDA_PARQUE,
        EVENTO_TIPO.FINALIZAR_PARQUE,
      ].includes(e.tipo as never),
    )
    .sort((a, b) =>
      a.jornada_id === b.jornada_id
        ? a.ts_dispositivo.localeCompare(b.ts_dispositivo)
        : a.jornada_id.localeCompare(b.jornada_id),
    );

  const mapa: CavidadesPorAero = {};
  for (let i = 0; i < cadena.length; i++) {
    const e = cadena[i];
    if (e.tipo !== EVENTO_TIPO.ENTRADA_WTG || !e.maquina_id) continue;
    const sig = cadena[i + 1];
    if (!sig || sig.jornada_id !== e.jornada_id || sig.tipo === EVENTO_TIPO.ENTRADA_WTG) {
      continue;
    }
    // Cavidades acreditadas en esta visita:
    //   salida_wtg → su `palas` (null = legado/entera; [] = nada);
    //   cierre por salida/finalizar con el aero abierto → turbina entera.
    const cavs =
      sig.tipo === EVENTO_TIPO.SALIDA_WTG
        ? (sig.palas ?? CAVIDADES)
        : CAVIDADES;
    if (cavs.length === 0) continue;
    mapa[e.maquina_id] = [...new Set([...(mapa[e.maquina_id] ?? []), ...cavs])];
  }
  return mapa;
}
