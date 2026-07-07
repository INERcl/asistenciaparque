"use client";

// Historial de jornadas pasadas del técnico (online-only: el detalle vive en
// Supabase, no se cachea en el dispositivo). Cards colapsables: colapsado muestra
// Fecha + Parque; al desplegar trae los eventos del día, reconstruye el resumen
// detallado (mismo formato que el cierre de día) y permite copiarlo entero.

import { useEffect, useState } from "react";
import { SUBTIPO, TZ_POR_PAIS, type Subtipo } from "@/lib/catalogos";
import {
  type EventoResumen,
  copiarTexto,
  encabezadoDia,
  resumenInternoDesdeEventos,
  resumenJornadaDesdeEventos,
  textoResumenInterno,
  textoResumenJornada,
} from "@/lib/compartir";
import { leerEquipoMiembros, leerParques, leerPerfil } from "@/lib/offline/sesion";
import { createClient } from "@/lib/supabase/client";
import { TZ_DEFAULT, ahoraISO } from "@/lib/tiempo";

interface JornadaFila {
  id: string;
  fecha: string; // YYYY-MM-DD
  parque_id: string;
  subtipo: Subtipo | null;
}

interface EventoRow {
  tipo: string;
  ts_dispositivo: string;
  maquina_id: string | null;
  motivo: string | null;
  motivo_otro: string | null;
  aeros: { numero: number } | { numero: number }[] | null;
}

