"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CLIMA_MOTIVO,
  CLIMA_MOTIVO_LABEL,
  type ClimaMotivo,
  EVENTO_TIPO,
  type EventoTipo,
  MOTIVOS_REQUIEREN_SUBLISTA,
  MOTIVOS_REQUIEREN_TEXTO,
  PAIS_CONFIG_DEFAULT,
  type PaisConfig,
  STANDBY_MOTIVO,
  STANDBY_MOTIVOS,
  STANDBY_MOTIVO_LABEL,
  SUBTIPO,
  type StandbyMotivo,
  type Subtipo,
  botonesDe,
  climaMotivosDe,
  labelEvento,
  paisConfigDe,
} from "@/lib/catalogos";
import {
  encabezadoDia,
  resumenInternoDesdeEventos,
  resumenJornadaDesdeEventos,
  textoEvidencia,
  textoResumenInterno,
  textoResumenJornada,
} from "@/lib/compartir";
import { fechaHoy } from "@/lib/tiempo";
import { refrescarEquipoMiembros } from "@/lib/equipo";
import { createClient } from "@/lib/supabase/client";
import { registrarEvento } from "@/lib/offline/registrarEvento";
import {
  ESTADO_INICIAL,
  type EstadoJornada,
  botonHabilitado,
  estadoDesdeEventos,
  getTiposJornada,
} from "@/lib/offline/estado";
import { leerAeroActual, leerInspeccionados } from "@/lib/offline/inspeccionados";
import { leerEventosDetalle } from "@/lib/offline/detalleJornada";
import {
  type AeroCache,
  type AsignacionCache,
  leerAeros,
  leerAsignacion,
  leerEquipoMiembros,
  leerPaisesConfig,
  leerPerfil,
  limpiarAsignacionLocal,
  limpiarSesion,
} from "@/lib/offline/sesion";
import { sync } from "@/lib/offline/sync";
import { ModalCompartir, ModalEvidencia } from "./Evidencia";
import { Overlay } from "./Overlay";
import { ModalResumenDia } from "./ResumenDia";
import { SyncIndicator } from "./SyncIndicator";
import {
  IconBandera,
  IconCalendario,
  IconClima,
  IconGranizo,
  IconInduccion,
  IconLapiz,
  IconLlave,
  IconLluvia,
  IconNiebla,
  IconNieve,
  IconPocaLuz,
  type IconProps,
  IconProgramacion,
  IconViento,
} from "./icons";

// Iconos por motivo (solo UI; separados de la etiqueta, que se guarda en la base).
type Icono = (p: IconProps) => React.ReactNode;

const STANDBY_MOTIVO_ICON: Record<StandbyMotivo, Icono> = {
  [STANDBY_MOTIVO.CLIMA]: IconClima,
  [STANDBY_MOTIVO.INDUCCION]: IconInduccion,
  [STANDBY_MOTIVO.PROGRAMACION_45]: IconProgramacion,
  [STANDBY_MOTIVO.TERMINO_PARQUE]: IconBandera,
  [STANDBY_MOTIVO.DIA_STANDBY]: IconCalendario,
  [STANDBY_MOTIVO.HORA_MAQUINA]: IconLlave,
  [STANDBY_MOTIVO.OTROS]: IconLapiz,
};

const CLIMA_MOTIVO_ICON: Record<ClimaMotivo, Icono> = {
  [CLIMA_MOTIVO.VIENTO]: IconViento,
  [CLIMA_MOTIVO.LLUVIA]: IconLluvia,
  [CLIMA_MOTIVO.NIEBLA]: IconNiebla,
  [CLIMA_MOTIVO.NIEVE]: IconNieve,
  [CLIMA_MOTIVO.GRANIZO]: IconGranizo,
  [CLIMA_MOTIVO.POCA_LUZ]: IconPocaLuz,
  [CLIMA_MOTIVO.TORMENTA]: IconLluvia, // Argentina
  [CLIMA_MOTIVO.VIENTO_ALTO]: IconViento, // Argentina
  [CLIMA_MOTIVO.VIENTO_BAJO]: IconViento, // Argentina
};

// Acciones que abren un modal antes de registrar.
type Modal =
  | null
  | "aero"
  | "evidencia-stop"
  | "evidencia-run"
  | "standby"
  | "salida"
  | "finalizar"
  | "cancelar"
  | "logout";

