// Catálogos del modelo de datos. Fuente única para UI, validaciones y la
// `categoria` de la vista SQL `tramos`. Valores del MODELO_RECONCILIADO.md
// (set de eventos reconciliado: sin `reanudar`, sin `inicio_capacitacion`;
// motivos sin `produccion`). Cada botón cierra el segmento anterior.

export const EVENTO_TIPO = {
  ENTRADA_PARQUE: "entrada_parque",
  TRASLADO_MAQUINA: "traslado_maquina",
  ENTRADA_WTG: "entrada_wtg",
  SALIDA_WTG: "salida_wtg",
  INICIO_ALMUERZO: "inicio_almuerzo",
  INICIO_STANDBY: "inicio_standby",
  SALIDA_PARQUE: "salida_parque",
  FINALIZAR_PARQUE: "finalizar_parque",
} as const;
export type EventoTipo = (typeof EVENTO_TIPO)[keyof typeof EVENTO_TIPO];
export const EVENTO_TIPOS = Object.values(EVENTO_TIPO);

export const EVENTO_TIPO_LABEL: Record<EventoTipo, string> = {
  [EVENTO_TIPO.ENTRADA_PARQUE]: "Ingreso a parque",
  [EVENTO_TIPO.TRASLADO_MAQUINA]: "Traslado a máquina",
  [EVENTO_TIPO.ENTRADA_WTG]: "Ingreso a turbina",
  [EVENTO_TIPO.SALIDA_WTG]: "Salida de turbina",
  [EVENTO_TIPO.INICIO_ALMUERZO]: "Almuerzo",
  [EVENTO_TIPO.INICIO_STANDBY]: "Stand-by",
  [EVENTO_TIPO.SALIDA_PARQUE]: "Salida de parque",
  [EVENTO_TIPO.FINALIZAR_PARQUE]: "Finalizar parque",
};

// Cierres terminales (no abren tramo). salida_parque cierra el DÍA (jornada) y
// cuenta la última turbina como inspeccionada; finalizar_parque cierra el PARQUE
// (asignación) y, si la jornada sigue abierta, también la cierra + cuenta la última.
export const EVENTOS_TERMINALES: EventoTipo[] = [
  EVENTO_TIPO.SALIDA_PARQUE,
  EVENTO_TIPO.FINALIZAR_PARQUE,
];

// Eventos que piden número de aerogenerador al registrarse.
export const EVENTOS_CON_MAQUINA = [EVENTO_TIPO.ENTRADA_WTG];

// =====================================================================
// Inspección interna por palas. Cada aerogenerador tiene 3 palas (A, B, C) y
// cada pala 2 lados/cavidades: TEC y LEC → 6 cavidades por turbina. El operador
// interno piensa "por pala", pero cuando una pala queda a medias se registra qué
// lado (TEC/LEC) faltó; por eso el dato se guarda por cavidad (eventos.palas). Una
// turbina está COMPLETA cuando se cubren sus 6 cavidades, uniendo TODAS las visitas
// del equipo/técnico en ese parque. Ver ModalSalidaWTG y 0021_vistas_palas.sql.
// =====================================================================
export const PALAS = ["A", "B", "C"] as const;
export type Pala = (typeof PALAS)[number];

export const LADOS = ["TEC", "LEC"] as const;
export type Lado = (typeof LADOS)[number];

export type Cavidad = `${Pala}-${Lado}`;
/** Las 6 cavidades de un aerogenerador en orden canónico: A-TEC, A-LEC, B-TEC, … */
export const CAVIDADES: Cavidad[] = PALAS.flatMap((p) =>
  LADOS.map((l) => `${p}-${l}` as Cavidad),
);
export const CAVIDADES_POR_TURBINA = CAVIDADES.length; // 6

export type EstadoTurbina = "sin_hacer" | "parcial" | "completa";

/** Estado de una turbina según sus cavidades ya inspeccionadas (acumuladas). */
export function estadoTurbina(
  cavidades: readonly string[] | undefined | null,
): EstadoTurbina {
  const n = new Set(cavidades ?? []).size;
  if (n === 0) return "sin_hacer";
  return n >= CAVIDADES_POR_TURBINA ? "completa" : "parcial";
}

/** Cavidades que faltan para completar la turbina (en orden canónico). */
export function cavidadesFaltantes(
  cavidades: readonly string[] | undefined | null,
): Cavidad[] {
  const hechas = new Set(cavidades ?? []);
  return CAVIDADES.filter((c) => !hechas.has(c));
}

