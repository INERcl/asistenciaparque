"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EVENTO_TIPO,
  type EventoTipo,
  MOTIVOS_REQUIEREN_TEXTO,
  PAIS_CONFIG_DEFAULT,
  type PaisConfig,
  STANDBY_MOTIVOS,
  STANDBY_MOTIVO_LABEL,
  type StandbyMotivo,
  type Subtipo,
  botonesDe,
  labelEvento,
  paisConfigDe,
} from "@/lib/catalogos";
import { fechaHoy } from "@/lib/tiempo";
import { createClient } from "@/lib/supabase/client";
import { registrarEvento } from "@/lib/offline/registrarEvento";
import {
  ESTADO_INICIAL,
  type EstadoJornada,
  botonHabilitado,
  estadoDesdeEventos,
  getTiposJornada,
} from "@/lib/offline/estado";
import {
  type AeroCache,
  type AsignacionCache,
  leerAeros,
  leerAsignacion,
  leerPaisesConfig,
  leerPerfil,
  limpiarSesion,
} from "@/lib/offline/sesion";
import { sync } from "@/lib/offline/sync";
import { SyncIndicator } from "./SyncIndicator";

// Acciones que abren un modal antes de registrar.
type Modal = null | "aero" | "standby" | "salida" | "finalizar" | "logout";

