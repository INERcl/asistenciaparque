import { guardarEquipoMiembros } from "@/lib/offline/sesion";
import { createClient } from "@/lib/supabase/client";

/** Arma y cachea "Nombre1 - Nombre2" (el que reporta primero) para la línea
 *  "Equipo" del resumen interno. Lee los integrantes del equipo desde `tecnicos`
 *  (requiere red y la RLS 0011 que permite ver a los compañeros de equipo). Sin
 *  equipo deja el propio nombre; sin red/error conserva lo ya cacheado. */
export async function refrescarEquipoMiembros(perfil: {
  id: string;
  nombre: string | null;
  equipo_id: string | null;
}): Promise<void> {
  const propio = perfil.nombre ?? "";
  if (!perfil.equipo_id) {
    await guardarEquipoMiembros(propio || null);
    return;
  }
  try {
    const { data, error } = await createClient()
      .from("tecnicos")
      .select("id, nombre")
      .eq("equipo_id", perfil.equipo_id);
    if (error || !data) return; // conserva el cache previo
    const otros = data
      .filter((m) => m.id !== perfil.id)
      .map((m) => m.nombre)
      .filter((n): n is string => !!n);
    const equipo = [perfil.nombre, ...otros].filter(Boolean).join(" - ");
    await guardarEquipoMiembros(equipo || propio || null);
  } catch {
    // Sin red / error: no pisa lo cacheado.
  }
}
