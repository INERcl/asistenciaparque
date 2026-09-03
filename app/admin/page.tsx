import Link from "next/link";
import { PAIS_LABEL, TZ_POR_PAIS, type Pais } from "@/lib/catalogos";
import { ahoraISO } from "@/lib/tiempo";
import { createAdminClient } from "@/lib/supabase/admin";

// Dos vistas de SAP Field Service and Asset Management, distintas entre sí
// (ver OT/image.png y OT/image copy.png) — se replican ambas al pie de la letra:
//
// 1) "Turbine Stoppages": Stop Date/Time (nuestro STOP = entrada_wtg) · Restart
//    Date/Time (nuestro RUN = salida_wtg que cierra esa turbina). Internal/
//    External Reason siempre "N/A" (catálogo de SAP, no lo inferimos).
// 2) "Crear esfuerzo": Hora de inicio · Hora de finalización · Hora de trabajo.
//    OJO: acá "Hora de inicio" NO es el STOP de esta turbina — es el RUN de la
//    turbina ANTERIOR (o la entrada a parque si es la primera del día): el
//    esfuerzo cubre el traslado + la inspección como un solo bloque continuo.
//
// Ambas se arman desde la vista `reporte_externo` (0035_standby_clima_fila_dia_mixto.sql),
// que ya calcula exactamente esto por turbina: `esfuerzo_inicio` (evento anterior),
// `parada_aero` (STOP) y `esfuerzo_final` (RUN que cierra) — no se reimplementa
// la lógica de cadena acá.
//
// Navegación en 4 pasos (País → Empresa → Parque → Turbina) vía links con query
// params — sin JS de cliente, todo server-rendered.

const SIN_EMPRESA = "__sin_empresa__";

interface Parque {
  id: string;
  nombre: string;
  pais: Pais;
  empresa_id: string | null;
  turbinas: number | null;
}
interface Empresa {
  id: string;
  nombre: string;
}
interface Aero {
  id: string;
  numero: number;
  nombre: string | null;
}
interface Fila {
  fecha: string; // YYYY-MM-DD de la jornada
  stop: string; // HH:MM — Stop Date/Time (Turbine Stoppages)
  run: string; // HH:MM o "—" — Restart Date/Time (Turbine Stoppages)
  esfuerzoInicio: string; // HH:MM — Esfuerzo de inicio: RUN de la turbina anterior
  turbinaAnterior: string; // "WTG N" o "Entrada a parque" — de dónde sale esfuerzoInicio, para verificar
  esfuerzoFinal: string; // HH:MM o "—" — Esfuerzo final = mismo valor que `run`
  horaTrabajo: string; // "H:MM" o "—" — duración esfuerzoFinal - esfuerzoInicio
  responsable: string;
}

/** Trae TODOS los parques, incluidos los ya inactivos/finalizados: el panel
 *  admin se usa justo para cargar las OT de parques que ya se terminaron
 *  (`parques.activo=false`), a diferencia del selector del técnico en campo. */
async function cargarParques(): Promise<Parque[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("parques")
    .select("id, nombre, pais, empresa_id, turbinas")
    .order("nombre");
  return (data ?? []) as Parque[];
}

async function cargarEmpresas(): Promise<Empresa[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("empresas").select("id, nombre").order("nombre");
  return (data ?? []) as Empresa[];
}

async function cargarAeros(parqueId: string): Promise<Aero[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("aeros")
    .select("id, numero, nombre")
    .eq("parque_id", parqueId)
    .order("numero");
  return (data ?? []) as Aero[];
}

/** Avance rápido del parque (referencial): turbinas con al menos un STOP
 *  registrado alguna vez, sobre el total. No distingue interna/externa ni
 *  cavidades — es solo contexto para elegir la turbina, no un dato de cierre. */
async function cargarAvanceParque(
  parqueId: string,
  total: number | null,
): Promise<{ inspeccionadas: number; pendientes: number | null }> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("eventos")
    .select("maquina_id, jornadas!inner(parque_id)")
    .eq("jornadas.parque_id", parqueId)
    .eq("tipo", "entrada_wtg")
    .eq("anulado", false);
  const inspeccionadas = new Set((data ?? []).map((e) => e.maquina_id as string)).size;
  return { inspeccionadas, pendientes: total != null ? Math.max(0, total - inspeccionadas) : null };
}

