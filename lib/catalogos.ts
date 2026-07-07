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
  [CLIMA_MOTIVO.LLUVIA]: "Lluvia/llovizna",
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
