"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ESTADO_ASIGNACION } from "@/lib/catalogos";
import { guardarAsignacion, leerAsignacion } from "@/lib/offline/sesion";
import { CheckIn } from "./_components/CheckIn";
import { Hero } from "./_components/Hero";
import { Login } from "./_components/Login";
import { Onboarding } from "./_components/Onboarding";

type Estado = "cargando" | "login" | "onboarding" | "checkin";

// Gate de navegación (cliente): ¿sesión? → ¿asignación activa cacheada? → check-in.
// Todo se resuelve local (sesión de Supabase + cache IndexedDB), así arranca offline.
export default function Page() {
  const [estado, setEstado] = useState<Estado>("cargando");

  const evaluar = useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setEstado("login");
        return;
      }
      const asignacion = await leerAsignacion();
      // Revalida la asignación cacheada contra el server (evita quedar en un parque
      // ya finalizado/borrado por fuera). Solo con conexión y solo si el server
      // responde sin error: offline o ante fallo transitorio, se respeta el cache.
      if (asignacion && navigator.onLine) {
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
      }
      setEstado(asignacion ? "checkin" : "onboarding");
    } catch {
      setEstado("login");
    }
  }, []);

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
    return <Onboarding onReady={() => setEstado("checkin")} />;
  return (
    <CheckIn
      onFinalizado={() => setEstado("onboarding")}
      onLogout={() => void evaluar()}
    />
  );
}
