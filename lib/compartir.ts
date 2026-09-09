// Compartir/copiar del flujo externo: mensaje de evidencia de WhatsApp por
// evento (foto STOP/RUN) y resumen copiable de fin de día.

import {
  EVENTO_TIPO,
  type EventoTipo,
  STANDBY_MOTIVO,
  STANDBY_MOTIVO_LABEL,
  type StandbyMotivo,
  cavidadesFaltantes,
  palasCompletas,
} from "./catalogos";

/** Mensaje de evidencia del evento para compartir por WhatsApp junto a la foto.
 *  Encabezado fijo "INER"; el `*STOP*`/`*RUN*` usa la negrita de WhatsApp.
 *  `tsISO` es el ts local del parque (ahoraISO): la hora/fecha salen por slicing
 *  para respetar la hora de pared del parque aunque el teléfono esté en otra TZ. */
export function textoEvidencia({
  tipo,
  operador,
  parque,
  numeroWtg,
  tsISO,
}: {
  tipo: "stop" | "run";
  operador: string;
  parque: string;
  numeroWtg: number;
  tsISO: string;
}): string {
  const hora = tsISO.slice(11, 16); // HH:MM
  const fecha = `${tsISO.slice(8, 10)}/${tsISO.slice(5, 7)}/${tsISO.slice(0, 4)}`; // DD/MM/YYYY
  return [
    "INER",
    `Operador: ${operador}`,
    `Parque: ${parque}`,
    `*${tipo.toUpperCase()}*`,
    `Turbina: ${numeroWtg}`,
    `Hora: ${hora}`,
    `Fecha: ${fecha}`,
  ].join("\n");
}

export type ModoCompartido = "archivo" | "texto" | "clipboard" | "cancelado";

/** Comparte la evidencia (foto + comando) por el share sheet del sistema
 *  (WhatsApp incluido). Degrada: share con archivo → share solo texto →
 *  clipboard (desktop). Cancelar el share sheet no es un error. */
export async function compartirEvidencia({
  texto,
  blob,
  nombreArchivo,
}: {
  texto: string;
  blob: Blob | null;
  nombreArchivo: string;
}): Promise<ModoCompartido> {
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };
  try {
    if (blob && nav.share && nav.canShare) {
      const file = new File([blob], nombreArchivo, { type: "image/jpeg" });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], text: texto });
        return "archivo";
      }
    }
    if (nav.share) {
      await nav.share({ text: texto });
      return "texto";
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return "cancelado";
    // Share falló por otra razón: cae al clipboard.
  }
  const ok = await copiarTexto(texto);
  if (!ok) throw new Error("No se pudo compartir ni copiar.");
  return "clipboard";
}

/** Copia texto al portapapeles, con fallback para WebViews sin Clipboard API. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = texto;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ---------- Resumen detallado de la jornada (por día) ----------
// Reconstruye el desglose STOP/RUN por turbina, los stand-by (motivo + horario) y
// la salida del parque a partir de los eventos del día. Espejo de la vista SQL
// `reporte_externo` (ver 0001_init.sql): la cadena por aero empareja entrada_wtg
// con la salida siguiente (salida_wtg o un cierre de día/parque).

const SIN_HORA = "—";

/** Evento normalizado (ya con hora de pared del parque) para armar el resumen. */
export interface EventoResumen {
  tipo: EventoTipo | string;
  ts: string; // ISO 8601 local del parque
  tsRegistro?: string | null; // recepción en servidor, para retiros anticipados históricos
  maquinaId?: string | null;
  numero?: number | null; // WTG, si viene embebido (Supabase); si no, lo resuelve resolverWtg
  palas?: string[] | null; // cavidades cerradas en la salida (interno); null = turbina entera
  motivo?: StandbyMotivo | string | null;
  motivoOtro?: string | null;
  tecnicoAcompanante?: string | null; // técnico de apoyo Siemens (entrada_wtg)
}