// Evidencia registrada lista para compartir por WhatsApp.
interface Compartible {
  texto: string;
  blob: Blob | null;
  nombreArchivo: string;
}

export function CheckIn({
  onFinalizado,
  onLogout,
  onVerJornadas,
}: {
  onFinalizado: () => void;
  onLogout: () => void;
  onVerJornadas: () => void;
}) {
  const [asignacion, setAsignacion] = useState<AsignacionCache | null>(null);
  const [subtipo, setSubtipo] = useState<Subtipo | null>(null);
  const [nombreTecnico, setNombreTecnico] = useState<string | null>(null);
  const [paisConfig, setPaisConfig] = useState<PaisConfig>(PAIS_CONFIG_DEFAULT);
  const [aeros, setAeros] = useState<AeroCache[]>([]);
  const [estado, setEstado] = useState<EstadoJornada>(ESTADO_INICIAL);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Flujo externo STOP/RUN:
  const [aeroElegido, setAeroElegido] = useState<AeroCache | null>(null); // STOP pendiente de foto
  const [aeroActual, setAeroActual] = useState<AeroCache | null>(null); // STOP registrado sin RUN
  const [compartir, setCompartir] = useState<Compartible | null>(null);
  const [resumen, setResumen] = useState<string | null>(null); // texto ya armado
  const [resumenEsFinal, setResumenEsFinal] = useState(false);
  // Ids de aero ya inspeccionados (acumulado de la asignación) → tinte verde en el selector.
  const [inspeccionados, setInspeccionados] = useState<Set<string>>(new Set());

  const externo = subtipo === SUBTIPO.INSPECTOR_EXTERNO;

  useEffect(() => {
    (async () => {
      const [a, perfil, cfg] = await Promise.all([
        leerAsignacion(),
        leerPerfil(),
        leerPaisesConfig(),
      ]);
      setAsignacion(a ?? null);
      setSubtipo(perfil?.subtipo ?? null);
      setNombreTecnico(perfil?.nombre ?? null);
      setPaisConfig(paisConfigDe(a?.pais ?? perfil?.pais, cfg));
      // Refresca los nombres del equipo (resumen interno) con red, sin depender
      // del re-login. Requiere la RLS 0011 para ver a los compañeros.
      if (perfil && navigator.onLine) void refrescarEquipoMiembros(perfil);
      if (a) {
        const lista = (await leerAeros(a.parque_id)) ?? [];
        setAeros(lista);
        const jornadaId = `${a.id}_${fechaHoy(a.tz)}`;
        setEstado(estadoDesdeEventos(await getTiposJornada(jornadaId)));
        setInspeccionados(new Set(await leerInspeccionados(a.id)));
        // Reconstruye el aero con STOP abierto (sobrevive recargas).
        const abierto = await leerAeroActual(jornadaId);
        setAeroActual(lista.find((x) => x.id === abierto) ?? null);
      }
    })();
  }, []);

  async function registrar(
    input: Parameters<typeof registrarEvento>[0],
    feedback: string,
  ): Promise<Awaited<ReturnType<typeof registrarEvento>> | null> {
    if (busy) return null;
    setBusy(true);
    setError(null);
    try {
      const res = await registrarEvento(input);
      setEstado(res.estado);
      // Refresca el acumulado de inspeccionados (una salida acaba de completar un aero).
      if (asignacion) {
        void leerInspeccionados(asignacion.id).then((ids) =>
          setInspeccionados(new Set(ids)),
        );
      }
      setUltimo(`${feedback} · ${new Date().toLocaleTimeString("es-CL", {
        hour: "2-digit",
        minute: "2-digit",
      })}`);
      setModal(null);
      void sync();
      // Interno y externo ven primero el resumen del día; onFinalizado() se
      // difiere al cierre de ese modal (ver ModalResumenDia y cerrar()).
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el evento.");
      return null;
    } finally {
      window.setTimeout(() => setBusy(false), 700); // debounce anti doble toque
    }
  }

  /** Cierre del día/parque: arma y muestra el resumen copiable (externo STOP/RUN
   *  o interno Traslado/Subida/Salida). Los eventos del día se leen ANTES de
   *  registrar el cierre (finalizar_parque limpia el detalle local y la
   *  asignación); la hora de salida sale de res.ts. */
  async function cerrar(tipo: EventoTipo) {
    const eventos = asignacion
      ? await leerEventosDetalle(`${asignacion.id}_${fechaHoy(asignacion.tz)}`)
      : [];
    const res = await registrar({ tipo }, etq(tipo));
    if (!res || !asignacion) return;
    const f = fechaHoy(asignacion.tz); // YYYY-MM-DD
    const numeroDe = (maquinaId: string | null | undefined) =>
      aeros.find((a) => a.id === maquinaId)?.numero ?? null;
    const conCierre = [...eventos, { tipo: EVENTO_TIPO.SALIDA_PARQUE, ts: res.ts }];
    if (externo) {
      setResumen(
        textoResumenJornada(
          resumenJornadaDesdeEventos(
            conCierre,
            {
              operador: nombreTecnico ?? "—",
              parque: asignacion.parque_nombre,
              fecha: `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`,
            },
            numeroDe,
          ),
        ),
      );
    } else {
      const equipo = (await leerEquipoMiembros()) ?? nombreTecnico ?? "—";
      setResumen(
        textoResumenInterno(
          resumenInternoDesdeEventos(
            conCierre,
            { ...encabezadoDia(f), parque: asignacion.parque_nombre, equipo },
            numeroDe,
          ),
        ),
      );
    }
    setResumenEsFinal(tipo === EVENTO_TIPO.FINALIZAR_PARQUE);
  }

  /** STOP/RUN del externo con evidencia: registra y ofrece compartir. */
  async function registrarConEvidencia(
    tipo: EventoTipo,
    aero: AeroCache,
    foto: Blob | null,
  ) {
    const esStop = tipo === EVENTO_TIPO.ENTRADA_WTG;
    const res = await registrar(
      {
        tipo,
        maquinaId: esStop ? aero.id : undefined,
        foto: foto ?? undefined,
      },
      `${etq(tipo)} · ${aero.nombre ?? `WTG ${aero.numero}`}`,
    );
    if (!res) return;
    setAeroActual(esStop ? aero : null);
    setAeroElegido(null);
    if (foto) {
      setCompartir({
        texto: textoEvidencia({
          tipo: esStop ? "stop" : "run",
          operador: nombreTecnico ?? "—",
          parque: asignacion?.parque_nombre ?? "—",
          numeroWtg: aero.numero,
          tsISO: res.ts,
        }),
        blob: foto,
        nombreArchivo: `${esStop ? "stop" : "run"}-wtg-${aero.numero}.jpg`,
      });
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

  /** Cambiar de parque: borra la asignación elegida por error (sin cerrar sesión)
   *  y vuelve a la selección. Solo si aún no tiene jornadas registradas. */
  async function cancelarParque() {
    if (busy || !asignacion) return;
    setBusy(true);
    setError(null);
    try {
      if (!navigator.onLine) {
        throw new Error("Necesitás conexión para cambiar de parque.");
      }
      const supabase = createClient();
      const { count, error: errCount } = await supabase
        .from("jornadas")
        .select("id", { count: "exact", head: true })
        .eq("asignacion_id", asignacion.id);
      if (errCount) throw errCount;
      if ((count ?? 0) > 0) {
        throw new Error(
          'Este parque ya tiene actividad registrada. Usá "Finalizar parque" para cerrarlo.',
        );
      }
      const { error: errDel } = await supabase
        .from("asignaciones")
        .delete()
        .eq("id", asignacion.id);
      if (errDel) throw errDel;
      await limpiarAsignacionLocal(asignacion.id);
      setModal(null);
      onFinalizado(); // vuelve a la selección de parque, sin cerrar sesión
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar de parque.");
      setModal(null);
    } finally {
      window.setTimeout(() => setBusy(false), 500);
    }
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
            onClick={onVerJornadas}
            className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/90 transition hover:bg-white/20"
          >
            Jornadas
          </button>
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

        {/* Destacado: entrada a aero (elige aero). Externo: alterna STOP/RUN. */}
        <button
          type="button"
          disabled={
            busy ||
            !on(externo && estado.enTurbina ? EVENTO_TIPO.SALIDA_WTG : botones.destacado)
          }
          onClick={() =>
            setModal(externo && estado.enTurbina ? "evidencia-run" : "aero")
          }
          className="w-full rounded-xl bg-iner-green px-4 py-5 text-center text-base font-bold text-white shadow-sm transition hover:bg-iner-green-700 disabled:opacity-50"
        >
          {externo && estado.enTurbina
            ? `${etq(EVENTO_TIPO.SALIDA_WTG)}${aeroActual ? ` · ${aeroActual.nombre ?? `WTG ${aeroActual.numero}`}` : ""}`
            : etq(botones.destacado)}
        </button>
        {!externo && estado.enTraslado && !estado.enTurbina && (
          <p className="-mt-2 text-center text-xs text-iner-gray">
            En traslado — ahora registrá <strong>{etq(EVENTO_TIPO.ENTRADA_WTG)}</strong>.
          </p>
        )}
        {estado.enTurbina && (
          <p className="-mt-2 text-center text-xs text-iner-gray">
            Registrá <strong>{etq(EVENTO_TIPO.SALIDA_WTG)}</strong> para cerrar el aero.
          </p>
        )}
        {!estado.enParque && !estado.diaCerrado && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setModal("cancelar")}
            className="-mt-1 w-full text-center text-xs text-iner-gray underline disabled:opacity-40"
          >
            ¿Parque equivocado? Cambiar de parque
          </button>
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
          inspeccionados={inspeccionados}
          onCerrar={() => setModal(null)}
          onElegir={(aero) => {
            if (externo) {
              // El STOP del externo lleva foto de evidencia antes de registrar.
              setAeroElegido(aero);
              setModal("evidencia-stop");
            } else {
              void registrar(
                { tipo: EVENTO_TIPO.ENTRADA_WTG, maquinaId: aero.id },
                `${etq(EVENTO_TIPO.ENTRADA_WTG)} · ${aero.nombre ?? aero.numero}`,
              );
            }
          }}
        />
      )}
      {modal === "evidencia-stop" && aeroElegido && (
        <ModalEvidencia
          titulo={`STOP · ${aeroElegido.nombre ?? `WTG ${aeroElegido.numero}`}`}
          subtitulo="Sacá una foto de la pantalla con el aero detenido."
          textoOk="Registrar STOP"
          busy={busy}
          onCerrar={() => {
            setAeroElegido(null);
            setModal(null);
          }}
          onConfirmar={(foto) =>
            void registrarConEvidencia(EVENTO_TIPO.ENTRADA_WTG, aeroElegido, foto)
          }
        />
      )}
      {modal === "evidencia-run" && aeroActual && (
        <ModalEvidencia
          titulo={`RUN · ${aeroActual.nombre ?? `WTG ${aeroActual.numero}`}`}
          subtitulo="Inspección terminada: sacá una foto de la pantalla con el aero en marcha."
          textoOk="Registrar RUN"
          busy={busy}
          onCerrar={() => setModal(null)}
          onConfirmar={(foto) =>
            void registrarConEvidencia(EVENTO_TIPO.SALIDA_WTG, aeroActual, foto)
          }
        />
      )}
      {modal === "standby" && (
        <ModalStandby
          busy={busy}
          climaMotivos={climaMotivosDe(asignacion?.pais)}
          onCerrar={() => setModal(null)}
          onConfirmar={(motivo, motivoOtro) =>
            registrar(
              { tipo: EVENTO_TIPO.INICIO_STANDBY, motivo, motivoOtro },
              `${etq(EVENTO_TIPO.INICIO_STANDBY)} · ${STANDBY_MOTIVO_LABEL[motivo]}${
                motivoOtro ? ` · ${motivoOtro}` : ""
              }`,
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
          onOk={() => void cerrar(EVENTO_TIPO.SALIDA_PARQUE)}
        />
      )}
      {modal === "finalizar" && (
        <ModalConfirmar
          peligro
          titulo="Finalizar parque"
          detalle="Cierra el parque por completo y termina la asignación. Volverás a elegir un parque nuevo. Usá esto solo cuando la inspección esté terminada."
          textoOk="Finalizar parque"
          onCerrar={() => setModal(null)}
          onOk={() => void cerrar(EVENTO_TIPO.FINALIZAR_PARQUE)}
        />
      )}
      {modal === "cancelar" && (
        <ModalConfirmar
          titulo="Cambiar de parque"
          detalle="Cancela este parque y volvés a la selección para elegir el correcto. No cierra tu sesión. Disponible solo si todavía no registraste actividad."
          textoOk="Cambiar de parque"
          onCerrar={() => setModal(null)}
          onOk={() => void cancelarParque()}
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

      {/* Post-registro (externo): compartir evidencia y resumen de fin de día. */}
      {compartir && (
        <ModalCompartir
          texto={compartir.texto}
          blob={compartir.blob}
          nombreArchivo={compartir.nombreArchivo}
          onCerrar={() => setCompartir(null)}
        />
      )}
      {resumen && !compartir && (
        <ModalResumenDia
          texto={resumen}
          esFinal={resumenEsFinal}
          onCerrar={() => {
            setResumen(null);
            if (resumenEsFinal) onFinalizado();
          }}
        />
      )}
    </main>
  );
}

// ---------- Modales ----------

function ModalAero({
  aeros,
  inspeccionados,
  onElegir,
  onCerrar,
}: {
  aeros: AeroCache[];
  inspeccionados: Set<string>; // ids ya inspeccionados → fondo verde tenue (no bloquea)
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
                className={`rounded-lg border px-2 py-3 text-sm font-bold transition ${
                  inspeccionados.has(a.id)
                    ? "border-iner-ok/40 bg-iner-ok-50 text-iner-ok hover:bg-iner-ok-50/70" // ya inspeccionada
                    : "border-iner-green/25 bg-white text-iner-green hover:bg-iner-green-50"
                }`}
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
  climaMotivos,
  onConfirmar,
  onCerrar,
}: {
  busy: boolean;
  climaMotivos: ClimaMotivo[]; // sub-lista de Clima según el país
  onConfirmar: (motivo: StandbyMotivo, motivoOtro?: string) => void;
  onCerrar: () => void;
}) {
  const [motivo, setMotivo] = useState<StandbyMotivo | null>(null);
  const [texto, setTexto] = useState("");
  const [clima, setClima] = useState<ClimaMotivo | null>(null);
  const requiereTexto = motivo != null && MOTIVOS_REQUIEREN_TEXTO.includes(motivo);
  const requiereSublista = motivo != null && MOTIVOS_REQUIEREN_SUBLISTA.includes(motivo);
  const puedeConfirmar =
    motivo != null &&
    (!requiereTexto || texto.trim().length > 0) &&
    (!requiereSublista || clima != null);

  function elegirMotivo(m: StandbyMotivo) {
    setMotivo(m);
    setClima(null); // el sub-motivo aplica solo a clima; se resetea al cambiar
  }

  function confirmar() {
    if (!motivo) return;
    // clima → guarda la etiqueta del sub-motivo; otros → el texto libre; resto → nada.
    const detalle = requiereSublista
      ? clima
        ? CLIMA_MOTIVO_LABEL[clima]
        : undefined
      : texto.trim() || undefined;
    onConfirmar(motivo, detalle);
  }

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
            onClick={() => elegirMotivo(m)}
            className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-sm font-semibold transition ${
              motivo === m
                ? "border-iner-green bg-iner-green-50 text-iner-green"
                : "border-black/15 bg-white text-foreground"
            }`}
          >
            <span className="flex items-center gap-2.5">
              {(() => {
                const Icono = STANDBY_MOTIVO_ICON[m];
                return <Icono size={20} className="shrink-0" />;
              })()}
              {STANDBY_MOTIVO_LABEL[m]}
            </span>
            {motivo === m && <span>✓</span>}
          </button>
        ))}
      </div>

      {requiereSublista && (
        <div className="mt-3 space-y-2 border-t border-black/10 pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-iner-gray">Condición de clima</p>
            <button
              type="button"
              onClick={() => {
                setMotivo(null);
                setClima(null);
              }}
              className="text-xs font-semibold text-iner-green underline"
            >
              ← Volver
            </button>
          </div>
          {climaMotivos.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setClima(c)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-sm font-semibold transition ${
                clima === c
                  ? "border-iner-green bg-iner-green-50 text-iner-green"
                  : "border-black/15 bg-white text-foreground"
              }`}
            >
              <span className="flex items-center gap-2.5">
                {(() => {
                  const Icono = CLIMA_MOTIVO_ICON[c];
                  return <Icono size={20} className="shrink-0" />;
                })()}
                {CLIMA_MOTIVO_LABEL[c]}
              </span>
              {clima === c && <span>✓</span>}
            </button>
          ))}
        </div>
      )}

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
        onClick={confirmar}
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