export function CheckIn({
  onFinalizado,
  onLogout,
}: {
  onFinalizado: () => void;
  onLogout: () => void;
}) {
  const [asignacion, setAsignacion] = useState<AsignacionCache | null>(null);
  const [subtipo, setSubtipo] = useState<Subtipo | null>(null);
  const [paisConfig, setPaisConfig] = useState<PaisConfig>(PAIS_CONFIG_DEFAULT);
  const [aeros, setAeros] = useState<AeroCache[]>([]);
  const [estado, setEstado] = useState<EstadoJornada>(ESTADO_INICIAL);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [a, perfil, cfg] = await Promise.all([
        leerAsignacion(),
        leerPerfil(),
        leerPaisesConfig(),
      ]);
      setAsignacion(a ?? null);
      setSubtipo(perfil?.subtipo ?? null);
      setPaisConfig(paisConfigDe(a?.pais ?? perfil?.pais, cfg));
      if (a) {
        setAeros((await leerAeros(a.parque_id)) ?? []);
        const jornadaId = `${a.id}_${fechaHoy(a.tz)}`;
        setEstado(estadoDesdeEventos(await getTiposJornada(jornadaId)));
      }
    })();
  }, []);

  async function registrar(
    input: Parameters<typeof registrarEvento>[0],
    feedback: string,
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await registrarEvento(input);
      setEstado(res.estado);
      setUltimo(`${feedback} · ${new Date().toLocaleTimeString("es-CL", {
        hour: "2-digit",
        minute: "2-digit",
      })}`);
      setModal(null);
      void sync();
      if (input.tipo === EVENTO_TIPO.FINALIZAR_PARQUE) onFinalizado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el evento.");
    } finally {
      window.setTimeout(() => setBusy(false), 700); // debounce anti doble toque
    }
  }

  async function cerrarSesion() {
    try {
      await createClient().auth.signOut();
    } catch {
      // Sin conexión igual limpiamos el cache local y volvemos al login.
    }
    await limpiarSesion();
    onLogout();
  }

  const on = (tipo: EventoTipo) => botonHabilitado(tipo, estado, subtipo, paisConfig);
  const etq = (tipo: EventoTipo) => labelEvento(tipo, subtipo);
  const botones = botonesDe(subtipo, paisConfig);
  const nombreParque = asignacion?.parque_nombre ?? "—";

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-iner-green px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-white/60">Parque</p>
          <p className="truncate text-sm font-bold">{nombreParque}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-white/10 px-2 py-1">
            <SyncIndicator />
          </div>
          <button
            type="button"
            onClick={() => setModal("logout")}
            className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/90 transition hover:bg-white/20"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-4 p-4">
        {ultimo && (
          <p className="rounded-lg border border-iner-ok/30 bg-iner-ok-50 px-3 py-2 text-sm text-iner-ok">
            ✓ {ultimo}
          </p>
        )}
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {estado.diaCerrado && (
          <p className="rounded-lg border border-iner-gray/30 bg-iner-gray-100 px-3 py-2 text-sm font-semibold text-iner-gray">
            {estado.parqueCerrado
              ? "Parque finalizado."
              : "Jornada cerrada — volvé mañana."}
          </p>
        )}

        {/* Entrada a aero/turbina (elige aero) — destacado */}
        <button
          type="button"
          disabled={busy || !on(botones.destacado)}
          onClick={() => setModal("aero")}
          className="w-full rounded-xl bg-iner-green px-4 py-5 text-center text-base font-bold text-white shadow-sm transition hover:bg-iner-green-700 disabled:opacity-50"
        >
          {etq(botones.destacado)}
        </button>
        {estado.enTraslado && !estado.enTurbina && (
          <p className="-mt-2 text-center text-xs text-iner-gray">
            En traslado — ahora registrá <strong>{etq(EVENTO_TIPO.ENTRADA_WTG)}</strong>.
          </p>
        )}
        {estado.enTurbina && (
          <p className="-mt-2 text-center text-xs text-iner-gray">
            Registrá <strong>{etq(EVENTO_TIPO.SALIDA_WTG)}</strong> para cerrar el aero.
          </p>
        )}

        {/* Acciones directas */}
        <div className="grid grid-cols-2 gap-3">
          {botones.directos.map((tipo) => (
            <button
              key={tipo}
              type="button"
              disabled={busy || !on(tipo)}
              onClick={() => registrar({ tipo }, etq(tipo))}
              className="rounded-xl border border-iner-green/25 bg-white px-3 py-4 text-sm font-bold text-iner-green shadow-sm transition hover:bg-iner-green-50 disabled:opacity-40"
            >
              {etq(tipo)}
            </button>
          ))}
          <button
            type="button"
            disabled={busy || !on(EVENTO_TIPO.INICIO_STANDBY)}
            onClick={() => setModal("standby")}
            className="col-span-2 rounded-xl border border-iner-amber bg-iner-amber-50 px-3 py-4 text-sm font-bold text-[#9a6200] transition hover:bg-iner-amber/20 disabled:opacity-40"
          >
            {etq(EVENTO_TIPO.INICIO_STANDBY)}
          </button>
        </div>

        {/* Cierres */}
        <div className="space-y-3 border-t border-black/10 pt-4">
          <button
            type="button"
            disabled={busy || !on(EVENTO_TIPO.SALIDA_PARQUE)}
            onClick={() => setModal("salida")}
            className="btn-secondary w-full disabled:opacity-40"
          >
            {etq(EVENTO_TIPO.SALIDA_PARQUE)} · cierra el día
          </button>
          <button
            type="button"
            disabled={busy || !on(EVENTO_TIPO.FINALIZAR_PARQUE)}
            onClick={() => setModal("finalizar")}
            className="w-full rounded-lg border border-red-600/40 bg-white px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-40"
          >
            {etq(EVENTO_TIPO.FINALIZAR_PARQUE)} · cierra el parque
          </button>
        </div>
      </div>

      {modal === "aero" && (
        <ModalAero
          aeros={aeros}
          onCerrar={() => setModal(null)}
          onElegir={(aero) =>
            registrar(
              { tipo: EVENTO_TIPO.ENTRADA_WTG, maquinaId: aero.id },
              `${etq(EVENTO_TIPO.ENTRADA_WTG)} · ${aero.nombre ?? aero.numero}`,
            )
          }
        />
      )}
      {modal === "standby" && (
        <ModalStandby
          busy={busy}
          onCerrar={() => setModal(null)}
          onConfirmar={(motivo, motivoOtro) =>
            registrar(
              { tipo: EVENTO_TIPO.INICIO_STANDBY, motivo, motivoOtro },
              `${etq(EVENTO_TIPO.INICIO_STANDBY)} · ${STANDBY_MOTIVO_LABEL[motivo]}`,
            )
          }
        />
      )}
      {modal === "salida" && (
        <ModalConfirmar
          titulo="Salida de parque"
          detalle="Cierra la jornada de hoy y cuenta la última turbina como inspeccionada. Podés volver mañana al mismo parque."
          textoOk="Registrar salida"
          onCerrar={() => setModal(null)}
          onOk={() =>
            registrar({ tipo: EVENTO_TIPO.SALIDA_PARQUE }, etq(EVENTO_TIPO.SALIDA_PARQUE))
          }
        />
      )}
      {modal === "finalizar" && (
        <ModalConfirmar
          peligro
          titulo="Finalizar parque"
          detalle="Cierra el parque por completo y termina la asignación. Volverás a elegir un parque nuevo. Usá esto solo cuando la inspección esté terminada."
          textoOk="Finalizar parque"
          onCerrar={() => setModal(null)}
          onOk={() =>
            registrar({ tipo: EVENTO_TIPO.FINALIZAR_PARQUE }, etq(EVENTO_TIPO.FINALIZAR_PARQUE))
          }
        />
      )}
      {modal === "logout" && (
        <ModalConfirmar
          titulo="Cerrar sesión"
          detalle="Se cierra tu sesión en este dispositivo. Los eventos pendientes quedan guardados y se sincronizan al volver a ingresar. No finaliza el parque."
          textoOk="Cerrar sesión"
          onCerrar={() => setModal(null)}
          onOk={cerrarSesion}
        />
      )}
    </main>
  );
}

