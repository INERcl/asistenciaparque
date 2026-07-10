// Utilidades de fecha/hora parametrizadas por TZ IANA (ver TZ_POR_PAIS en
// catalogos.ts). Los timestamps se guardan como ISO 8601 con el offset local
// real del instante (según horario de verano), nunca en UTC. La app pasa la TZ
// del país del parque de la asignación activa (PLAN.md B5).

/** TZ por defecto (Chile) para los wrappers deprecados. */
export const TZ_DEFAULT = "America/Santiago";

/** Minutos → "Hh MMm" (ej: 135 → "2h 15m"). */
export function minutosAHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Fecha del día en la TZ dada como "YYYY-MM-DD" (locale sv-SE da ese formato). */
export function fechaHoy(tz: string, date: Date = new Date()): string {
  return date.toLocaleDateString("sv-SE", { timeZone: tz });
}

/** Offset del huso `tz` para un instante, como "-04:00" / "-03:00". */
export function offset(tz: string, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const nombre =
    parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-04:00";
  const match = nombre.match(/GMT([+-]\d{2}:?\d{2})?/);
  if (!match || !match[1]) return "+00:00";
  return match[1].includes(":")
    ? match[1]
    : `${match[1].slice(0, 3)}:${match[1].slice(3)}`;
}

/** Instante actual como ISO 8601 con hora de pared de `tz` y su offset. */
export function ahoraISO(tz: string, date: Date = new Date()): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const g = (t: string) => f.find((p) => p.type === t)?.value;
  let hora = g("hour");
  if (hora === "24") hora = "00";
  return `${g("year")}-${g("month")}-${g("day")}T${hora}:${g("minute")}:${g("second")}${offset(tz, date)}`;
}

/** Hora de pared local "HH:MM" en la TZ dada (para comparar contra un corte). */
export function horaLocal(tz: string, date: Date = new Date()): string {
  return ahoraISO(tz, date).slice(11, 16);
}

// --- Wrappers deprecados (compatibilidad; anclados a Chile) ---------------
/** @deprecated usar `fechaHoy(tz)` con la TZ del país del parque. */
export const fechaHoyChile = (date: Date = new Date()) => fechaHoy(TZ_DEFAULT, date);
/** @deprecated usar `offset(tz)` con la TZ del país del parque. */
export const offsetChile = (date: Date = new Date()) => offset(TZ_DEFAULT, date);
/** @deprecated usar `ahoraISO(tz)` con la TZ del país del parque. */
export const ahoraISOChile = (date: Date = new Date()) => ahoraISO(TZ_DEFAULT, date);
