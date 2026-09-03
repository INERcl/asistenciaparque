// Nombre del técnico de apoyo Siemens que acompaña la jornada (Siemens Gamesa
// AR/CL, ver esSiemensGamesa en catalogos.ts). Se pregunta una sola vez por
// jornada, al iniciar la primera turbina, y queda editable el resto del día.
// Mismo patrón que aero_actual en inspeccionados.ts.

import { cacheGet, cacheSet } from "./db";

interface TecnicoAcompanante {
  jornadaId: string;
  nombre: string;
}

export async function guardarTecnicoAcompanante(
  jornadaId: string,
  nombre: string,
): Promise<void> {
  await cacheSet(
    "sesion",
    "tecnico_acompanante",
    { jornadaId, nombre } satisfies TecnicoAcompanante,
  );
}

/** Nombre guardado para esa jornada (null si no hay o es de otra jornada). */
export async function leerTecnicoAcompanante(jornadaId: string): Promise<string | null> {
  const t = await cacheGet<TecnicoAcompanante | null>("sesion", "tecnico_acompanante");
  return t && t.jornadaId === jornadaId ? t.nombre : null;
}