export interface TurbinaResumen {
  wtg: number | null;
  stop: string; // HH:MM
  run: string; // HH:MM o "—"
  tecnicoAcompanante?: string | null; // técnico de apoyo Siemens (si aplica)
  standbys: StandbyResumen[]; // stand-bys ocurridos DENTRO de esta turbina (STOP→cierre)
}
export interface StandbyResumen {
  etiqueta: string;
  inicio: string; // HH:MM
  fin: string; // HH:MM o "—"
}
export interface ResumenJornada {
  operador: string;
  parque: string;
  fecha: string; // dd/MM/yyyy
  turbinas: TurbinaResumen[];
  standbys: StandbyResumen[];
  salida: string | null; // HH:MM del cierre del día/parque
  motivoSalida?: string | null;
}

const hhmm = (tsISO: string): string => tsISO.slice(11, 16); // HH:MM
const CIERRAN_AERO: (EventoTipo | string)[] = [
  EVENTO_TIPO.SALIDA_WTG,
  EVENTO_TIPO.SALIDA_PARQUE,
  EVENTO_TIPO.FINALIZAR_PARQUE,
];

/** Cierre real de la turbina abierta en `desdeIndice`: busca hacia adelante saltando
 *  cualquier stand-by intercalado (la máquina de estados no permite otro entrada_wtg
 *  en el medio, solo pares inicio/fin de stand-by) hasta el salida_wtg/salida_parque/
 *  finalizar_parque real. Sin esto, un stand-by a mitad de turbina "tapaba" el RUN.
 *  Devuelve también el índice del cierre, para poder ubicar qué stand-bys quedaron
 *  DENTRO de esa ventana (entre el STOP y el cierre) y mostrarlos junto a la turbina. */
function cierreDeAero(
  orden: EventoResumen[],
  desdeIndice: number,
): { evento: EventoResumen; indice: number } | null {
  for (let j = desdeIndice; j < orden.length; j++) {
    if (CIERRAN_AERO.includes(orden[j].tipo)) return { evento: orden[j], indice: j };
  }
  return null;
}

/** Etiqueta del stand-by: "Clima -> Lluvia/llovizna" (sub-motivo en motivoOtro),
 *  el texto libre para "Otros", o la etiqueta del motivo en el resto. */
function etiquetaStandby(motivo?: string | null, motivoOtro?: string | null): string {
  const detalle = motivoOtro?.trim();
  if (motivo === STANDBY_MOTIVO.OTROS) return detalle || "Otros";
  const base = motivo
    ? (STANDBY_MOTIVO_LABEL[motivo as StandbyMotivo] ?? motivo)
    : "Stand-by";
  if (!detalle) return base;
  if (detalle.includes(" · ")) return detalle; // multi-motivo: ya trae base + extras
  return `${base} -> ${detalle}`; // single clima: "Clima -> Viento alto"
}

/** Arma el resumen estructurado de la jornada. `eventos` puede venir sin ordenar;
 *  `resolverWtg` mapea maquina_id → número de WTG cuando el evento no lo trae. */