/** Lados de una pala aún pendientes dadas las cavidades ya hechas. */
export function ladosPendientes(
  pala: Pala,
  cavidades: readonly string[] | undefined | null,
): Lado[] {
  const hechas = new Set(cavidades ?? []);
  return LADOS.filter((l) => !hechas.has(`${pala}-${l}`));
}

/** Palas con sus dos lados ya inspeccionados. */
export function palasCompletas(
  cavidades: readonly string[] | undefined | null,
): Pala[] {
  const hechas = new Set(cavidades ?? []);
  return PALAS.filter((p) => LADOS.every((l) => hechas.has(`${p}-${l}`)));
}

export const CATEGORIA = {
  PRODUCTIVO: "productivo",
  TRASLADO: "traslado",
  STAND_BY: "stand_by",
  ALMUERZO: "almuerzo",
} as const;
export type Categoria = (typeof CATEGORIA)[keyof typeof CATEGORIA];

// Categoría del tramo según el evento que lo abre (espejo de la vista SQL `tramos`).
// salida_parque y finalizar_parque son terminales: no abren tramo (placeholder).
export const CATEGORIA_POR_EVENTO: Record<EventoTipo, Categoria> = {
  [EVENTO_TIPO.ENTRADA_PARQUE]: CATEGORIA.TRASLADO,
  [EVENTO_TIPO.TRASLADO_MAQUINA]: CATEGORIA.TRASLADO,
  [EVENTO_TIPO.ENTRADA_WTG]: CATEGORIA.PRODUCTIVO,
  [EVENTO_TIPO.SALIDA_WTG]: CATEGORIA.TRASLADO,
  [EVENTO_TIPO.INICIO_ALMUERZO]: CATEGORIA.ALMUERZO,
  [EVENTO_TIPO.INICIO_STANDBY]: CATEGORIA.STAND_BY,
  [EVENTO_TIPO.SALIDA_PARQUE]: CATEGORIA.STAND_BY, // terminal; no abre tramo
  [EVENTO_TIPO.FINALIZAR_PARQUE]: CATEGORIA.STAND_BY, // terminal; no abre tramo
};

export function categoriaDeEvento(tipo: EventoTipo): Categoria {
  return CATEGORIA_POR_EVENTO[tipo] ?? CATEGORIA.STAND_BY;
}

export const STANDBY_MOTIVO = {
  CLIMA: "clima",
  INDUCCION: "induccion",
  PROGRAMACION_45: "programacion_45",
  TERMINO_PARQUE: "termino_parque",
  DIA_STANDBY: "dia_standby",
  HORA_MAQUINA: "hora_maquina",
  OTROS: "otros",
} as const;
export type StandbyMotivo = (typeof STANDBY_MOTIVO)[keyof typeof STANDBY_MOTIVO];
export const STANDBY_MOTIVOS = Object.values(STANDBY_MOTIVO);

export const STANDBY_MOTIVO_LABEL: Record<StandbyMotivo, string> = {
  [STANDBY_MOTIVO.CLIMA]: "Clima",
  [STANDBY_MOTIVO.INDUCCION]: "Inducción",
  [STANDBY_MOTIVO.PROGRAMACION_45]: "Programación +45min",
  [STANDBY_MOTIVO.TERMINO_PARQUE]: "Término de parque",
  [STANDBY_MOTIVO.DIA_STANDBY]: "Día stand by",
  [STANDBY_MOTIVO.HORA_MAQUINA]: "1 hora de máquina",
  [STANDBY_MOTIVO.OTROS]: "Otros (especificar)",
};

// Motivos que abren un input de texto libre (se guarda en eventos.motivo_otro).
export const MOTIVOS_REQUIEREN_TEXTO: StandbyMotivo[] = [STANDBY_MOTIVO.OTROS];

// Sub-motivos de Clima. "Clima" abre esta segunda lista; el elegido se guarda
// como etiqueta en eventos.motivo_otro (motivo queda 'clima'). Ver ModalStandby.
export const CLIMA_MOTIVO = {
  VIENTO: "viento", // Chile: "Velocidad del viento"
  LLUVIA: "lluvia", // Chile
  NIEBLA: "niebla",
  NIEVE: "nieve",
  GRANIZO: "granizo",
  POCA_LUZ: "poca_luz", // Chile
  TORMENTA: "tormenta", // Argentina (reemplaza lluvia/llovizna)
  VIENTO_ALTO: "viento_alto", // Argentina (Velocidad del viento → alto/bajo)
  VIENTO_BAJO: "viento_bajo", // Argentina
} as const;
export type ClimaMotivo = (typeof CLIMA_MOTIVO)[keyof typeof CLIMA_MOTIVO];
export const CLIMA_MOTIVOS = Object.values(CLIMA_MOTIVO);