/** Filas de una turbina para las dos vistas SAP, leídas directo de la vista
 *  `reporte_externo` — ya trae `esfuerzo_inicio` (evento anterior: RUN de la
 *  turbina previa o la entrada a parque si es la primera), `parada_aero`
 *  (STOP) y `esfuerzo_final` (RUN que cierra), sin reimplementar la cadena. */
async function cargarFilasTurbina(
  parqueId: string,
  aero: Aero,
  tz: string,
): Promise<Fila[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("reporte_externo")
    .select("fecha, esfuerzo_inicio, parada_aero, esfuerzo_final, tecnico_id")
    .eq("parque_id", parqueId)
    .eq("wtg", aero.numero)
    .order("fecha");
  if (!data || data.length === 0) return [];

  const tecnicoIds = [...new Set(data.map((d) => d.tecnico_id as string))];
  const fechas = [...new Set(data.map((d) => d.fecha as string))];

  const [{ data: tecnicos }, { data: contexto }] = await Promise.all([
    supabase.from("tecnicos").select("id, nombre").in("id", tecnicoIds),
    // Todas las turbinas del mismo parque/técnico esos días, para poder
    // mostrar CUÁL fue "la turbina anterior" detrás de cada esfuerzo_inicio
    // (verificación visual, no solo confiar en el número a ciegas).
    supabase
      .from("reporte_externo")
      .select("fecha, wtg, esfuerzo_final, tecnico_id")
      .eq("parque_id", parqueId)
      .in("fecha", fechas)
      .not("wtg", "is", null),
  ]);
  const nombrePorTecnico = Object.fromEntries(
    (tecnicos ?? []).map((t) => [t.id as string, t.nombre as string]),
  );

  const hhmm = (ts: string | null): string =>
    ts ? ahoraISO(tz, new Date(ts)).slice(11, 16) : "—";
  const duracion = (a: string | null, b: string | null): string => {
    if (!a || !b) return "—";
    const min = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
    if (min < 0) return "—";
    return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
  };
  const turbinaAnteriorDe = (
    fecha: string,
    tecnicoId: string,
    esfuerzoInicio: string | null,
  ): string => {
    if (!esfuerzoInicio) return "—";
    const previa = (contexto ?? []).find(
      (c) =>
        c.fecha === fecha &&
        c.tecnico_id === tecnicoId &&
        c.wtg !== aero.numero &&
        c.esfuerzo_final != null &&
        new Date(c.esfuerzo_final as string).getTime() === new Date(esfuerzoInicio).getTime(),
    );
    return previa ? `WTG ${previa.wtg}` : "Entrada a parque";
  };

  return data
    .map((d) => ({
      fecha: d.fecha as string,
      stop: hhmm(d.parada_aero as string | null),
      run: hhmm(d.esfuerzo_final as string | null),
      esfuerzoInicio: hhmm(d.esfuerzo_inicio as string | null),
      turbinaAnterior: turbinaAnteriorDe(
        d.fecha as string,
        d.tecnico_id as string,
        d.esfuerzo_inicio as string | null,
      ),
      esfuerzoFinal: hhmm(d.esfuerzo_final as string | null),
      horaTrabajo: duracion(
        d.esfuerzo_inicio as string | null,
        d.esfuerzo_final as string | null,
      ),
      responsable: nombrePorTecnico[d.tecnico_id as string] ?? "—",
    }))
    .sort((a, b) => (a.fecha + a.stop).localeCompare(b.fecha + b.stop));
}

// ---------- UI helpers (grid de tarjetas clickeables, sin JS de cliente) ----------

