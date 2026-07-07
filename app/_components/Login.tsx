"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Pais, type Subtipo } from "@/lib/catalogos";
import { guardarEquipoMiembros, guardarPerfil } from "@/lib/offline/sesion";
import { refrescarEquipoMiembros } from "@/lib/equipo";
import { emailAUsuario, usuarioAEmail } from "@/lib/usuario";
import { Hero } from "./Hero";
import { InstallButton } from "./InstallButton";

export function Login({ onLogged }: { onLogged: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: usuarioAEmail(usuario), // usuario → email sintético (@checkin.iner)
        password,
      });
      if (error) throw error;
      const uid = data.user.id;

      // Perfil: usa la fila existente (subtipo/equipo los precarga el admin). Si no
      // existe, la crea mínima (C9) para satisfacer la FK de jornadas/eventos.
      const { data: perfil } = await supabase
        .from("tecnicos")
        .select("id, nombre, subtipo, pais, equipo_id")
        .eq("id", uid)
        .maybeSingle();

      if (perfil) {
        await guardarPerfil({
          id: perfil.id,
          nombre: perfil.nombre,
          subtipo: perfil.subtipo as Subtipo | null,
          pais: perfil.pais as Pais | null,
          equipo_id: perfil.equipo_id,
        });
        // Nombres del equipo para el resumen interno (solo AR interna tiene equipo).
        await refrescarEquipoMiembros(perfil);
      } else {
        const usuarioNorm = data.user.email
          ? emailAUsuario(data.user.email)
          : usuario.trim().toLowerCase();
        await supabase
          .from("tecnicos")
          .insert({ id: uid, usuario: usuarioNorm, nombre: usuarioNorm });
        await guardarPerfil({
          id: uid,
          nombre: usuarioNorm,
          subtipo: null,
          pais: null,
          equipo_id: null,
        });
        await guardarEquipoMiembros(usuarioNorm);
      }
      onLogged();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Hero subtitulo="Registro de jornadas en parques eólicos" />
        <div className="rounded-b-2xl border border-t-0 border-black/10 bg-white p-6 shadow-sm">
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-iner-gray">
                Usuario
              </label>
              <input
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                className="campo"
                placeholder="nombre.apellido"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-iner-gray">
                Contraseña
              </label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="campo"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <button type="submit" disabled={cargando} className="btn-primary w-full">
              {cargando ? "Ingresando…" : "Ingresar"}
            </button>
          </form>

          <InstallButton />
        </div>

        <p className="mt-4 text-center text-xs text-iner-gray">
          INER · Ingeniería en Energías Renovables
        </p>
      </div>
    </main>
  );
}

function mensajeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid login credentials/i.test(msg)) return "Usuario o contraseña incorrectos.";
  if (/failed to fetch|network/i.test(msg))
    return "Sin conexión: el primer ingreso requiere internet.";
  return msg || "No se pudo iniciar sesión.";
}