export function resumenJornadaDesdeEventos(
  eventos: EventoResumen[],
  meta: { operador: string; parque: string; fecha: string },
  resolverWtg?: (maquinaId: string | null | undefined) => number | null,
): ResumenJornada {
  const orden = [...eventos].sort((a, b) => a.ts.localeCompare(b.ts));
  const turbinas: TurbinaResumen[] = [];
  const standbys: StandbyResumen[] = []; // stand-bys sueltos (fuera de cualquier turbina)
  // Ventanas [entradaIdx, cierreIdx) abiertas, para ubicar qué stand-by cae DENTRO
  // de cuál turbina (ver cierreDeAero).
  const ventanas: { entradaIdx: number; cierreIdx: number; turbina: TurbinaResumen }[] = [];
  let salida: string | null = null;
  let motivoSalida: string | null = null;

  for (let i = 0; i < orden.length; i++) {
    const e = orden[i];
    const sig = orden[i + 1];
    if (e.tipo === EVENTO_TIPO.ENTRADA_WTG) {
      const cierre = cierreDeAero(orden, i + 1);
      const wtg = e.numero ?? resolverWtg?.(e.maquinaId) ?? null;
      const turbina: TurbinaResumen = {
        wtg,
        stop: hhmm(e.ts),
        run: cierre?.evento.tipo === EVENTO_TIPO.SALIDA_WTG ? hhmm(cierre.evento.ts) : SIN_HORA,
        tecnicoAcompanante: e.tecnicoAcompanante ?? null,
        standbys: [],
      };
      turbinas.push(turbina);
      if (cierre) ventanas.push({ entradaIdx: i, cierreIdx: cierre.indice, turbina });
    } else if (e.tipo === EVENTO_TIPO.INICIO_STANDBY) {
      const etiqueta = etiquetaStandby(e.motivo, e.motivoOtro);
      // El retiro puede repetir el inicio de un standby que ya estaba abierto.
      const anterior = orden[i - 1];
      if (anterior?.tipo === EVENTO_TIPO.INICIO_STANDBY &&
          etiquetaStandby(anterior.motivo, anterior.motivoOtro) === etiqueta) continue;
      let finIdx = i + 1;
      while (orden[finIdx]?.tipo === EVENTO_TIPO.INICIO_STANDBY &&
             etiquetaStandby(orden[finIdx].motivo, orden[finIdx].motivoOtro) === etiqueta) finIdx++;
      const item: StandbyResumen = {
        etiqueta,
        inicio: hhmm(e.ts),
        fin: orden[finIdx] ? hhmm(orden[finIdx].ts) : SIN_HORA,
      };
      const ventana = ventanas.find((v) => v.entradaIdx < i && i < v.cierreIdx);
      if (ventana) ventana.turbina.standbys.push(item);
      else standbys.push(item);
    } else if (
      e.tipo === EVENTO_TIPO.SALIDA_PARQUE ||
      e.tipo === EVENTO_TIPO.FINALIZAR_PARQUE
    ) {
      salida = hhmm(e.ts);
      motivoSalida = null;
      if (e.tipo === EVENTO_TIPO.SALIDA_PARQUE) {
        if (e.motivo) motivoSalida = etiquetaStandby(e.motivo, e.motivoOtro);
        else if (e.tsRegistro && Date.parse(e.ts) - Date.parse(e.tsRegistro) > 60000 &&
                 orden[i - 1]?.tipo === EVENTO_TIPO.INICIO_STANDBY) {
          // Versiones anteriores fijaban una salida futura sin guardar su motivo.
          motivoSalida = etiquetaStandby(orden[i - 1].motivo, orden[i - 1].motivoOtro);
        }
      }
    }
  }
  return { ...meta, turbinas, standbys, salida, motivoSalida };
}

/** Texto copiable del resumen detallado de la jornada (formato acordado con el equipo). */
export function textoResumenJornada(d: ResumenJornada): string {
  const inspeccionadas = d.turbinas.filter((t) => t.run !== SIN_HORA).length;
  const lineas: string[] = [
    "Iner",
    `Operador: ${d.operador}`,
    `Parque: ${d.parque}`,
    `Turbinas inspeccionadas: ${inspeccionadas}`,
  ];
  let tecnicoAnterior = "";
  for (const t of d.turbinas) {
    lineas.push(`${t.wtg != null ? `WTG ${t.wtg}` : "WTG —"}: STOP: ${t.stop} - RUN: ${t.run}`);
    const tecnico = t.tecnicoAcompanante?.trim().replace(/\s+/g, " ") ?? "";
    const clave = tecnico.toLocaleLowerCase("es");
    if (tecnico && clave !== tecnicoAnterior) lineas.push(`Técnico acompañante: ${tecnico}`);
    tecnicoAnterior = clave;
  }
  // Sección aparte con todos los stand-by del día: los de una turbina llevan su
  // WTG; los sueltos (fuera de cualquier ventana STOP→RUN) van solo con el motivo.
  const hayStandby = d.turbinas.some((t) => t.standbys.length > 0) || d.standbys.length > 0;
  if (hayStandby) {
    lineas.push("Stand-By:");
    for (const t of d.turbinas) {
      for (const s of t.standbys) {
        lineas.push(`WTG ${t.wtg ?? "—"} ${s.etiqueta} desde las ${s.inicio} a ${s.fin}`);
      }
    }
    for (const s of d.standbys) {
      lineas.push(`${s.etiqueta} desde las ${s.inicio} a ${s.fin}`);
    }
  }
  if (d.salida) lineas.push(`Salida de parque: ${d.salida}${d.motivoSalida ? ` por ${d.motivoSalida}` : ""}`);
  lineas.push(`Fecha: ${d.fecha}`);
  return lineas.join("\n");
}