// ---------- Modales ----------

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        {children}
      </div>
    </div>
  );
}

function ModalAero({
  aeros,
  onElegir,
  onCerrar,
}: {
  aeros: AeroCache[];
  onElegir: (a: AeroCache) => void;
  onCerrar: () => void;
}) {
  const [q, setQ] = useState("");
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return aeros;
    return aeros.filter(
      (a) => String(a.numero).includes(t) || (a.nombre ?? "").toLowerCase().includes(t),
    );
  }, [aeros, q]);

  return (
    <Overlay>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">Elegí la turbina</h2>
        <button type="button" onClick={onCerrar} className="text-sm text-iner-gray">
          Cancelar
        </button>
      </div>
      {aeros.length === 0 ? (
        <p className="py-6 text-center text-sm text-iner-gray">
          No hay aeros cacheados para este parque.
        </p>
      ) : (
        <>
          <input
            className="campo mb-3"
            placeholder="Buscar número o nombre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            inputMode="numeric"
          />
          <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto">
            {filtrados.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onElegir(a)}
                className="rounded-lg border border-iner-green/25 bg-white px-2 py-3 text-sm font-bold text-iner-green transition hover:bg-iner-green-50"
              >
                {a.nombre ?? `WTG ${a.numero}`}
              </button>
            ))}
          </div>
        </>
      )}
    </Overlay>
  );
}

function ModalStandby({
  busy,
  onConfirmar,
  onCerrar,
}: {
  busy: boolean;
  onConfirmar: (motivo: StandbyMotivo, motivoOtro?: string) => void;
  onCerrar: () => void;
}) {
  const [motivo, setMotivo] = useState<StandbyMotivo | null>(null);
  const [texto, setTexto] = useState("");
  const requiereTexto = motivo != null && MOTIVOS_REQUIEREN_TEXTO.includes(motivo);
  const puedeConfirmar = motivo != null && (!requiereTexto || texto.trim().length > 0);

  return (
    <Overlay>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">Motivo del stand-by</h2>
        <button type="button" onClick={onCerrar} className="text-sm text-iner-gray">
          Cancelar
        </button>
      </div>
      <div className="space-y-2">
        {STANDBY_MOTIVOS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMotivo(m)}
            className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-sm font-semibold transition ${
              motivo === m
                ? "border-iner-green bg-iner-green-50 text-iner-green"
                : "border-black/15 bg-white text-foreground"
            }`}
          >
            {STANDBY_MOTIVO_LABEL[m]}
            {motivo === m && <span>✓</span>}
          </button>
        ))}
      </div>
      {requiereTexto && (
        <input
          className="campo mt-3"
          placeholder="Especificá el motivo…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      )}
      <button
        type="button"
        disabled={!puedeConfirmar || busy}
        onClick={() => motivo && onConfirmar(motivo, texto.trim() || undefined)}
        className="btn-primary mt-4 w-full"
      >
        Registrar stand-by
      </button>
    </Overlay>
  );
}

function ModalConfirmar({
  titulo,
  detalle,
  textoOk,
  peligro,
  onOk,
  onCerrar,
}: {
  titulo: string;
  detalle: string;
  textoOk: string;
  peligro?: boolean;
  onOk: () => void;
  onCerrar: () => void;
}) {
  return (
    <Overlay>
      <h2 className="text-base font-bold">{titulo}</h2>
      <p className="mt-2 text-sm text-iner-gray">{detalle}</p>
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={onCerrar} className="btn-secondary flex-1">
          Cancelar
        </button>
        <button
          type="button"
          onClick={onOk}
          className={`flex-1 rounded-lg px-4 py-3 text-sm font-bold text-white shadow-sm transition ${
            peligro ? "bg-red-600 hover:bg-red-700" : "bg-iner-green hover:bg-iner-green-700"
          }`}
        >
          {textoOk}
        </button>
      </div>
    </Overlay>
  );
}