export const CLIMA_MOTIVO_LABEL: Record<ClimaMotivo, string> = {
  [CLIMA_MOTIVO.VIENTO]: "Velocidad del viento",
  [CLIMA_MOTIVO.LLUVIA]: "Caída de agua",
  [CLIMA_MOTIVO.NIEBLA]: "Niebla",
  [CLIMA_MOTIVO.NIEVE]: "Nieve",
  [CLIMA_MOTIVO.GRANIZO]: "Granizo",
  [CLIMA_MOTIVO.POCA_LUZ]: "Poca luz",
  [CLIMA_MOTIVO.TORMENTA]: "Tormenta",
  [CLIMA_MOTIVO.VIENTO_ALTO]: "Viento alto",
  [CLIMA_MOTIVO.VIENTO_BAJO]: "Viento bajo",
};

// Motivos que abren una segunda lista de sub-motivos en vez de texto libre.
export const MOTIVOS_REQUIEREN_SUBLISTA: StandbyMotivo[] = [STANDBY_MOTIVO.CLIMA];

// Motivos elegibles como extra en un stand-by (solo etiqueta): excluye los que
// requieren detalle propio (Clima → sub-lista, Otros → texto). Si hace falta ese
// detalle, ese motivo va como base. Ver ModalStandby en CheckIn.tsx.
export const STANDBY_MOTIVOS_SIMPLES: StandbyMotivo[] = STANDBY_MOTIVOS.filter(
  (m) => !MOTIVOS_REQUIEREN_TEXTO.includes(m) && !MOTIVOS_REQUIEREN_SUBLISTA.includes(m),
);

// Hora local del parque (HH:MM) antes de la cual "Salida de parque" ofrece elegir
// entre marcar stand-by (cuenta hasta la hora establecida) o salida normal. De
// este corte en adelante cierra directo (salida normal). Ver CheckIn.tsx.
export const SALIDA_TEMPRANA_CORTE = "16:00";

// Hora de salida establecida (fija global): cuando el operador se retira del
// parque por clima, el stand-by cuenta desde su inicio hasta esta hora, aunque
// se vaya antes. Ver "Retirarme del parque" en CheckIn.tsx y horaEstablecidaISO.
export const HORA_SALIDA_ESTABLECIDA = "17:00";

export const ROL = { TECNICO: "tecnico", ADMIN: "admin" } as const;

export const SUBTIPO = {
  INTERNO: "interno",
  INSPECTOR_EXTERNO: "inspector_externo",
} as const;
export type Subtipo = (typeof SUBTIPO)[keyof typeof SUBTIPO];
export const SUBTIPOS = Object.values(SUBTIPO);

export const SUBTIPO_LABEL: Record<Subtipo, string> = {
  [SUBTIPO.INTERNO]: "Interna",
  [SUBTIPO.INSPECTOR_EXTERNO]: "Externa",
};

export const SUBTIPOS_TECNICO = [
  { id: SUBTIPO.INTERNO, label: "Interna" },
  { id: SUBTIPO.INSPECTOR_EXTERNO, label: "Externa" },
];

// Interno y externo usan el MISMO set de botones (el inspector externo también
// entra/sale de aeros — ver pestaña "03. C. Naretto"). La diferencia interno/externo
// es solo el RUTEO de planilla (interno AR agrupa por equipo; externo por persona) y
// el ANCHO de la planilla (3 WTG interna vs 11 AERO externa), no los eventos.
export function eventosPorSubtipo(_subtipo: Subtipo | null): EventoTipo[] {
  return EVENTO_TIPOS;
}

export const PAIS = {
  ARGENTINA: "argentina",
  CHILE: "chile",
  PERU: "peru",
  URUGUAY: "uruguay",
} as const;
export type Pais = (typeof PAIS)[keyof typeof PAIS];
export const PAISES_IDS = Object.values(PAIS);

export const PAIS_LABEL: Record<Pais, string> = {
  [PAIS.ARGENTINA]: "Argentina",
  [PAIS.CHILE]: "Chile",
  [PAIS.PERU]: "Perú",
  [PAIS.URUGUAY]: "Uruguay",
};

