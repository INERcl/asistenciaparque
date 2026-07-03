"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ESTADO_ASIGNACION } from "@/lib/catalogos";
import {
  guardarAsignacion,
  leerAsignacion,
  leerPerfil,
  limpiarSesion,
} from "@/lib/offline/sesion";
import { CheckIn } from "./_components/CheckIn";
import { Hero } from "./_components/Hero";
import { Login } from "./_components/Login";
import { Onboarding } from "./_components/Onboarding";

type Estado = "cargando" | "login" | "onboarding" | "checkin";

// Gate de navegación (cliente): ¿sesión o perfil cacheado? → ¿asignación activa
// cacheada? → check-in. Offline manda el cache local (login persistente): la
// sesión de Supabase solo se exige cuando hay red.
export default function Page() {
  const [estado, setEstado] = useState<Estado>("cargando");

  const evaluar = useCallback(async () => {
    const supabase = createClient();
    const [perfil, asignacion] = await Promise.all([leerPerfil(), leerAsignacion()]);

    // getSession puede fallar sin red (refresh de un token vencido): eso NUNCA
    // debe botar al login si hay perfil cacheado — la app opera offline y el
    // token se refresca solo al volver la conexión (el sync exige sesión).
    let conSesion = false;
    try {
      conSesion = !!(await supabase.auth.getSession()).data.session;
    } catch {
      // Sin red: decide el cache local.
    }

    const offline = !navigator.onLine;
    if (!conSesion && !(perfil && offline)) {
      // Sin sesión y con red (o sin nada cacheado): hay que loguearse.
      setEstado("login");
      return;
    }
    if (!perfil) {
      // Sesión sin perfil cacheado (p.ej. logout offline que no pudo revocar el
      // token): re-login para rehidratar el perfil, en vez de un onboarding roto.
      setEstado("login");
      return;
    }

    // Revalida la asignación cacheada contra el server (evita quedar en un parque
    // ya finalizado/borrado por fuera). Solo con conexión y solo si el server
    // responde sin error: offline o ante fallo transitorio, se respeta el cache.
    if (asignacion && conSesion && !offline) {
      try {
        const { data: activa, error } = await supabase
          .from("asignaciones")
          .select("id")
          .eq("id", asignacion.id)
          .eq("estado", ESTADO_ASIGNACION.ACTIVA)
          .maybeSingle();
        if (!error && !activa) {
          await guardarAsignacion(null);
          setEstado("onboarding");
          return;
        }
      } catch {
        // Fallo transitorio de red: se respeta el cache.
      }
    }
    setEstado(asignacion ? "checkin" : "onboarding");
  }, []);

  // Escape del onboarding: vuelve al login limpiando la sesión local (aunque el
  // signOut remoto falle sin red, el gate cae en login porque el perfil ya no está).
  const salirAlLogin = useCallback(async () => {
    try {
      await createClient().auth.signOut();
    } catch {
      // Sin conexión: igual se limpia el cache local.
    }
    await limpiarSesion();
    void evaluar();
  }, [evaluar]);

  useEffect(() => {
    void evaluar();
  }, [evaluar]);

  if (estado === "cargando") {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <Hero subtitulo="Cargando…" />
        </div>
      </main>
    );
  }

  if (estado === "login") return <Login onLogged={() => void evaluar()} />;
  if (estado === "onboarding")
    return (
      <Onboarding
        onReady={() => setEstado("checkin")}
        onSalir={() => void salirAlLogin()}
      />
    );
  return (
    <CheckIn
      onFinalizado={() => setEstado("onboarding")}
      onLogout={() => void evaluar()}
    />
  );
}
