"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CLIMA_MOTIVO,
  CLIMA_MOTIVO_LABEL,
  type ClimaMotivo,
  type EstadoTurbina,
  EVENTO_TIPO,
  type EventoTipo,
  type Lado,
  MOTIVOS_REQUIEREN_SUBLISTA,
  MOTIVOS_REQUIEREN_TEXTO,
  HORA_SALIDA_ESTABLECIDA,
  PAIS_CONFIG_DEFAULT,
  PALAS,
  type PaisConfig,
  type Pala,
  SALIDA_TEMPRANA_CORTE,
  STANDBY_MOTIVO,
  STANDBY_MOTIVOS,
  STANDBY_MOTIVOS_SIMPLES,
  STANDBY_MOTIVO_LABEL,
  SUBTIPO,
  type StandbyMotivo,
  type Subtipo,
  botonesDe,
  cavidadesFaltantes,
  climaMotivosDe,
  estadoTurbina,
  labelEvento,
  ladosPendientes,
  paisConfigDe,
  palasCompletas,
  usaFotoEvidencia,
} from "@/lib/catalogos";
import {
  encabezadoDia,
  resumenInternoDesdeEventos,
  resumenJornadaDesdeEventos,
  textoEvidencia,
  textoResumenInterno,
  textoResumenJornada,
} from "@/lib/compartir";
import { fechaHoy, horaEstablecidaISO, horaLocal } from "@/lib/tiempo";
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
import {
  type CavidadesPorAero,
  type EventoParaSiembra,
  inspeccionadosDesdeEventos,
  leerAeroActual,
  leerInspeccionados,
  sembrarInspeccionados,
} from "@/lib/offline/inspeccionados";
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
import { ClimaChip } from "./ClimaChip";
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
  | "salida-wtg"
  | "standby"
  | "salida"
  | "salida-opciones"
  | "retiro-standby"
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
  onVerClima,
}: {
  onFinalizado: () => void;
  onLogout: () => void;
  onVerJornadas: () => void;
  onVerClima: () => void;
}) {
  const [asignacion, setAsignacion] = useState<AsignacionCache | null>(null);
  const [subtipo, setSubtipo] = useState<Subtipo | null>(null);
  const [nombreTecnico, setNombreTecnico] = useState<string | null>(null);
  const [verClima, setVerClima] = useState(false); // flag piloto del perfil
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
  // Cavidades inspeccionadas por aero (acumulado de la asignación) → tinte de la
  // grilla (gris/ámbar/verde) y precarga del modal de salida.
  const [cavidades, setCavidades] = useState<CavidadesPorAero>({});

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
      setVerClima(perfil?.ver_clima ?? false);
      setPaisConfig(paisConfigDe(a?.pais ?? perfil?.pais, cfg));
      // Refresca los nombres del equipo (resumen interno) con red, sin depender
      // del re-login. Requiere la RLS 0011 para ver a los compañeros.
      if (perfil && navigator.onLine) void refrescarEquipoMiembros(perfil);
      if (a) {
        const lista = (await leerAeros(a.parque_id)) ?? [];
        setAeros(lista);
        const jornadaId = `${a.id}_${fechaHoy(a.tz)}`;
        setEstado(estadoDesdeEventos(await getTiposJornada(jornadaId)));
        setCavidades(await leerInspeccionados(a.id));
        // Verde compartido: siembra las cavidades que el equipo/técnico YA
        // inspeccionó en ESTE parque (otras asignaciones / histórico), para retomar
        // parciales y no re-inspeccionar. La RLS de equipo (0011/0012) acota lo visible.
        if (navigator.onLine) {
          try {
            const { data: evs } = await createClient()
              .from("eventos")
              .select(
                "tipo, maquina_id, palas, ts_dispositivo, jornada_id, jornadas!inner(parque_id)",
              )
              .eq("jornadas.parque_id", a.parque_id)
              .in("tipo", ["entrada_wtg", "salida_wtg", "salida_parque", "finalizar_parque"])
              .order("ts_dispositivo");
            if (evs) {
              await sembrarInspeccionados(
                a.id,
                inspeccionadosDesdeEventos(evs as unknown as EventoParaSiembra[]),
              );
              setCavidades(await leerInspeccionados(a.id));
            }
          } catch {
            // sin red / sin permiso: se queda con el acumulado local.
          }
        }
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
      // Refresca el acumulado de cavidades (una salida acaba de acreditar palas).
      if (asignacion) {
        void leerInspeccionados(asignacion.id).then(setCavidades);
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
  async function cerrar(
    tipo: EventoTipo,
    opts?: {
      standby?: { motivo: StandbyMotivo; motivoOtro?: string }; // marca un stand-by antes de cerrar
      tsOverride?: string; // hora de la salida (ej. 17:00 establecida, retiro por clima)
    },
  ) {
    if (busy) return; // guarda de reentrada (el stand-by de abajo no pasa por `registrar`)
    // Retiro por clima: marca el stand-by (a la hora actual) antes de la salida.
    // Va directo a registrarEvento — no al wrapper `registrar`— para no chocar con
    // el debounce `busy`. Con la salida a las 17:00, el stand-by cuenta hasta ahí.
    if (opts?.standby) {
      try {
        await registrarEvento({
          tipo: EVENTO_TIPO.INICIO_STANDBY,
          motivo: opts.standby.motivo,
          motivoOtro: opts.standby.motivoOtro,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo registrar el stand-by.");
        return;
      }
    }
    const eventos = asignacion
      ? await leerEventosDetalle(`${asignacion.id}_${fechaHoy(asignacion.tz)}`)
      : [];
    const res = await registrar({ tipo, tsOverride: opts?.tsOverride }, etq(tipo));
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

  /** STOP/RUN del externo: registra el evento. Con foto (Chile) ofrece compartir
   *  la evidencia; con foto=null (Argentina/Naretto) solo registra, sin compartir. */
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
  // Externo con foto (Chile) vs sin foto (Argentina/Naretto: registra directo).
  const externoConFoto = externo && usaFotoEvidencia(asignacion?.pais);

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
        {verClima && <ClimaChip onVer={onVerClima} />}
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
          onClick={() => {
            if (externo && estado.enTurbina) {
              // RUN. Con foto (Chile): modal de evidencia. Sin foto (Argentina):
              // registra directo el cierre del aero abierto.
              if (externoConFoto) setModal("evidencia-run");
              else if (aeroActual)
                void registrarConEvidencia(EVENTO_TIPO.SALIDA_WTG, aeroActual, null);
            } else {
              setModal("aero"); // STOP (elegir aero) o interno (subida)
            }
          }}
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
              onClick={() => {
                // Interno: la salida de máquina confirma las palas (A/B/C) antes de registrar.
                if (!externo && tipo === EVENTO_TIPO.SALIDA_WTG) setModal("salida-wtg");
                else registrar({ tipo }, etq(tipo));
              }}
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
            onClick={() => {
              // Interno con la turbina abierta: resolvé primero la salida de máquina
              // (palas) para no acreditar una turbina entera por error.
              if (!externo && estado.enTurbina) {
                setModal("salida-wtg");
                return;
              }
              // Antes del corte se elige marcar stand-by o salida normal; pasado
              // el corte cierra directo (salida normal).
              const temprana =
                !!asignacion && horaLocal(asignacion.tz) < SALIDA_TEMPRANA_CORTE;
              setModal(temprana ? "salida-opciones" : "salida");
            }}
            className="btn-secondary w-full disabled:opacity-40"
          >
            {etq(EVENTO_TIPO.SALIDA_PARQUE)} · cierra el día
          </button>
          <button
            type="button"
            disabled={busy || !on(EVENTO_TIPO.FINALIZAR_PARQUE)}
            onClick={() => {
              if (!externo && estado.enTurbina) {
                setModal("salida-wtg");
                return;
              }
              setModal("finalizar");
            }}
            className="w-full rounded-lg border border-red-600/40 bg-white px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-40"
          >
            {etq(EVENTO_TIPO.FINALIZAR_PARQUE)} · cierra el parque
          </button>
        </div>
      </div>

      {modal === "aero" && (
        <ModalAero
          aeros={aeros}
          cavidades={cavidades}
          leyenda={!externo}
          onCerrar={() => setModal(null)}
          onElegir={(aero) => {
            if (externoConFoto) {
              // El STOP del externo con foto lleva evidencia antes de registrar.
              setAeroElegido(aero);
              setModal("evidencia-stop");
            } else if (externo) {
              // Externo sin foto (Argentina): registra el STOP directo.
              void registrarConEvidencia(EVENTO_TIPO.ENTRADA_WTG, aero, null);
            } else {
              // Interno: recuerda la turbina abierta para precargar su salida (palas).
              setAeroActual(aero);
              void registrar(
                { tipo: EVENTO_TIPO.ENTRADA_WTG, maquinaId: aero.id },
                `${etq(EVENTO_TIPO.ENTRADA_WTG)} · ${aero.nombre ?? aero.numero}`,
              );
            }
          }}
        />
      )}
      {modal === "salida-wtg" && aeroActual && (
        <ModalSalidaWTG
          aero={aeroActual}
          cavidadesPrevias={cavidades[aeroActual.id] ?? []}
          busy={busy}
          onCerrar={() => setModal(null)}
          onConfirmar={(nuevas) => {
            void registrar(
              {
                tipo: EVENTO_TIPO.SALIDA_WTG,
                maquinaId: aeroActual.id,
                palas: nuevas,
              },
              `${etq(EVENTO_TIPO.SALIDA_WTG)} · ${aeroActual.nombre ?? `WTG ${aeroActual.numero}`}`,
            ).then((res) => {
              if (res) setAeroActual(null);
            });
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
      {modal === "salida-opciones" && (
        <Overlay>
          <h2 className="text-base font-bold">Salida de parque</h2>
          <p className="mt-2 text-sm text-iner-gray">
            Estás saliendo antes de las {SALIDA_TEMPRANA_CORTE}. ¿Cómo la registrás?
          </p>
          <div className="mt-5 space-y-3">
            <button
              type="button"
              onClick={() => setModal("retiro-standby")}
              className="w-full rounded-lg border border-iner-amber bg-iner-amber-50 px-4 py-3 text-sm font-bold text-[#9a6200] transition hover:bg-iner-amber/20"
            >
              Marcar stand-by · cuenta hasta las {HORA_SALIDA_ESTABLECIDA}
            </button>
            <button
              type="button"
              onClick={() => setModal("salida")}
              className="btn-secondary w-full"
            >
              Salida normal · cierra el día
            </button>
            <button
              type="button"
              onClick={() => setModal(null)}
              className="w-full py-1 text-center text-sm text-iner-gray"
            >
              Cancelar
            </button>
          </div>
        </Overlay>
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
      {modal === "retiro-standby" && (
        <ModalStandby
          busy={busy}
          climaMotivos={climaMotivosDe(asignacion?.pais)}
          titulo="Retirarme del parque"
          nota={`El stand-by contará desde ahora hasta la hora de salida establecida (${HORA_SALIDA_ESTABLECIDA}). Indicá el motivo.`}
          textoOk="Registrar retiro"
          onCerrar={() => setModal(null)}
          onConfirmar={(motivo, motivoOtro) =>
            void cerrar(EVENTO_TIPO.SALIDA_PARQUE, {
              standby: { motivo, motivoOtro },
              tsOverride: asignacion
                ? horaEstablecidaISO(asignacion.tz, HORA_SALIDA_ESTABLECIDA)
                : undefined,
            })
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

// Clases de la grilla según el avance de la turbina: gris (sin iniciar),
// ámbar (parcial/pendiente), verde (completa 6/6). Ninguno bloquea la selección.
const CLASE_TURBINA: Record<EstadoTurbina, string> = {
  sin_hacer: "border-iner-green/25 bg-white text-iner-green hover:bg-iner-green-50",
  parcial: "border-iner-amber bg-iner-amber/25 text-[#7a4e00] hover:bg-iner-amber/35", // pendiente = amarillo
  completa: "border-iner-ok/40 bg-iner-ok-50 text-iner-ok hover:bg-iner-ok-50/70", // inspeccionada = verde
};

function ModalAero({
  aeros,
  cavidades,
  leyenda = false, // muestra la leyenda completa/pendiente (solo interna)
  onElegir,
  onCerrar,
}: {
  aeros: AeroCache[];
  cavidades: CavidadesPorAero; // maquina_id → cavidades hechas → tinte de 3 estados
  leyenda?: boolean;
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
          {leyenda && (
            <p className="mb-2 text-center text-[11px] text-iner-gray">
              <span className="text-iner-ok">■</span> completa ·{" "}
              <span className="text-[#7a4e00]">■</span> pendiente
            </p>
          )}
          <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto">
            {filtrados.map((a) => {
              const cavs = cavidades[a.id] ?? [];
              const est = estadoTurbina(cavs);
              const faltan = est === "parcial" ? cavidadesFaltantes(cavs) : [];
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onElegir(a)}
                  className={`flex flex-col items-center rounded-lg border px-2 py-3 text-sm font-bold transition ${CLASE_TURBINA[est]}`}
                >
                  <span>{a.nombre ?? `WTG ${a.numero}`}</span>
                  {faltan.length > 0 && (
                    <span className="mt-0.5 text-[10px] font-medium leading-tight">
                      falta {faltan.join(", ")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </Overlay>
  );
}

// Modo elegido por pala en el modal de salida. "completa" = hizo todo lo pendiente;
// un Lado = ese lado faltó (hizo el otro pendiente); "ninguna" = no hizo nada nuevo.
type ModoPala = "completa" | "ninguna" | Lado;

/** Salida de máquina (interno): confirma qué palas (A/B/C) se completaron. Se tildan
 *  las palas completas; la pala sin tildar indica qué lado (TEC/LEC) faltó. En un
 *  reingreso, lo ya hecho (visitas previas / equipo) viene bloqueado y solo se marca
 *  lo nuevo. Devuelve las cavidades cerradas EN ESTA visita. */
function ModalSalidaWTG({
  aero,
  cavidadesPrevias,
  busy,
  onConfirmar,
  onCerrar,
}: {
  aero: AeroCache;
  cavidadesPrevias: string[];
  busy: boolean;
  onConfirmar: (cavidadesNuevas: string[]) => void;
  onCerrar: () => void;
}) {
  // Lados pendientes de cada pala antes de esta visita (lo hecho no se desmarca).
  const pendientesPorPala = useMemo(
    () =>
      Object.fromEntries(
        PALAS.map((p) => [p, ladosPendientes(p, cavidadesPrevias)]),
      ) as Record<Pala, Lado[]>,
    [cavidadesPrevias],
  );
  const [modo, setModo] = useState<Record<Pala, ModoPala>>(
    () => Object.fromEntries(PALAS.map((p) => [p, "ninguna"])) as Record<Pala, ModoPala>,
  );
  const setPala = (p: Pala, m: ModoPala) => setModo((cur) => ({ ...cur, [p]: m }));

  // Cavidades cerradas en ESTA visita según el modo elegido por pala.
  const cavidadesNuevas = useMemo(() => {
    const out: string[] = [];
    for (const p of PALAS) {
      const pend = pendientesPorPala[p];
      if (pend.length === 0) continue; // ya estaba completa
      const m = modo[p];
      if (m === "completa") out.push(...pend.map((l) => `${p}-${l}`));
      else if (m === "TEC" || m === "LEC") {
        // Faltó ese lado → se hicieron los demás pendientes.
        out.push(...pend.filter((l) => l !== m).map((l) => `${p}-${l}`));
      }
    }
    return out;
  }, [modo, pendientesPorPala]);

  const marcarTodo = () =>
    setModo(
      Object.fromEntries(PALAS.map((p) => [p, "completa"])) as Record<Pala, ModoPala>,
    );

  const previasCompletas = palasCompletas(cavidadesPrevias);
  const faltaTrasSalida = cavidadesFaltantes([...cavidadesPrevias, ...cavidadesNuevas]);
  const quedaCompleta = faltaTrasSalida.length === 0;

  return (
    <Overlay>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-base font-bold">
          Confirmar salida · {aero.nombre ?? `WTG ${aero.numero}`}
        </h2>
        <button type="button" onClick={onCerrar} className="text-sm text-iner-gray">
          Cancelar
        </button>
      </div>
      {previasCompletas.length > 0 && (
        <p className="mb-2 rounded-lg border border-iner-ok/30 bg-iner-ok-50 px-3 py-2 text-xs text-iner-ok">
          Reingreso: pala{previasCompletas.length > 1 ? "s" : ""}{" "}
          {previasCompletas.join(", ")} ya inspeccionada
          {previasCompletas.length > 1 ? "s" : ""}. Completá lo que falta.
        </p>
      )}
      <p className="mb-3 text-sm text-iner-gray">Tocá las palas que completaste.</p>

      <button
        type="button"
        onClick={marcarTodo}
        className="mb-3 w-full rounded-lg border border-iner-green/25 bg-iner-green-50 px-3 py-2 text-sm font-bold text-iner-green transition hover:bg-iner-green-100"
      >
        Las 3 palas completas
      </button>

      <div className="space-y-2">
        {PALAS.map((p) => {
          const pend = pendientesPorPala[p];
          const m = modo[p];
          if (pend.length === 0) {
            return (
              <div
                key={p}
                className="flex items-center gap-2 rounded-xl border border-iner-ok/40 bg-iner-ok-50 px-3 py-3 text-sm font-bold text-iner-ok"
              >
                Pala {p} · ya inspeccionada ✓
              </div>
            );
          }
          const completa = m === "completa";
          return (
            <div key={p} className="rounded-xl border border-black/10 bg-white p-3">
              <button
                type="button"
                onClick={() => setPala(p, completa ? "ninguna" : "completa")}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-bold transition ${
                  completa
                    ? "bg-iner-ok-50 text-iner-ok"
                    : "bg-iner-gray-100 text-foreground hover:bg-iner-gray-100/70"
                }`}
              >
                <span>Pala {p}</span>
                <span>{completa ? "✓ completa" : "marcar completa"}</span>
              </button>
              {!completa && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-iner-gray">¿qué faltó?</span>
                  {pend.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setPala(p, m === l ? "ninguna" : l)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        m === l
                          ? "border-iner-amber bg-iner-amber-50 text-[#9a6200]"
                          : "border-black/15 bg-white text-iner-gray hover:bg-iner-gray-100"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                  {pend.length === 2 && (
                    <button
                      type="button"
                      onClick={() => setPala(p, "ninguna")}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        m === "ninguna"
                          ? "border-iner-amber bg-iner-amber-50 text-[#9a6200]"
                          : "border-black/15 bg-white text-iner-gray hover:bg-iner-gray-100"
                      }`}
                    >
                      las dos
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p
        className={`mt-3 rounded-lg px-3 py-2 text-center text-xs font-semibold ${
          quedaCompleta
            ? "bg-iner-ok-50 text-iner-ok"
            : "bg-iner-amber-50 text-[#9a6200]"
        }`}
      >
        {quedaCompleta
          ? "La turbina queda completa (A · B · C)."
          : `Queda pendiente: ${faltaTrasSalida.join(", ")}`}
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => onConfirmar(cavidadesNuevas)}
        className="btn-primary mt-3 w-full disabled:opacity-40"
      >
        Confirmar salida
      </button>
    </Overlay>
  );
}

function ModalStandby({
  busy,
  climaMotivos,
  titulo = "Motivo del stand-by",
  nota,
  textoOk = "Registrar stand-by",
  onConfirmar,
  onCerrar,
}: {
  busy: boolean;
  climaMotivos: ClimaMotivo[]; // sub-lista de Clima según el país
  titulo?: string;
  nota?: string; // línea de ayuda opcional bajo el título
  textoOk?: string;
  onConfirmar: (motivo: StandbyMotivo, motivoOtro?: string) => void;
  onCerrar: () => void;
}) {
  const [motivo, setMotivo] = useState<StandbyMotivo | null>(null);
  const [texto, setTexto] = useState("");
  const [clima, setClima] = useState<ClimaMotivo | null>(null);
  const [conStop, setConStop] = useState<boolean | null>(null); // clima: ¿con STOP o sin STOP?
  const [extras, setExtras] = useState<Set<StandbyMotivo>>(new Set());
  // Paso actual: "motivo" (lista + extras) o "clima" (condición + con/sin STOP,
  // pantalla aparte para no amontonar todo y romper la vista).
  const [paso, setPaso] = useState<"motivo" | "clima">("motivo");
  const requiereTexto = motivo != null && MOTIVOS_REQUIEREN_TEXTO.includes(motivo);
  const requiereSublista = motivo != null && MOTIVOS_REQUIEREN_SUBLISTA.includes(motivo);
  const puedeConfirmar =
    motivo != null &&
    (!requiereTexto || texto.trim().length > 0) &&
    // Clima exige la condición Y si fue con STOP o sin STOP.
    (!requiereSublista || (clima != null && conStop != null));

  function elegirMotivo(m: StandbyMotivo) {
    setMotivo(m);
    setClima(null); // el sub-motivo aplica solo a clima; se resetea al cambiar
    setConStop(null);
    // Clima abre su propia pantalla; el resto se queda en la lista de motivos.
    setPaso(MOTIVOS_REQUIEREN_SUBLISTA.includes(m) ? "clima" : "motivo");
    // el base no puede estar también como extra
    setExtras((prev) => {
      if (!prev.has(m)) return prev;
      const sig = new Set(prev);
      sig.delete(m);
      return sig;
    });
  }

  function alternarExtra(m: StandbyMotivo) {
    setExtras((prev) => {
      const sig = new Set(prev);
      if (sig.has(m)) sig.delete(m);
      else sig.add(m);
      return sig;
    });
  }

  function confirmar() {
    if (!motivo) return;
    // clima → sub-motivo + con/sin STOP; otros → texto libre; resto → nada.
    const baseDetalle = requiereSublista
      ? clima && conStop != null
        ? `${CLIMA_MOTIVO_LABEL[clima]} ${conStop ? "con STOP" : "sin STOP"}`
        : undefined
      : texto.trim() || undefined;
    // Sin extras: se guarda igual que hoy. Con extras: base (etiqueta o detalle)
    // + cada extra, concatenados en motivo_otro; motivo sigue siendo el base.
    const etiquetasExtra = STANDBY_MOTIVOS_SIMPLES.filter(
      (m) => m !== motivo && extras.has(m),
    ).map((m) => STANDBY_MOTIVO_LABEL[m]);
    const detalle =
      etiquetasExtra.length === 0
        ? baseDetalle
        : [baseDetalle ?? STANDBY_MOTIVO_LABEL[motivo], ...etiquetasExtra].join(" · ");
    onConfirmar(motivo, detalle);
  }

  // Detalle del clima ya elegido (para mostrarlo en la lista de motivos).
  const detalleClima =
    clima != null && conStop != null
      ? `${CLIMA_MOTIVO_LABEL[clima]} · ${conStop ? "con STOP" : "sin STOP"}`
      : null;

  // ---- Paso "clima": solo condición + con/sin STOP (oculta el resto) ----
  if (paso === "clima") {
    return (
      <Overlay>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Condición de clima</h2>
          <button
            type="button"
            onClick={() => {
              setMotivo(null);
              setClima(null);
              setConStop(null);
              setPaso("motivo");
            }}
            className="text-sm text-iner-gray"
          >
            ← Volver
          </button>
        </div>
        <div className="space-y-2">
          {climaMotivos.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setClima(c);
                setConStop(null); // re-elegir con/sin STOP para la nueva condición
              }}
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
        {clima != null && (
          <div className="mt-3 border-t border-black/10 pt-3">
            <p className="mb-2 text-xs font-semibold text-iner-gray">
              ¿La turbina quedó detenida?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: true, label: "Con STOP" },
                { v: false, label: "Sin STOP" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setConStop(o.v)}
                  className={`rounded-lg border px-3 py-3 text-sm font-bold transition ${
                    conStop === o.v
                      ? "border-iner-green bg-iner-green-50 text-iner-green"
                      : "border-black/15 bg-white text-foreground"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          disabled={clima == null || conStop == null}
          onClick={() => setPaso("motivo")}
          className="btn-primary mt-4 w-full disabled:opacity-40"
        >
          Listo
        </button>
      </Overlay>
    );
  }

  // ---- Paso "motivo": lista de motivos + extras + registrar ----
  return (
    <Overlay>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">{titulo}</h2>
        <button type="button" onClick={onCerrar} className="text-sm text-iner-gray">
          Cancelar
        </button>
      </div>
      {nota && <p className="mb-3 text-sm text-iner-gray">{nota}</p>}
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
              <span className="text-left">
                {STANDBY_MOTIVO_LABEL[m]}
                {m === motivo && detalleClima && (
                  <span className="block text-xs font-normal text-iner-gray">{detalleClima}</span>
                )}
              </span>
            </span>
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

      {motivo != null && (
        <div className="mt-3 space-y-2 border-t border-black/10 pt-3">
          <p className="text-xs font-semibold text-iner-gray">Otros motivos (opcional)</p>
          {STANDBY_MOTIVOS_SIMPLES.filter((m) => m !== motivo).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => alternarExtra(m)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-sm font-semibold transition ${
                extras.has(m)
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
              {extras.has(m) && <span>✓</span>}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={!puedeConfirmar || busy}
        onClick={confirmar}
        className="btn-primary mt-4 w-full"
      >
        {textoOk}
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
