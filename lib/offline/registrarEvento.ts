// Registro offline de eventos del check-in. Cada botón arma un evento con UUID de
// cliente y hora local del parque, resuelve la jornada del día
// (`{asignacion_id}_{fecha}`) y encola todo en la outbox. Idempotente (PK = UUID).

import {
  CIERRE_TIPO,
  ESTADO_ASIGNACION,
  ESTADO_JORNADA,
  EVENTO_TIPO,
  type EventoTipo,
  type StandbyMotivo,
  categoriaDeEvento,
} from "@/lib/catalogos";
import { ahoraISO, fechaHoy } from "@/lib/tiempo";
import { cacheGet, cacheSet, encolar, fotoEncolar } from "./db";
import { limpiarDetalle, pushEventoDetalle } from "./detalleJornada";
import {
  type EstadoJornada,
  estadoDesdeEventos,
  getTiposJornada,
  pushTipoJornada,
} from "./estado";
import {
  agregarInspeccionado,
  guardarAeroActual,
  leerAeroActual,
  limpiarInspeccionados,
} from "./inspeccionados";
import { guardarAsignacion, leerAsignacion, leerPerfil } from "./sesion";

export interface RegistrarEventoInput {
  tipo: EventoTipo;
  maquinaId?: string; // requerido en entrada_wtg; también en salida_wtg del interno
  palas?: string[]; // cavidades cerradas en esta salida (interno). undefined = turbina entera
  motivo?: StandbyMotivo; // requerido en inicio_standby
  motivoOtro?: string; // texto si motivo = otros
  comentario?: string;
  foto?: Blob; // evidencia JPEG ya comprimida (STOP/RUN del externo)
  tsOverride?: string; // ISO a usar en vez de "ahora" (ej. fin_standby/salida a las 17:00)
}

interface JornadaActiva {
  id: string;
  fecha: string;
  abierta_ts: string;
}

/** Registra un evento (lo encola). Devuelve id, jornada, ts local y estado nuevo. */
export async function registrarEvento(
  input: RegistrarEventoInput,
): Promise<{ id: string; jornadaId: string; ts: string; estado: EstadoJornada }> {
  const perfil = await leerPerfil();
  const asignacion = await leerAsignacion();
  if (!perfil || !asignacion) {
    throw new Error("No hay asignación activa: elegí un parque primero.");
  }

  const ahora = new Date();
  const tz = asignacion.tz;
  const fecha = fechaHoy(tz, ahora);
  // ts = "ahora" salvo override (fin_standby/salida a la hora establecida). El día
  // de la jornada sigue siendo hoy: el override es siempre hoy a una hora fija.
  const ts = input.tsOverride ?? ahoraISO(tz, ahora);
  const jornadaId = `${asignacion.id}_${fecha}`;

  // Guardas sobre la jornada del día (secuencia persistida = fuente de verdad).
  const tiposHoy = await getTiposJornada(jornadaId);
  const estadoHoy = estadoDesdeEventos(tiposHoy);
  // 1) Día ya cerrado → no se generan más eventos ni se reabre la jornada.
  if (estadoHoy.diaCerrado) {
    throw new Error("La jornada de hoy ya está cerrada. Volvé mañana.");
  }
  // 2) La jornada la abre entrada_parque (primer evento del día).
  if (tiposHoy.length === 0 && input.tipo !== EVENTO_TIPO.ENTRADA_PARQUE) {
    throw new Error("Primero registrá el ingreso al parque.");
  }

  // Jornada del día: se crea (y cachea) una sola vez.
  const cacheJornada = await cacheGet<JornadaActiva>("sesion", "jornada_activa");
  const jornada: JornadaActiva =
    cacheJornada && cacheJornada.id === jornadaId
      ? cacheJornada
      : { id: jornadaId, fecha, abierta_ts: ts };
  const esNueva = jornada !== cacheJornada;
  if (esNueva) {
    await cacheSet("sesion", "jornada_activa", jornada);
    await encolar({
      id: jornadaId,
      tabla: "jornadas",
      onConflict: "id",
      payload: payloadJornada(perfil, asignacion, jornada, ESTADO_JORNADA.ABIERTA),
    });
  }

  const id = crypto.randomUUID();
  const fotoPath = input.foto ? `${perfil.id}/${id}.jpg` : null;
  await encolar({
    id,
    tabla: "eventos",
    onConflict: "id",
    payload: {
      id,
      jornada_id: jornadaId,
      tipo: input.tipo,
      categoria: categoriaDeEvento(input.tipo),
      ts_dispositivo: ts,
      maquina_id: input.maquinaId ?? null,
      palas: input.palas ?? null,
      motivo: input.motivo ?? null,
      motivo_otro: input.motivoOtro ?? null,
      comentario: input.comentario ?? null,
      foto_path: fotoPath,
    },
  });
  if (input.foto && fotoPath) {
    await fotoEncolar({ evento_id: id, path: fotoPath, blob: input.foto, creado_ts: ts });
  }

  // Registra el tipo en la secuencia del día (máquina de estados de botones).
  const tipos = await pushTipoJornada(jornadaId, input.tipo);
  // Detalle del día (hora/aero/motivo) para el resumen detallado offline.
  await pushEventoDetalle(jornadaId, {
    tipo: input.tipo,
    ts,
    maquinaId: input.maquinaId ?? null,
    palas: input.palas ?? null,
    motivo: input.motivo ?? null,
    motivoOtro: input.motivoOtro ?? null,
  });

  // Acumulado de inspeccionados por cavidad: la subida abre el aero; la salida lo
  // acredita con las cavidades hechas (interno) o entero (externo/legado). Un cierre
  // de día/parque con el aero abierto lo cuenta entero (caso del externo: STOP sin RUN;
  // el interno resuelve la turbina con ModalSalidaWTG antes de cerrar).
  if (input.tipo === EVENTO_TIPO.ENTRADA_WTG) {
    await guardarAeroActual(jornadaId, input.maquinaId ?? null);
  } else if (input.tipo === EVENTO_TIPO.SALIDA_WTG) {
    const maq = input.maquinaId ?? (await leerAeroActual(jornadaId));
    if (maq) await agregarInspeccionado(asignacion.id, maq, input.palas);
    await guardarAeroActual(jornadaId, null);
  } else if (
    input.tipo === EVENTO_TIPO.SALIDA_PARQUE ||
    input.tipo === EVENTO_TIPO.FINALIZAR_PARQUE
  ) {
    const aeroAbierto = await leerAeroActual(jornadaId);
    if (aeroAbierto) await agregarInspeccionado(asignacion.id, aeroAbierto); // entero
    await guardarAeroActual(jornadaId, null);
  }

  // Cierres: salida_parque cierra el DÍA; finalizar_parque cierra el PARQUE.
  if (input.tipo === EVENTO_TIPO.SALIDA_PARQUE) {
    await cerrarJornada(perfil, asignacion, jornada, CIERRE_TIPO.SALIDA_PARQUE, ts);
  } else if (input.tipo === EVENTO_TIPO.FINALIZAR_PARQUE) {
    await cerrarJornada(perfil, asignacion, jornada, CIERRE_TIPO.FINALIZAR_PARQUE, ts);
    await finalizarAsignacion(perfil, asignacion, ts);
  }

  return { id, jornadaId, ts, estado: estadoDesdeEventos(tipos) };
}