// ---------- Resumen de la jornada INTERNA (Argentina) ----------
// Ciclo por turbina: Traslado → Subida → Salida. El resumen agrupa por WTG, con
// la llegada a subestación y la salida de parque como líneas sueltas. Sin colación.

export interface TurbinaInterna {
  wtg: number | null;
  traslado: string; // HH:MM o "—" (el traslado_maquina previo a la subida)
  subida: string; // HH:MM
  salida: string; // HH:MM o "—"
  palas?: string[] | null; // cavidades cerradas en esta visita; null = turbina entera
  standbys: StandbyInterno[]; // stand-bys ocurridos DENTRO de esta turbina (subida→cierre)
}
export interface StandbyInterno {
  motivo: string; // etiqueta llana (ej. "Viento bajo")
  inicio: string; // HH:MM
  fin: string; // HH:MM o "—"
}
export interface ResumenInterno {
  dia: string; // "Lunes"
  fecha: string; // "6/07"
  parque: string;
  equipo: string;
  llegada: string | null; // HH:MM (llegada a subestación)
  turbinas: TurbinaInterna[];
  standbys: StandbyInterno[];
  salida: string | null; // HH:MM (salida de parque)
}

const DIAS_SEMANA = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

// Línea separadora del resumen interno.
const SEP = "―――――――――――――――――――·――――――――――――――――――――";

/** Encabezado del resumen interno desde "YYYY-MM-DD": { dia: "Lunes", fecha: "6/07" }.
 *  Parsea por componentes (fecha local) para no correr el día por zona horaria. */
export function encabezadoDia(fechaYMD: string): { dia: string; fecha: string } {
  const [y, m, d] = fechaYMD.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return { dia: DIAS_SEMANA[dow] ?? "", fecha: `${d}/${String(m).padStart(2, "0")}` };
}

/** Etiqueta llana del stand-by (sin el prefijo "Clima ->" del externo). */
function motivoStandbyPlano(motivo?: string | null, motivoOtro?: string | null): string {
  return (
    motivoOtro?.trim() ||
    (motivo ? (STANDBY_MOTIVO_LABEL[motivo as StandbyMotivo] ?? motivo) : "Stand-by")
  );
}

/** Arma el resumen interno estructurado. `eventos` puede venir sin ordenar;
 *  `resolverWtg` mapea maquina_id → número de WTG cuando el evento no lo trae. */
