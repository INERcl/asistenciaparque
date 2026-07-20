"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ESTADO_ASIGNACION,
  PAIS_LABEL,
  type Pais,
  TZ_POR_PAIS,
  columnaParquePermitida,
} from "@/lib/catalogos";
import {
  type EventoParaSiembra,
  inspeccionadosDesdeEventos,
  sembrarInspeccionados,
} from "@/lib/offline/inspeccionados";
import {
  type AeroCache,
  type ParqueCache,
  type PaisesConfig,
  guardarAeros,
  guardarAsignacion,
  guardarPaisesConfig,
  guardarParques,
  leerParques,
  leerPerfil,
} from "@/lib/offline/sesion";
import { Hero } from "./Hero";

export function Onboarding({
  onReady,
  onSalir,
  onVerJornadas,
}: {
  onReady: () => void;
  onSalir: () => void;
  onVerJornadas: () => void;
}) {
  const [parques, setParques] = useState<ParqueCache[]>([]);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nombreTecnico, setNombreTecnico] = useState<string | null>(null);

  const hidratarAsignacion = useCallback(
    async (a: { id: string; parque_id: string; inicio_ts: string }, lista: ParqueCache[]) => {
      const p = lista.find((x) => x.id === a.parque_id);
      if (!p) return false;
      const supabase = createClient();
      const { data: aeros } = await supabase
        .from("aeros")
        .select("id, numero, nombre")
        .eq("parque_id", p.id)
        .order("orden")
        .order("numero");
      await guardarAeros(p.id, (aeros ?? []) as AeroCache[]);
      await guardarAsignacion({
        id: a.id,
        parque_id: p.id,
        parque_nombre: p.nombre,
        pais: p.pais,
        tz: TZ_POR_PAIS[p.pais],
        inicio_ts: a.inicio_ts,
        turbinas: p.turbinas ?? null,
        lat: p.lat ?? null,
        lon: p.lon ?? null,
      });
      // Siembra el acumulado de cavidades inspeccionadas desde el server: cubre
      // dispositivo nuevo o cache borrado con asignación en curso.
      const { data: evs } = await supabase
        .from("eventos")
        .select("tipo, maquina_id, palas, ts_dispositivo, jornada_id, jornadas!inner(asignacion_id)")
        .eq("jornadas.asignacion_id", a.id)
        .in("tipo", ["entrada_wtg", "salida_wtg", "salida_parque", "finalizar_parque"])
        .order("ts_dispositivo");
      if (evs) {
        await sembrarInspeccionados(
          a.id,
          inspeccionadosDesdeEventos(evs as unknown as EventoParaSiembra[]),
        );
      }
      return true;
    },
    [],
  );

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true);
      try {
        const supabase = createClient();
        const perfil = await leerPerfil();
        if (vivo) setNombreTecnico(perfil?.nombre ?? null);

        // Config por país (data-driven): la cachea para el check-in offline.
        const { data: paisesData } = await supabase
          .from("paises")
          .select("id, permite_interno, permite_externo, usa_almuerzo, usa_equipos");
        if (paisesData) {
          const cfg: PaisesConfig = {};
          for (const p of paisesData) {
            cfg[p.id as keyof PaisesConfig] = {
              permite_interno: p.permite_interno,
              permite_externo: p.permite_externo,
              usa_almuerzo: p.usa_almuerzo,
              usa_equipos: p.usa_equipos,
            };
          }
          await guardarPaisesConfig(cfg);
        }

        // Parques del país del técnico (si el perfil trae país; si no, todos) y
        // de su flujo: la interna y la externa no visitan los mismos parques.
        let q = supabase
          .from("parques")
          .select("id, nombre, pais, empresa_id, turbinas, lat, lon")
          .eq("activo", true)
          .eq(columnaParquePermitida(perfil?.subtipo ?? null), true);
        if (perfil?.pais) q = q.eq("pais", perfil.pais);
        const { data, error } = await q.order("pais").order("orden");
        if (error) throw error;
        const lista = (data ?? []) as ParqueCache[];
        if (!vivo) return;
        setParques(lista);
        await guardarParques(lista);

        // Reconcilia: si ya hay una asignación activa en el server (p.ej. dispositivo
        // nuevo), la reusa y entra directo al check-in (evita doble activa, C4).
        if (perfil) {
          const { data: act } = await supabase
            .from("asignaciones")
            .select("id, parque_id, inicio_ts")
            .eq("tecnico_id", perfil.id)
            .eq("estado", ESTADO_ASIGNACION.ACTIVA)
            .maybeSingle();
          if (act && (await hidratarAsignacion(act, lista))) {
            if (vivo) onReady();
            return;
          }
        }
      } catch {
        const cache = await leerParques();
        if (cache?.length) setParques(cache);
        else if (vivo)
          setError("Necesitás conexión la primera vez para cargar los parques.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [hidratarAsignacion, onReady]);

  async function elegir(p: ParqueCache) {
    setError(null);
    setCreando(p.id);
    try {
      if (!navigator.onLine) throw new Error("Elegir un parque requiere conexión.");
      const perfil = await leerPerfil();
      if (!perfil) throw new Error("Perfil no disponible; volvé a iniciar sesión.");
      const supabase = createClient();

      const id = crypto.randomUUID();
      const inicio_ts = new Date().toISOString();
      const { error } = await supabase.from("asignaciones").insert({
        id,
        tecnico_id: perfil.id,
        parque_id: p.id,
        estado: ESTADO_ASIGNACION.ACTIVA,
        inicio_ts,
      });
      if (error) throw error;

      const { data: aeros } = await supabase
        .from("aeros")
        .select("id, numero, nombre")
        .eq("parque_id", p.id)
        .order("orden")
        .order("numero");
      await guardarAeros(p.id, (aeros ?? []) as AeroCache[]);
      await guardarAsignacion({
        id,
        parque_id: p.id,
        parque_nombre: p.nombre,
        pais: p.pais,
        tz: TZ_POR_PAIS[p.pais],
        inicio_ts,
        turbinas: p.turbinas ?? null,
        lat: p.lat ?? null,
        lon: p.lon ?? null,
      });
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la asignación.");
    } finally {
      setCreando(null);
    }
  }

  const paises = [...new Set(parques.map((p) => p.pais))] as Pais[];

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Hero subtitulo="Elegí el parque a inspeccionar" />
        <div className="rounded-b-2xl border border-t-0 border-black/10 bg-white p-4 shadow-sm">
          {nombreTecnico && (
            <p className="mb-3 rounded-lg bg-iner-green-50 px-3 py-2 text-sm text-iner-green">
              Sesión iniciada como: <strong>{nombreTecnico}</strong>
            </p>
          )}
          {error && (
            <p className="mb-3 rounded-lg border border-iner-amber bg-iner-amber-50 px-3 py-2 text-sm text-[#9a6200]">
              {error}
            </p>
          )}

          {cargando ? (
            <p className="py-8 text-center text-sm text-iner-gray">Cargando parques…</p>
          ) : parques.length === 0 && !error ? (
            <p className="py-8 text-center text-sm text-iner-gray">
              No hay parques asignados a tu perfil. Comunícate con tu supervisor.
            </p>
          ) : (
            <div className="space-y-4">
              {paises.map((pais) => (
                <div key={pais}>
                  <p className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-iner-gray">
                    {PAIS_LABEL[pais] ?? pais}
                  </p>
                  <ul className="divide-y divide-black/5 overflow-hidden rounded-lg border border-black/10">
                    {parques
                      .filter((p) => p.pais === pais)
                      .map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            disabled={creando !== null}
                            onClick={() => elegir(p)}
                            className="flex w-full items-center justify-between px-3 py-3 text-left transition hover:bg-iner-green-50 disabled:opacity-50"
                          >
                            <span className="font-semibold text-foreground">{p.nombre}</span>
                            <span className="text-xs text-iner-gray">
                              {creando === p.id
                                ? "Creando…"
                                : p.turbinas != null
                                  ? `${p.turbinas} WTG`
                                  : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={onVerJornadas}
            className="btn-secondary mt-4 w-full"
          >
            Ver jornadas
          </button>

          <button
            type="button"
            onClick={onSalir}
            className="mt-3 w-full text-center text-xs text-iner-gray underline"
          >
            Cerrar sesión y volver al inicio
          </button>
        </div>
      </div>
    </main>
  );
}
