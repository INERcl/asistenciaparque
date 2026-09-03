"use client";

// Resumen copiable de fin de día. Recibe el texto ya armado (externo: STOP/RUN;
// interno: Traslado/Subida/Salida por WTG). Se muestra tras cerrar el día
// (salida_parque) o el parque (finalizar_parque).

import { useEffect, useState } from "react";
import { copiarTexto } from "@/lib/compartir";
import { Overlay } from "./Overlay";

const SEGUNDOS_DESHACER = 10;

export function ModalResumenDia({
  texto,
  esFinal,
  onCerrar,
  onDeshacer,
}: {
  texto: string;
  esFinal: boolean; // finalizar_parque: al cerrar vuelve al onboarding
  onCerrar: () => void;
  // Solo se pasa para "Salida de parque" (nunca para finalizar_parque): ventana
  // corta para deshacer, tipo "deshacer envío" — no reabre el día más tarde.
  onDeshacer?: () => void;
}) {
  const [copiado, setCopiado] = useState<boolean | null>(null);
  const [segundos, setSegundos] = useState(SEGUNDOS_DESHACER);
  const [deshaciendo, setDeshaciendo] = useState(false);

  useEffect(() => {
    if (!onDeshacer || segundos <= 0) return;
    const id = window.setTimeout(() => setSegundos((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [onDeshacer, segundos]);

  const puedeDeshacer = !!onDeshacer && segundos > 0 && !deshaciendo;

  return (
    <Overlay>
      <h2 className="text-base font-bold">
        {esFinal ? "Parque finalizado" : "Jornada cerrada"}
      </h2>
      <p className="mt-1 text-sm text-iner-gray">
        Copiá el resumen del día para reportarlo.
      </p>
      <pre className="mt-3 max-h-[45vh] overflow-auto rounded-lg bg-iner-gray-100 px-3 py-3 text-sm text-foreground">
        {texto}
      </pre>
      {copiado === false && (
        <p className="mt-2 rounded-lg border border-red-500/30 bg-red-50 px-3 py-2 text-xs text-red-700">
          No se pudo copiar. Mantené apretado el texto para copiarlo a mano.
        </p>
      )}
      {puedeDeshacer && (
        <button
          type="button"
          onClick={async () => {
            setDeshaciendo(true);
            await onDeshacer?.();
          }}
          className="mt-3 w-full rounded-lg border border-iner-amber bg-iner-amber-50 px-3 py-2 text-sm font-bold text-[#9a6200] transition hover:bg-iner-amber/20"
        >
          Deshacer salida ({segundos}s)
        </button>
      )}
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={onCerrar} className="btn-secondary flex-1">
          Cerrar
        </button>
        <button
          type="button"
          onClick={async () => setCopiado(await copiarTexto(texto))}
          className="btn-primary flex-1"
        >
          {copiado ? "✓ Copiado" : "Copiar resumen"}
        </button>
      </div>
    </Overlay>
  );
}