export function resumenInternoDesdeEventos(
  eventos: EventoResumen[],
  meta: { dia: string; fecha: string; parque: string; equipo: string },
  resolverWtg?: (maquinaId: string | null | undefined) => number | null,
): ResumenInterno {
  const orden = [...eventos].sort((a, b) => a.ts.localeCompare(b.ts));
  const turbinas: TurbinaInterna[] = [];
  const standbys: StandbyInterno[] = []; // stand-bys sueltos (fuera de cualquier turbina)
  const ventanas: { entradaIdx: number; cierreIdx: number; turbina: TurbinaInterna }[] = [];
  let llegada: string | null = null;
  let salida: string | null = null;
  let ultimoTraslado: string | null = null;

  for (let i = 0; i < orden.length; i++) {
    const e = orden[i];
    const sig = orden[i + 1];
    if (e.tipo === EVENTO_TIPO.ENTRADA_PARQUE) {
      llegada = hhmm(e.ts);
    } else if (e.tipo === EVENTO_TIPO.TRASLADO_MAQUINA) {
      ultimoTraslado = hhmm(e.ts);
    } else if (e.tipo === EVENTO_TIPO.ENTRADA_WTG) {
      const cierre = cierreDeAero(orden, i + 1);
      const wtg = e.numero ?? resolverWtg?.(e.maquinaId) ?? null;
      const turbina: TurbinaInterna = {
        wtg,
        traslado: ultimoTraslado ?? SIN_HORA,
        subida: hhmm(e.ts),
        salida: cierre ? hhmm(cierre.evento.ts) : SIN_HORA,
        palas: cierre?.evento.tipo === EVENTO_TIPO.SALIDA_WTG ? (cierre.evento.palas ?? null) : null,
        standbys: [],
      };
      turbinas.push(turbina);
      if (cierre) ventanas.push({ entradaIdx: i, cierreIdx: cierre.indice, turbina });
      ultimoTraslado = null; // el traslado aplica a una sola subida
    } else if (e.tipo === EVENTO_TIPO.INICIO_STANDBY) {
      const item: StandbyInterno = {
        motivo: motivoStandbyPlano(e.motivo, e.motivoOtro),
        inicio: hhmm(e.ts),
        fin: sig != null ? hhmm(sig.ts) : SIN_HORA,
      };
      const ventana = ventanas.find((v) => v.entradaIdx < i && i < v.cierreIdx);
      if (ventana) ventana.turbina.standbys.push(item);
      else standbys.push(item);
    } else if (
      e.tipo === EVENTO_TIPO.SALIDA_PARQUE ||
      e.tipo === EVENTO_TIPO.FINALIZAR_PARQUE
    ) {
      salida = hhmm(e.ts);
    }
  }
  return { ...meta, llegada, turbinas, standbys, salida };
}

/** Resumen legible de las palas de una turbina: "completo (A · B · C)" o, si quedó
 *  parcial, las palas completas y las cavidades que faltan (ej. "A ✓ · falta B-LEC, C-TEC"). */
function textoPalas(palas: string[]): string {
  const faltan = cavidadesFaltantes(palas);
  if (faltan.length === 0) return "completo (A · B · C)";
  const completas = palasCompletas(palas);
  const partes: string[] = [];
  if (completas.length) partes.push(`${completas.join(", ")} ✓`);
  partes.push(`falta ${faltan.join(", ")}`);
  return partes.join(" · ");
}

/** Texto copiable del resumen de la jornada interna (formato acordado con el equipo). */
export function textoResumenInterno(d: ResumenInterno): string {
  const lineas: string[] = [
    `${d.dia} ${d.fecha}`,
    `Parque: ${d.parque}`,
    `Equipo: ${d.equipo}`,
    SEP,
  ];
  if (d.llegada) lineas.push(`Llegada a subestación: ${d.llegada}`);
  for (const t of d.turbinas) {
    lineas.push(
      `Traslado turbina: ${t.traslado}`,
      `*WTG ${t.wtg ?? "—"}*`,
      `Subida: ${t.subida}`,
      `Salida: ${t.salida}`,
    );
    if (t.palas != null) lineas.push(`Palas: ${textoPalas(t.palas)}`);
  }
  const hayStandby = d.turbinas.some((t) => t.standbys.length > 0) || d.standbys.length > 0;
  if (hayStandby) {
    lineas.push("Stand-By:");
    for (const t of d.turbinas) {
      for (const s of t.standbys) {
        lineas.push(`WTG ${t.wtg ?? "—"} ${s.motivo}`);
      }
    }
    for (const s of d.standbys) {
      lineas.push(s.motivo);
    }
  }
  if (d.salida) lineas.push(SEP, `Salida de Parque: ${d.salida}`);
  return lineas.join("\n");
}
