const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const m = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(`${__dirname}/../lib/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(p => load(p.replace('./', '')), m, m.exports);
  return cache[name] = m.exports;
}
const { resumenJornadaDesdeEventos: resumen, textoResumenJornada: texto } = load('compartir');
const meta = { operador: 'Tomás Caballero', parque: 'PE Calama', fecha: '09/09/2026' };
const e = (tipo, hora, extra = {}) => ({ tipo, ts: `2026-09-09T${hora}:00-03:00`, ...extra });
const clima = { motivo: 'clima', motivoOtro: 'Velocidad del viento sin STOP' };
const eventos = [
  e('entrada_wtg', '09:34', { numero: 8, tecnicoAcompanante: 'Diego rivera' }),
  e('salida_wtg', '10:38'),
  e('entrada_wtg', '10:45', { numero: 9, tecnicoAcompanante: 'Diego rivera' }),
  e('salida_wtg', '11:41'),
  e('entrada_wtg', '11:46', { numero: 10, tecnicoAcompanante: 'Diego rivera' }),
  e('salida_wtg', '12:35'),
  e('inicio_standby', '12:35', clima),
  e('inicio_standby', '14:58', clima),
  e('salida_parque', '17:00', { tsRegistro: '2026-09-09T17:58:51Z' }),
];
const resultado = texto(resumen(eventos, meta));
assert.equal((resultado.match(/Técnico acompañante:/g) || []).length, 1);
assert.match(resultado, /Turbinas inspeccionadas: 3/);
assert.match(resultado, /desde las 12:35 a 17:00/);
assert.match(resultado, /Salida de parque: 17:00 por Clima/);
assert.equal(resumen(eventos, meta).standbys.length, 1);
const normal = [...eventos.slice(0, -1), e('salida_parque', '17:00')];
assert.doesNotMatch(texto(resumen(normal, meta)), /Salida de parque:.* por /);
const explicito = [...eventos.slice(0, -1), e('salida_parque', '17:00', clima)];
assert.match(texto(resumen(explicito, meta)), /Salida de parque: 17:00 por Clima/);
const cambio = eventos.map(x => ({ ...x }));
cambio[2].tecnicoAcompanante = 'Otro técnico';
assert.equal((texto(resumen(cambio, meta)).match(/Técnico acompañante:/g) || []).length, 3);
const pendiente = resumen([e('entrada_wtg', '09:09', { numero: 51 }),
  e('inicio_standby', '09:20', clima), e('salida_parque', '17:00', clima)], meta);
assert.equal(pendiente.turbinas[0].run, '—');
assert.match(texto(pendiente), /Turbinas inspeccionadas: 0/);
assert.match(texto(pendiente), /WTG 51 Clima.*desde las 09:20 a 17:00/);
const abierto = texto(resumen([e('inicio_standby', '12:00', clima)], meta));
assert.match(abierto, /desde las 12:00 a —/);
assert.doesNotMatch(abierto, /Salida de parque:/);
console.log('Pruebas del resumen: OK\n\n' + resultado);