// Sub-lista de Clima por país (los motivos de Argentina difieren de Chile).
const CLIMA_MOTIVOS_AR: ClimaMotivo[] = [
  CLIMA_MOTIVO.TORMENTA,
  CLIMA_MOTIVO.VIENTO_ALTO,
  CLIMA_MOTIVO.VIENTO_BAJO,
  CLIMA_MOTIVO.NIEBLA,
  CLIMA_MOTIVO.NIEVE,
  CLIMA_MOTIVO.GRANIZO,
];
const CLIMA_MOTIVOS_DEFAULT: ClimaMotivo[] = [
  CLIMA_MOTIVO.VIENTO,
  CLIMA_MOTIVO.LLUVIA,
  CLIMA_MOTIVO.NIEBLA,
  CLIMA_MOTIVO.NIEVE,
  CLIMA_MOTIVO.GRANIZO,
  CLIMA_MOTIVO.POCA_LUZ,
];

/** Motivos de clima disponibles según el país del parque (Argentina vs resto). */
export function climaMotivosDe(pais: Pais | null | undefined): ClimaMotivo[] {
  return pais === PAIS.ARGENTINA ? CLIMA_MOTIVOS_AR : CLIMA_MOTIVOS_DEFAULT;
}

/** ¿El inspector externo de este país registra STOP/RUN con foto de evidencia?
 *  Chile sí (foto + compartir por WhatsApp); Argentina (Naretto) no: registra
 *  directo con un botón, sin foto ni compartir. */
export function usaFotoEvidencia(pais: Pais | null | undefined): boolean {
  return pais !== PAIS.ARGENTINA;
}

export const PAISES = [
  { id: PAIS.ARGENTINA, label: "Argentina" },
  { id: PAIS.CHILE, label: "Chile" },
  { id: PAIS.PERU, label: "Perú" },
  { id: PAIS.URUGUAY, label: "Uruguay" },
];

// TZ IANA por país. Centraliza la zona horaria de la fecha de jornada y el
// corte 20:00 de n8n (ver lib/tiempo.ts y PLAN_N8N.md). Espejo de `paises.tz`.
export const TZ_POR_PAIS: Record<Pais, string> = {
  [PAIS.ARGENTINA]: "America/Argentina/Buenos_Aires",
  [PAIS.CHILE]: "America/Santiago",
  [PAIS.PERU]: "America/Lima",
  [PAIS.URUGUAY]: "America/Montevideo",
};

// Config por país (data-driven). Fuente de verdad: tabla `paises` (ver
// supabase/migrations/0004_paises_config.sql). Este mapa es el fallback offline
// y el default cuando no hay config cacheada. Limita qué ve el técnico:
//   permite_interno/externo → flujos disponibles en el país,
//   usa_almuerzo → botón Almuerzo, usa_equipos → agrupación por equipo (AR interna).
export interface PaisConfig {
  permite_interno: boolean;
  permite_externo: boolean;
  usa_almuerzo: boolean;
  usa_equipos: boolean;
}

// Default conservador: solo externo, sin almuerzo ni equipos (Chile/Perú/Uruguay).
export const PAIS_CONFIG_DEFAULT: PaisConfig = {
  permite_interno: false,
  permite_externo: true,
  usa_almuerzo: false,
  usa_equipos: false,
};

export const PAIS_CONFIG: Record<Pais, PaisConfig> = {
  [PAIS.ARGENTINA]: {
    permite_interno: true,
    permite_externo: true,
    usa_almuerzo: true,
    usa_equipos: true,
  },
  [PAIS.CHILE]: PAIS_CONFIG_DEFAULT,
  [PAIS.PERU]: PAIS_CONFIG_DEFAULT,
  [PAIS.URUGUAY]: PAIS_CONFIG_DEFAULT,
};

/** Config del país: usa el override cacheado (desde `paises`), luego el mapa
 *  embebido, luego el default. Nunca falla (offline-first). */
export function paisConfigDe(
  pais: Pais | null | undefined,
  overrides?: Partial<Record<Pais, PaisConfig>> | null,
): PaisConfig {
  if (pais && overrides?.[pais]) return overrides[pais] as PaisConfig;
  if (pais && PAIS_CONFIG[pais]) return PAIS_CONFIG[pais];
  return PAIS_CONFIG_DEFAULT;
}

export const ESTADO_JORNADA = {
  ABIERTA: "abierta",
  CERRADA: "cerrada",
  INCOMPLETA: "incompleta",
  ANULADA: "anulada",
} as const;
export type EstadoJornada = (typeof ESTADO_JORNADA)[keyof typeof ESTADO_JORNADA];
export const ESTADOS_JORNADA = Object.values(ESTADO_JORNADA);

