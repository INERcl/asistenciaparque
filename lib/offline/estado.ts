// Máquina de estados del check-in: deriva qué botones se pueden apretar a partir
// de los eventos ya registrados en la jornada del día. Persistente (IndexedDB) y
// offline, para que sobreviva recargas y no dependa de la cola ya sincronizada.

import {
  EVENTO_TIPO,
  type EventoTipo,
  PAIS_CONFIG_DEFAULT,
  type PaisConfig,
  SUBTIPO,
  type Subtipo,
} from "@/lib/catalogos";
import { cacheGet, cacheSet } from "./db";

export interface EstadoJornada {
  enParque: boolean; // ya se registró entrada_parque
  trasladoHecho: boolean; // ya se registró un traslado_maquina (interno: 1×/día)
  enTraslado: boolean; // se apretó Traslado y falta la entrada a turbina (solo interno; el externo ya no registra traslados)
  enTurbina: boolean; // hay un entrada_wtg sin su salida_wtg
  almuerzoHecho: boolean; // ya se registró el almuerzo
  enStandby: boolean; // hay un inicio_standby sin su fin_standby (período abierto)
  diaCerrado: boolean; // salida_parque o finalizar_parque
  parqueCerrado: boolean; // finalizar_parque
}

export const ESTADO_INICIAL: EstadoJornada = {
  enParque: false,
  trasladoHecho: false,
  enTraslado: false,
  enTurbina: false,
  almuerzoHecho: false,
  enStandby: false,
  diaCerrado: false,
  parqueCerrado: false,
};

/** Reconstruye el estado plegando la secuencia de tipos de evento del día. */
export function estadoDesdeEventos(tipos: EventoTipo[]): EstadoJornada {
  const e: EstadoJornada = { ...ESTADO_INICIAL };
  for (const t of tipos) {
    switch (t) {
      case EVENTO_TIPO.ENTRADA_PARQUE:
        e.enParque = true;
        break;
      case EVENTO_TIPO.TRASLADO_MAQUINA:
        e.trasladoHecho = true;
        e.enTraslado = true; // externo: quedó en traslado hasta la Parada de aero
        break;
      case EVENTO_TIPO.ENTRADA_WTG:
        e.enTurbina = true;
        e.enTraslado = false;
        break;
      case EVENTO_TIPO.SALIDA_WTG:
        e.enTurbina = false;
        e.enTraslado = false;
        break;
      case EVENTO_TIPO.INICIO_ALMUERZO:
        e.almuerzoHecho = true;
        break;
      case EVENTO_TIPO.INICIO_STANDBY:
        e.enStandby = true;
        break;
      case EVENTO_TIPO.FIN_STANDBY:
        e.enStandby = false;
        break;
      case EVENTO_TIPO.SALIDA_PARQUE:
        e.enStandby = false; // la salida cierra un stand-by abierto (cuenta hasta la salida)
        e.diaCerrado = true;
        break;
      case EVENTO_TIPO.FINALIZAR_PARQUE:
        e.enStandby = false;
        e.diaCerrado = true;
        e.parqueCerrado = true;
        break;
    }
  }
  return e;
}

/** ¿Se puede apretar este botón dado el estado actual, el subtipo del técnico y
 *  la config del país (limita el almuerzo a los países que lo usan)? */
export function botonHabilitado(
  tipo: EventoTipo,
  e: EstadoJornada,
  subtipo: Subtipo | null,
  paisConfig: PaisConfig = PAIS_CONFIG_DEFAULT,
): boolean {
  const externo = subtipo === SUBTIPO.INSPECTOR_EXTERNO;
  // En stand-by abierto solo se puede terminarlo o salir del parque (período limpio).
  if (
    e.enStandby &&
    tipo !== EVENTO_TIPO.FIN_STANDBY &&
    tipo !== EVENTO_TIPO.SALIDA_PARQUE &&
    tipo !== EVENTO_TIPO.FINALIZAR_PARQUE
  ) {
    return false;
  }
  switch (tipo) {
    case EVENTO_TIPO.ENTRADA_PARQUE:
      return !e.diaCerrado && !e.enParque; // una vez por día (abre la jornada)
    case EVENTO_TIPO.TRASLADO_MAQUINA:
      return externo
        ? false // el externo no registra traslado: se deriva del RUN→STOP en la planilla
        : !e.diaCerrado && e.enParque && !e.enTurbina && !e.enTraslado; // 1× por turbina
    case EVENTO_TIPO.ENTRADA_WTG:
      if (e.diaCerrado || !e.enParque || e.enTurbina) return false; // no entrar si ya estás dentro
      return externo ? true : e.enTraslado; // interno: sube solo después de trasladar
    case EVENTO_TIPO.SALIDA_WTG:
      return !e.diaCerrado && e.enTurbina; // solo si estás dentro
    case EVENTO_TIPO.INICIO_ALMUERZO:
      return externo || !paisConfig.usa_almuerzo
        ? false // el externo no registra almuerzo; ni los países que no lo usan
        : !e.diaCerrado && e.enParque && !e.almuerzoHecho && !e.enTurbina; // una vez
    case EVENTO_TIPO.INICIO_STANDBY:
      return !e.diaCerrado && e.enParque && !e.enStandby; // abre un período (repetible)
    case EVENTO_TIPO.FIN_STANDBY:
      return !e.diaCerrado && e.enStandby; // solo si hay un stand-by abierto
    case EVENTO_TIPO.SALIDA_PARQUE:
      return !e.diaCerrado && e.enParque; // cierra el día
    case EVENTO_TIPO.FINALIZAR_PARQUE:
      return !e.diaCerrado && e.enParque; // cierra el parque
    default:
      return true;
  }
}

// ---------- Persistencia de la secuencia de tipos del día ----------

interface TiposCache {
  jornadaId: string;
  tipos: EventoTipo[];
}

/** Tipos de evento registrados hoy para esa jornada (vacío si es otra jornada). */
export async function getTiposJornada(jornadaId: string): Promise<EventoTipo[]> {
  const c = await cacheGet<TiposCache>("sesion", "jornada_eventos");
  return c && c.jornadaId === jornadaId ? c.tipos : [];
}

/** Agrega un tipo a la jornada del día (reinicia si cambió de jornada). */
export async function pushTipoJornada(
  jornadaId: string,
  tipo: EventoTipo,
): Promise<EventoTipo[]> {
  const tipos = [...(await getTiposJornada(jornadaId)), tipo];
  await cacheSet("sesion", "jornada_eventos", { jornadaId, tipos });
  return tipos;
}

/** Saca el último tipo de la secuencia del día (deshacer "Salida de parque").
 *  No-op si el último tipo no coincide con `tipoEsperado` (evita sacar algo
 *  distinto si hubo una carrera con otro evento registrado mientras tanto). */
export async function popTipoJornada(
  jornadaId: string,
  tipoEsperado: EventoTipo,
): Promise<EventoTipo[]> {
  const tipos = await getTiposJornada(jornadaId);
  if (tipos[tipos.length - 1] !== tipoEsperado) return tipos;
  const restantes = tipos.slice(0, -1);
  await cacheSet("sesion", "jornada_eventos", { jornadaId, tipos: restantes });
  return restantes;
}