function payloadJornada(
  perfil: { id: string; subtipo: string | null },
  asignacion: { id: string; parque_id: string },
  jornada: JornadaActiva,
  estado: string,
  cierreTipo?: string,
  cerradaTs?: string,
): Record<string, unknown> {
  return {
    id: jornada.id,
    asignacion_id: asignacion.id,
    tecnico_id: perfil.id,
    parque_id: asignacion.parque_id,
    fecha: jornada.fecha,
    subtipo: perfil.subtipo,
    estado,
    cierre_tipo: cierreTipo ?? null,
    abierta_ts: jornada.abierta_ts,
    cerrada_ts: cerradaTs ?? null,
  };
}

async function cerrarJornada(
  perfil: { id: string; subtipo: string | null },
  asignacion: { id: string; parque_id: string },
  jornada: JornadaActiva,
  cierreTipo: string,
  ts: string,
): Promise<void> {
  await encolar(
    {
      id: jornada.id,
      tabla: "jornadas",
      onConflict: "id",
      payload: payloadJornada(
        perfil,
        asignacion,
        jornada,
        ESTADO_JORNADA.CERRADA,
        cierreTipo,
        ts,
      ),
    },
    true, // sobrescribe la jornada abierta con su estado cerrado
  );
  // No se anula `jornada_activa`: la guarda `diaCerrado` (secuencia del día) impide
  // reabrir/regenerar la jornada, y así conservamos su `abierta_ts` original.
}

async function finalizarAsignacion(
  perfil: { id: string },
  asignacion: { id: string; parque_id: string; inicio_ts: string },
  ts: string,
): Promise<void> {
  await encolar(
    {
      id: asignacion.id,
      tabla: "asignaciones",
      onConflict: "id",
      payload: {
        id: asignacion.id,
        tecnico_id: perfil.id,
        parque_id: asignacion.parque_id,
        estado: ESTADO_ASIGNACION.FINALIZADA,
        inicio_ts: asignacion.inicio_ts,
        fin_ts: ts,
      },
    },
    true,
  );
  // Vuelve a onboarding: limpia asignación activa y el estado del día cacheados.
  // El snapshot del resumen del externo se toma ANTES de registrar el cierre.
  await guardarAsignacion(null);
  await cacheSet("sesion", "jornada_activa", null);
  await cacheSet("sesion", "jornada_eventos", null);
  await limpiarDetalle();
  await limpiarInspeccionados(asignacion.id);
  await cacheSet("sesion", "aero_actual", null);
}