export const ESTADO_ASIGNACION = {
  ACTIVA: "activa",
  FINALIZADA: "finalizada",
} as const;
export type EstadoAsignacion =
  (typeof ESTADO_ASIGNACION)[keyof typeof ESTADO_ASIGNACION];

// Cómo se cerró la jornada (espejo de jornadas.cierre_tipo).
export const CIERRE_TIPO = {
  SALIDA_PARQUE: "salida_parque", // cierre normal del día
  FINALIZAR_PARQUE: "finalizar_parque", // cierre del parque (fin de asignación)
  AUTO_2000: "auto_2000", // cierre automático (corte 20:00)
} as const;
export type CierreTipo = (typeof CIERRE_TIPO)[keyof typeof CIERRE_TIPO];

// =====================================================================
// Vista de check-in parametrizada por subtipo (interno vs externo).
// Mismos eventos de fondo; cambian solo las etiquetas y qué botones se muestran.
// =====================================================================

// Etiquetas del inspector externo (override). Lo no listado usa EVENTO_TIPO_LABEL.
const EVENTO_LABEL_EXTERNO: Partial<Record<EventoTipo, string>> = {
  [EVENTO_TIPO.ENTRADA_PARQUE]: "Llegada a parque",
  [EVENTO_TIPO.ENTRADA_WTG]: "STOP · Parada de aero",
  [EVENTO_TIPO.SALIDA_WTG]: "RUN · Inicio de aero",
};

// Etiquetas de la interna (override). Terminología de campo: llega a la
// subestación, sube/baja de la máquina (con un traslado antes de cada turbina).
const EVENTO_LABEL_INTERNO: Partial<Record<EventoTipo, string>> = {
  [EVENTO_TIPO.ENTRADA_PARQUE]: "Llegada a subestación",
  [EVENTO_TIPO.ENTRADA_WTG]: "Subida a máquina",
  [EVENTO_TIPO.SALIDA_WTG]: "Salida de máquina",
};

/** Etiqueta del botón según el subtipo del técnico. */
export function labelEvento(tipo: EventoTipo, subtipo: Subtipo | null): string {
  if (subtipo === SUBTIPO.INSPECTOR_EXTERNO) {
    return EVENTO_LABEL_EXTERNO[tipo] ?? EVENTO_TIPO_LABEL[tipo];
  }
  return EVENTO_LABEL_INTERNO[tipo] ?? EVENTO_TIPO_LABEL[tipo];
}

// Set de botones por subtipo (destacado = botón grande; directos = grilla).
export interface BotonesConfig {
  destacado: EventoTipo;
  directos: EventoTipo[];
}

export const BOTONES_POR_SUBTIPO: Record<Subtipo, BotonesConfig> = {
  [SUBTIPO.INTERNO]: {
    // Ciclo por turbina: Traslado → Subida (destacado) → Salida. Sin almuerzo.
    destacado: EVENTO_TIPO.ENTRADA_WTG,
    directos: [
      EVENTO_TIPO.ENTRADA_PARQUE,
      EVENTO_TIPO.TRASLADO_MAQUINA,
      EVENTO_TIPO.SALIDA_WTG,
    ],
  },
  [SUBTIPO.INSPECTOR_EXTERNO]: {
    // El destacado alterna STOP/RUN en la UI según haya un aero abierto.
    // Sin almuerzo ni Traslado: el traslado se deriva en la planilla
    // (RUN anterior → STOP siguiente; primer aero: llegada → primer STOP).
    destacado: EVENTO_TIPO.ENTRADA_WTG,
    directos: [EVENTO_TIPO.ENTRADA_PARQUE],
  },
};

export function botonesDe(
  subtipo: Subtipo | null,
  paisConfig: PaisConfig = PAIS_CONFIG_DEFAULT,
): BotonesConfig {
  const base = BOTONES_POR_SUBTIPO[subtipo ?? SUBTIPO.INTERNO];
  // Almuerzo solo donde el país lo usa (hoy Argentina); en el resto no se muestra.
  if (paisConfig.usa_almuerzo) return base;
  return {
    ...base,
    directos: base.directos.filter((t) => t !== EVENTO_TIPO.INICIO_ALMUERZO),
  };
}

/** Columna de `parques` que habilita el catálogo para este subtipo: la interna y
 *  la externa no visitan los mismos parques (ver 0015_parques_por_subtipo.sql). */
export function columnaParquePermitida(
  subtipo: Subtipo | null,
): "permite_interno" | "permite_externo" {
  return subtipo === SUBTIPO.INSPECTOR_EXTERNO ? "permite_externo" : "permite_interno";
}
