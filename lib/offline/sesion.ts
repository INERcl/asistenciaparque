// Cache persistente (IndexedDB) del perfil del técnico, la asignación activa y el
// catálogo del parque (parques + aeros). Lo llenan login y onboarding cuando hay
// conexión; el check-in lo lee para funcionar offline.

import { type Pais, type PaisConfig, type Subtipo } from "@/lib/catalogos";
import { cacheGet, cacheSet } from "./db";

export interface PerfilCache {
  id: string; // = auth.uid()
  nombre: string | null;
  subtipo: Subtipo | null;
  pais: Pais | null;
  equipo_id: string | null;
}

export interface AsignacionCache {
  id: string; // uuid de la asignación activa
  parque_id: string;
  parque_nombre: string;
  pais: Pais;
  tz: string; // IANA, para fecha de jornada y ts_dispositivo
  inicio_ts: string;
}

export interface AeroCache {
  id: string;
  numero: number;
  nombre: string | null;
}

export interface ParqueCache {
  id: string;
  nombre: string;
  pais: Pais;
  empresa_id: string | null;
  turbinas: number | null;
}

// ---------- Perfil ----------
export const guardarPerfil = (p: PerfilCache) => cacheSet("sesion", "perfil", p);
export const leerPerfil = () => cacheGet<PerfilCache>("sesion", "perfil");

// ---------- Asignación activa ----------
export const guardarAsignacion = (a: AsignacionCache | null) =>
  cacheSet("sesion", "asignacion", a);
export const leerAsignacion = () =>
  cacheGet<AsignacionCache | null>("sesion", "asignacion");

/** Limpia la sesión local (logout): perfil, asignación y estado del día en cache.
 *  No toca la outbox: los eventos pendientes sobreviven y sincronizan al re-loguear. */
export async function limpiarSesion(): Promise<void> {
  await Promise.all([
    cacheSet("sesion", "perfil", null),
    cacheSet("sesion", "asignacion", null),
    cacheSet("sesion", "jornada_activa", null),
    cacheSet("sesion", "jornada_eventos", null),
  ]);
}

// ---------- Catálogo ----------
export const guardarParques = (p: ParqueCache[]) => cacheSet("catalogo", "parques", p);
export const leerParques = () => cacheGet<ParqueCache[]>("catalogo", "parques");

/** Aeros por parque (key = `aeros:{parque_id}`) para no mezclar entre parques. */
export const guardarAeros = (parqueId: string, aeros: AeroCache[]) =>
  cacheSet("catalogo", `aeros:${parqueId}`, aeros);
export const leerAeros = (parqueId: string) =>
  cacheGet<AeroCache[]>("catalogo", `aeros:${parqueId}`);

// ---------- Config por país (data-driven, ver tabla `paises`) ----------
export type PaisesConfig = Partial<Record<Pais, PaisConfig>>;
export const guardarPaisesConfig = (c: PaisesConfig) =>
  cacheSet("catalogo", "paises_config", c);
export const leerPaisesConfig = () =>
  cacheGet<PaisesConfig>("catalogo", "paises_config");