/** YYYY-MM-DD → DD/MM/YYYY. */
const fechaLarga = (f: string): string =>
  `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

type Estado = "cargando" | "offline" | "error" | "ok";

export function Jornadas({ onBack }: { onBack: () => void }) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [jornadas, setJornadas] = useState<JornadaFila[]>([]);
  const [nombreParque, setNombreParque] = useState<Record<string, string>>({});
  const [tzParque, setTzParque] = useState<Record<string, string>>({});
  const [operador, setOperador] = useState("—");
  const [equipo, setEquipo] = useState("—");
  const [expandida, setExpandida] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setEstado("offline");
        return;
      }
      const perfil = await leerPerfil();
      if (!perfil) {
        setEstado("error");
        return;
      }
      setOperador(perfil.nombre ?? "—");
      setEquipo((await leerEquipoMiembros()) ?? perfil.nombre ?? "—");
      const parques = (await leerParques()) ?? [];
      setNombreParque(Object.fromEntries(parques.map((p) => [p.id, p.nombre])));
      setTzParque(Object.fromEntries(parques.map((p) => [p.id, TZ_POR_PAIS[p.pais]])));
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("jornadas")
          .select("id, fecha, parque_id, subtipo")
          .eq("tecnico_id", perfil.id)
          .order("fecha", { ascending: false });
        if (error) {
          setEstado("error");
          return;
        }
        setJornadas((data ?? []) as unknown as JornadaFila[]);
        setEstado("ok");
      } catch {
        setEstado("error");
      }
    })();
  }, []);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-black/10 bg-iner-green px-4 py-3 text-white">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/90 transition hover:bg-white/20"
        >
          ← Volver
        </button>
        <p className="text-sm font-bold">Jornadas</p>
      </header>

      <div className="flex-1 space-y-3 p-4">
        {estado === "cargando" && <p className="text-sm text-iner-gray">Cargando jornadas…</p>}
        {estado === "offline" && (
          <p className="rounded-lg border border-iner-gray/30 bg-iner-gray-100 px-3 py-2 text-sm text-iner-gray">
            Necesitás conexión para ver jornadas pasadas.
          </p>
        )}
        {estado === "error" && (
          <p className="rounded-lg border border-red-500/30 bg-red-50 px-3 py-2 text-sm text-red-700">
            No se pudieron cargar las jornadas. Probá de nuevo.
          </p>
        )}
        {estado === "ok" && jornadas.length === 0 && (
          <p className="text-sm text-iner-gray">Todavía no hay jornadas registradas.</p>
        )}
        {estado === "ok" &&
          jornadas.map((j) => (
            <JornadaCard
              key={j.id}
              jornada={j}
              parque={nombreParque[j.parque_id] ?? j.parque_id}
              tz={tzParque[j.parque_id] ?? TZ_DEFAULT}
              operador={operador}
              equipo={equipo}
              abierta={expandida === j.id}
              onToggle={() => setExpandida((cur) => (cur === j.id ? null : j.id))}
            />
          ))}
      </div>
    </main>
  );
}

function JornadaCard({
  jornada,
  parque,
  tz,
  operador,
  equipo,
  abierta,
  onToggle,
}: {
  jornada: JornadaFila;
  parque: string;
  tz: string;
  operador: string;
  equipo: string;
  abierta: boolean;
  onToggle: () => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);
  const [copiado, setCopiado] = useState<boolean | null>(null);

  useEffect(() => {
    if (!abierta || texto != null || cargando) return;
    (async () => {
      setCargando(true);
      setError(false);
      try {
        const supabase = createClient();
        const { data, error: err } = await supabase
          .from("eventos")
          .select("tipo, ts_dispositivo, maquina_id, motivo, motivo_otro, aeros(numero)")
          .eq("jornada_id", jornada.id)
          .eq("anulado", false)
          .order("ts_dispositivo");
        if (err) {
          setError(true);
          return;
        }
        const eventos: EventoResumen[] = ((data ?? []) as unknown as EventoRow[]).map((e) => {
          const aero = Array.isArray(e.aeros) ? e.aeros[0] : e.aeros;
          return {
            tipo: e.tipo,
            // Supabase devuelve el timestamptz en UTC; lo reexpresamos en la hora
            // de pared del parque para que el HH:MM salga correcto (ver hhmm).
            ts: ahoraISO(tz, new Date(e.ts_dispositivo)),
            maquinaId: e.maquina_id,
            numero: aero?.numero ?? null,
            motivo: e.motivo,
            motivoOtro: e.motivo_otro,
          };
        });
        if (jornada.subtipo === SUBTIPO.INSPECTOR_EXTERNO) {
          const datos = resumenJornadaDesdeEventos(eventos, {
            operador,
            parque,
            fecha: fechaLarga(jornada.fecha),
          });
          setTexto(textoResumenJornada(datos));
        } else {
          const datos = resumenInternoDesdeEventos(eventos, {
            ...encabezadoDia(jornada.fecha),
            parque,
            equipo,
          });
          setTexto(textoResumenInterno(datos));
        }
      } catch {
        setError(true);
      } finally {
        setCargando(false);
      }
    })();
  }, [
    abierta,
    texto,
    cargando,
    jornada.id,
    jornada.fecha,
    jornada.subtipo,
    operador,
    parque,
    equipo,
    tz,
  ]);

  return (
    <div className="overflow-hidden rounded-lg border border-black/10 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-3 text-left transition hover:bg-iner-green-50"
      >
        <span className="min-w-0">
          <span className="block text-sm font-bold text-foreground">
            {fechaLarga(jornada.fecha)}
          </span>
          <span className="block truncate text-xs text-iner-gray">{parque}</span>
        </span>
        <span className="text-iner-gray">{abierta ? "▲" : "▼"}</span>
      </button>
      {abierta && (
        <div className="border-t border-black/10 p-3">
          {cargando && <p className="text-sm text-iner-gray">Cargando eventos…</p>}
          {error && <p className="text-sm text-red-700">No se pudieron cargar los eventos.</p>}
          {texto != null && (
            <>
              <pre className="max-h-[45vh] overflow-auto rounded-lg bg-iner-gray-100 px-3 py-3 text-sm text-foreground">
                {texto}
              </pre>
              {copiado === false && (
                <p className="mt-2 rounded-lg border border-iner-amber bg-iner-amber-50 px-3 py-2 text-xs text-[#9a6200]">
                  No se pudo copiar. Mantené apretado el texto para copiarlo a mano.
                </p>
              )}
              <button
                type="button"
                onClick={async () => setCopiado(await copiarTexto(texto))}
                className="btn-primary mt-3 w-full"
              >
                {copiado ? "✓ Copiado" : "Copiar todo"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