function GrillaOpciones({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{children}</div>;
}

function Tarjeta({
  href,
  titulo,
  detalle,
}: {
  href: string;
  titulo: string;
  detalle?: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col rounded-xl border border-iner-green/20 bg-white px-4 py-4 text-left shadow-sm transition hover:border-iner-green hover:bg-iner-green-50"
    >
      <span className="font-bold text-foreground">{titulo}</span>
      {detalle && <span className="mt-1 text-xs text-iner-gray">{detalle}</span>}
    </Link>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ pais?: string; empresa?: string; parque?: string; aero?: string }>;
}) {
  const {
    pais: paisId,
    empresa: empresaId,
    parque: parqueId,
    aero: aeroId,
  } = await searchParams;

  const [parques, empresas] = await Promise.all([cargarParques(), cargarEmpresas()]);
  const nombreEmpresa = Object.fromEntries(empresas.map((e) => [e.id, e.nombre]));

  const paises = [...new Set(parques.map((p) => p.pais))] as Pais[];
  const pais = paises.find((p) => p === paisId) ?? null;

  const parquesDelPais = pais ? parques.filter((p) => p.pais === pais) : [];
  const empresaIdsDelPais = [...new Set(parquesDelPais.map((p) => p.empresa_id ?? SIN_EMPRESA))];
  const empresa =
    empresaId && empresaIdsDelPais.includes(empresaId) ? empresaId : null;

  const parquesDeEmpresa = empresa
    ? parquesDelPais.filter((p) => (p.empresa_id ?? SIN_EMPRESA) === empresa)
    : [];
  const parqueActual = parquesDeEmpresa.find((p) => p.id === parqueId) ?? null;

  const aeros = parqueActual ? await cargarAeros(parqueActual.id) : [];
  const aeroActual = aeros.find((a) => a.id === aeroId) ?? null;

  const avance = parqueActual
    ? await cargarAvanceParque(parqueActual.id, parqueActual.turbinas)
    : null;
  const filas =
    parqueActual && aeroActual
      ? await cargarFilasTurbina(parqueActual.id, aeroActual, TZ_POR_PAIS[parqueActual.pais])
      : [];

  const hrefPais = (p: string) => `/admin?pais=${p}`;
  const hrefEmpresa = (e: string) => `/admin?pais=${pais}&empresa=${e}`;
  const hrefParque = (pq: string) => `/admin?pais=${pais}&empresa=${empresa}&parque=${pq}`;

  return (
    <div className="space-y-6">
      {/* Breadcrumb: siempre visible, cada paso es clickeable para volver atrás. */}
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-iner-gray">
        <Link href="/admin" className="underline hover:text-iner-green">
          Turbine Stoppages
        </Link>
        {pais && (
          <>
            <span>›</span>
            <Link
              href={hrefPais(pais)}
              className={
                empresa ? "underline hover:text-iner-green" : "font-semibold text-foreground"
              }
            >
              {PAIS_LABEL[pais] ?? pais}
            </Link>
          </>
        )}
        {empresa && (
          <>
            <span>›</span>
            <Link
              href={hrefEmpresa(empresa)}
              className={
                parqueActual ? "underline hover:text-iner-green" : "font-semibold text-foreground"
              }
            >
              {empresa === SIN_EMPRESA ? "Sin empresa" : (nombreEmpresa[empresa] ?? empresa)}
            </Link>
          </>
        )}
        {parqueActual && (
          <>
            <span>›</span>
            <Link
              href={hrefParque(parqueActual.id)}
              className={
                aeroActual ? "underline hover:text-iner-green" : "font-semibold text-foreground"
              }
            >
              {parqueActual.nombre}
            </Link>
          </>
        )}
        {aeroActual && (
          <>
            <span>›</span>
            <span className="font-semibold text-foreground">
              {aeroActual.nombre ?? `WTG ${aeroActual.numero}`}
            </span>
          </>
        )}
      </nav>

      {/* Paso 1: país */}
      {!pais && (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-iner-gray">
            Elegí el país
          </h2>
          <GrillaOpciones>
            {paises.map((p) => (
              <Tarjeta
                key={p}
                href={hrefPais(p)}
                titulo={PAIS_LABEL[p] ?? p}
                detalle={`${parques.filter((x) => x.pais === p).length} parques`}
              />
            ))}
          </GrillaOpciones>
        </section>
      )}

      {/* Paso 2: empresa */}
      {pais && !empresa && (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-iner-gray">
            Elegí la empresa
          </h2>
          <GrillaOpciones>
            {empresaIdsDelPais.map((eid) => (
              <Tarjeta
                key={eid}
                href={hrefEmpresa(eid)}
                titulo={eid === SIN_EMPRESA ? "Sin empresa" : (nombreEmpresa[eid] ?? eid)}
                detalle={`${parquesDelPais.filter((p) => (p.empresa_id ?? SIN_EMPRESA) === eid).length} parques`}
              />
            ))}
          </GrillaOpciones>
        </section>
      )}

      {/* Paso 3: parque */}
      {pais && empresa && !parqueActual && (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-iner-gray">
            Elegí el parque
          </h2>
          <GrillaOpciones>
            {parquesDeEmpresa.map((p) => (
              <Tarjeta
                key={p.id}
                href={hrefParque(p.id)}
                titulo={p.nombre}
                detalle={p.turbinas != null ? `${p.turbinas} WTG` : undefined}
              />
            ))}
          </GrillaOpciones>
        </section>
      )}

      {/* Resumen de avance + paso 4: turbina */}
      {parqueActual && (
        <section className="space-y-4">
          {avance && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-black/10 bg-white p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-foreground">
                  {parqueActual.turbinas ?? "—"}
                </p>
                <p className="text-xs text-iner-gray">Total</p>
              </div>
              <div className="rounded-xl border border-iner-ok/30 bg-iner-ok-50 p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-iner-ok">{avance.inspeccionadas}</p>
                <p className="text-xs text-iner-gray">Inspeccionadas</p>
              </div>
              <div className="rounded-xl border border-iner-amber/40 bg-iner-amber-50 p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-[#9a6200]">
                  {avance.pendientes ?? "—"}
                </p>
                <p className="text-xs text-iner-gray">Pendientes</p>
              </div>
            </div>
          )}

          {!aeroActual && (
            <div>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-iner-gray">
                Elegí la turbina
              </h2>
              {aeros.length === 0 ? (
                <p className="text-sm text-iner-gray">No hay turbinas cargadas para este parque.</p>
              ) : (
                <GrillaOpciones>
                  {aeros.map((a) => (
                    <Tarjeta
                      key={a.id}
                      href={`${hrefParque(parqueActual.id)}&aero=${a.id}`}
                      titulo={a.nombre ?? `WTG ${a.numero}`}
                    />
                  ))}
                </GrillaOpciones>
              )}
            </div>
          )}
        </section>
      )}

      {parqueActual && aeroActual && (
        <section className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">
              {parqueActual.nombre} · {aeroActual.nombre ?? `WTG ${aeroActual.numero}`}
            </h2>
            <Link
              href={hrefParque(parqueActual.id)}
              className="text-xs font-semibold text-iner-gray underline hover:text-iner-green"
            >
              ← Elegir otra turbina
            </Link>
          </div>
          {filas.length === 0 ? (
            <p className="text-sm text-iner-gray">Sin STOP/RUN registrados para esta turbina.</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-black/10">
                <table className="min-w-full text-sm">
                  <thead className="bg-iner-gray-100 text-left">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Fecha</th>
                      <th className="px-3 py-2 font-semibold">Stop Date/Time</th>
                      <th className="px-3 py-2 font-semibold">Restart Date/Time</th>
                      <th className="px-3 py-2 font-semibold">Internal Reason</th>
                      <th className="px-3 py-2 font-semibold">External Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f, i) => (
                      <tr key={i} className="border-t border-black/10">
                        <td className="px-3 py-2">{f.fecha}</td>
                        <td className="px-3 py-2 font-mono">{f.stop}</td>
                        <td className="px-3 py-2 font-mono">{f.run}</td>
                        <td className="px-3 py-2 text-iner-gray">N/A</td>
                        <td className="px-3 py-2 text-iner-gray">N/A</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded-lg border border-black/10">
                <table className="min-w-full text-sm">
                  <thead className="bg-iner-gray-100 text-left">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Responsable</th>
                      <th className="px-3 py-2 font-semibold">Turbina anterior</th>
                      <th className="px-3 py-2 font-semibold">Esfuerzo de inicio</th>
                      <th className="px-3 py-2 font-semibold">Esfuerzo final</th>
                      <th className="px-3 py-2 font-semibold">Hora de trabajo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f, i) => (
                      <tr key={i} className="border-t border-black/10">
                        <td className="px-3 py-2">{f.responsable}</td>
                        <td className="px-3 py-2 text-iner-gray">{f.turbinaAnterior}</td>
                        <td className="px-3 py-2 font-mono">{f.esfuerzoInicio}</td>
                        <td className="px-3 py-2 font-mono">{f.esfuerzoFinal}</td>
                        <td className="px-3 py-2 font-mono">{f.horaTrabajo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
