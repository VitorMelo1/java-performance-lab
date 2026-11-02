import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGunzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {StringDecoder} from 'node:string_decoder';

const minimumSeconds = 60;
const minimumPerWindow = 30;

/**
 * Política de exclusão do protocolo 4, declarada antes da coleta.
 *
 * O protocolo 3 abortava a rodada inteira na primeira duração impossível (negativa),
 * de modo que uma amostra ruim em 90.000 removia uma repetição completa. Nos lotes de
 * outubro isso custou duas das três rodadas mvc-resttemplate/db-read a 1000 req/s e
 * deixou n=1 ao lado de n=3, embora as rodadas removidas fossem comuns (p95 de 1,242 e
 * 1,282 ms contra 1,256 ms da que ficou). A exclusão reduziu n sem remover discrepantes.
 *
 * A análise principal agora retira as amostras impossíveis individualmente, dentro de um
 * orçamento fixo e somente quando a métrica nativa http_req_duration do próprio k6
 * registra os mesmos valores, preservando a rodada. Acima do orçamento, ou sem
 * confirmação nativa, a rodada continua rejeitada: aí a medição está quebrada, não é
 * um artefato esparso.
 */
export const maxNegativeCount = 10;
export const maxNegativeFraction = 0.001;

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const position = (sorted.length-1) * fraction;
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)]-sorted[low]) * (position-low);
}

/**
 * Heuristic over completion timestamps, not a test of statistical stationarity.
 * No authoritative scenario-start metadata is assumed. The earliest reconstructed
 * request start can be later than the real schedule start, particularly if initial
 * iterations were dropped. That uncertainty is always included in the result.
 */
export function evaluateStability(points, scheduledSeconds) {
  if (!Number.isFinite(scheduledSeconds) || scheduledSeconds <= 0) {
    throw new TypeError('scheduled_seconds deve ser positivo e finito.');
  }
  if (!Array.isArray(points) || points.some(p => !Number.isFinite(p?.time) ||
      !Number.isFinite(p?.value) || p.value < 0)) {
    throw new TypeError('Amostras devem conter time finito e value não negativo em milissegundos.');
  }
  let start = null;
  for (const point of points) {
    const candidate = point.time-point.value;
    if (start === null || candidate < start) start = candidate;
  }
  const durationMs = scheduledSeconds*1000;
  const end = start === null ? null : start+durationMs;
  const values = [[],[],[]];
  const drainage = [];
  let lastDrainage = end;
  for (const point of points) {
    if (point.time >= end) {
      drainage.push(point.value);
      lastDrainage = Math.max(lastDrainage, point.time);
    } else {
      const index = Math.min(2, Math.floor((point.time-start)/(durationMs/3)));
      values[index].push(point.value);
    }
  }
  const windows = values.map((samples,i) => ({
    window:i+1, from_seconds:i*scheduledSeconds/3, to_seconds:(i+1)*scheduledSeconds/3,
    n:samples.length, p95_ms:percentile(samples, 0.95),
    completions_per_second:samples.length/(scheduledSeconds/3),
  }));
  const enough = scheduledSeconds >= minimumSeconds && windows.every(w => w.n >= minimumPerWindow);
  const p95s = windows.map(w => w.p95_ms);
  const hasEveryWindow = p95s.every(value => value !== null);
  const medianP95 = hasEveryWindow ? percentile(p95s, 0.5) : null;
  const latencySpread = hasEveryWindow ? Math.max(...p95s)-Math.min(...p95s) : null;
  const latencyLimit = medianP95 === null ? null : Math.max(5, 0.2*medianP95);
  const counts = windows.map(w => w.n);
  const medianCount = percentile(counts, 0.5);
  const countSpread = Math.max(...counts)-Math.min(...counts);
  const latencyPassed = hasEveryWindow && latencySpread <= latencyLimit;
  const throughputPassed = medianCount > 0 && countSpread <= 0.1*medianCount;
  return {
    status:!enough ? 'insuficiente' : latencyPassed && throughputPassed ? 'sem_alerta' : 'variacao_detectada',
    heuristic_only:true,
    interpretation:'Triagem temporal; sem_alerta não certifica regime estacionário nem valida o experimento.',
    scheduled_seconds:scheduledSeconds,
    start_epoch_ms:start,
    start_source:'min_completion_minus_wall',
    start_uncertainty:'Início estimado pelo menor (término − duração) observado; sem metadado autoritativo do início. Descartes iniciais podem deslocar as janelas.',
    thresholds:{minimum_seconds:minimumSeconds, minimum_samples_per_window:minimumPerWindow,
      latency_absolute_ms:5, latency_relative_fraction:0.2, completion_count_relative_fraction:0.1},
    sufficient_data:enough,
    windows,
    latency:{median_p95_ms:medianP95, spread_ms:latencySpread, limit_ms:latencyLimit, passed:latencyPassed},
    completion_rate:{median_window_count:medianCount, spread_count:countSpread,
      limit_count:medianCount*0.1, passed:throughputPassed},
    drainage:{n:drainage.length, p95_ms:percentile(drainage,0.95),
      seconds_after_end:start === null ? 0 : (lastDrainage-end)/1000},
  };
}

function checkRow(row) {
  for (const key of ['requests','successful_requests','dropped_iterations']) {
    if (!Number.isSafeInteger(row?.[key]) || row[key] < 0) throw Error(`row.json: ${key} deve ser inteiro não negativo.`);
  }
  for (const key of ['offered_rps','scheduled_seconds']) {
    if (!Number.isFinite(row[key]) || row[key] <= 0) throw Error(`row.json: ${key} deve ser positivo.`);
  }
  if (row.protocol_version >= 3 && (!Number.isFinite(row.elapsed_seconds) ||
      row.elapsed_seconds <= 0 || row.elapsed_seconds > row.scheduled_seconds + 30)) {
    throw Error(`row.json: duração total inválida (${row.elapsed_seconds}s para ${row.scheduled_seconds}s programados). Possível pausa do gerador ou relógio; rodada excluída.`);
  }
  if (row.successful_requests > row.requests) throw Error('row.json: respostas corretas excedem requisições.');
  for (const key of ['invalid_rate','http_error_rate']) {
    if (row[key] !== null && (!Number.isFinite(row[key]) || row[key] < 0 || row[key] > 1)) {
      throw Error(`row.json: ${key} deve estar entre 0 e 1 ou ser null.`);
    }
  }
}

async function readSamples(file, latencyMetric = 'request_wall_ms') {
  const points = [];
  const negative = [];
  const nativeNegative = [];
  let requests = 0;
  let latencySamples = 0;
  let nativeSamples = 0;
  let successSamples = 0;
  let successfulRequests = 0;
  let lines = 0;
  let records = 0;
  let validationError;
  const parseRecord = text => {
    lines++;
    const clean = (lines === 1 ? text.replace(/^\uFEFF/, '') : text).trim();
    if (!clean) return;
    let entry;
    try { entry = JSON.parse(clean); } catch { throw Error(`samples.json.gz: JSON inválido na linha ${lines}.`); }
    if (!entry || !['Metric','Point'].includes(entry.type) || typeof entry.metric !== 'string' || !entry.data) {
      throw Error(`samples.json.gz: registro inválido na linha ${lines}.`);
    }
    records++;
    if (entry.type !== 'Point') return;
    if (entry.metric === latencyMetric) {
      latencySamples++;
      const time = typeof entry.data.time === 'string' ? Date.parse(entry.data.time) : NaN;
      const value = entry.data.value;
      if (!Number.isFinite(time) || !Number.isFinite(value)) {
        throw Error(`samples.json.gz: amostra de duração inválida na linha ${lines}.`);
      }
      // Negativas são contadas aqui e julgadas em reviewNegativeSamples, com orçamento.
      if (value < 0) negative.push({line:lines, value, time:entry.data.time});
      else points.push({time,value});
    } else if (entry.metric === 'http_req_duration') {
      nativeSamples++;
      const value = entry.data.value;
      if (!Number.isFinite(value)) throw Error(`samples.json.gz: métrica nativa inválida na linha ${lines}.`);
      if (value < 0) nativeNegative.push(value);
    } else if (entry.metric === 'successful_requests') {
      const value = entry.data.value;
      if (value !== 0 && value !== 1) throw Error(`samples.json.gz: contador successful_requests inválido na linha ${lines}.`);
      successSamples++;
      successfulRequests += value;
    } else if (entry.metric === 'http_reqs') {
      const value = entry.data.value;
      if (!Number.isSafeInteger(value) || value < 0) throw Error(`samples.json.gz: contagem inválida na linha ${lines}.`);
      requests += value;
    }
  };
  const parseLine = text => {
    try { parseRecord(text); }
    catch (error) {
      // Node 22 may report iterator cleanup's AbortError instead of this error.
      validationError ??= error;
      throw error;
    }
  };
  const decoder = new StringDecoder('utf8');
  try {
    await pipeline(createReadStream(file), createGunzip(), async source => {
      let buffer = '';
      for await (const chunk of source) {
        buffer += decoder.write(chunk);
        let boundary;
        while ((boundary = buffer.indexOf('\n')) !== -1) {
          parseLine(buffer.slice(0,boundary));
          buffer = buffer.slice(boundary+1);
        }
      }
      buffer += decoder.end();
      if (buffer) parseLine(buffer);
    });
  } catch (error) {
    throw validationError ?? error;
  }
  if (!records) throw Error('samples.json.gz vazio: não há registros para verificar.');
  return {points, negative, nativeNegative, requests, latencySamples, nativeSamples, successSamples, successfulRequests, records};
}

/** Aplica o orçamento declarado; lança quando a medição está quebrada, não esparsa. */
function reviewNegativeSamples({negative, nativeNegative, nativeSamples, requests}) {
  const fraction = requests > 0 ? negative.length/requests : 0;
  const review = {
    count:negative.length, fraction,
    max_allowed_count:maxNegativeCount, max_allowed_fraction:maxNegativeFraction,
    policy:'protocolo 4: durações impossíveis são retiradas ponto a ponto, dentro de orçamento declarado antes da coleta, e a rodada é preservada.',
    confirmed_by_native:null, details:negative,
  };
  if (!negative.length) return review;
  if (negative.length > maxNegativeCount || fraction > maxNegativeFraction) {
    throw Error(`samples.json.gz: ${negative.length} de ${requests} durações impossíveis excedem o orçamento (${maxNegativeCount} amostras e ${maxNegativeFraction*100}% das requisições); medição rejeitada em vez de corrigida.`);
  }
  if (!nativeSamples) {
    throw Error('samples.json.gz: durações impossíveis sem http_req_duration para confirmar; medição rejeitada.');
  }
  const ours = negative.map(x => x.value).sort((a,b) => a-b);
  const theirs = [...nativeNegative].sort((a,b) => a-b);
  if (ours.length !== theirs.length || ours.some((value,i) => value !== theirs[i])) {
    throw Error('samples.json.gz: http_req_duration não confirma as durações impossíveis; a métrica própria divergiu do gerador e a medição foi rejeitada.');
  }
  review.confirmed_by_native = true;
  return review;
}

function describe(result) {
  const status = {sem_alerta:'nenhum alerta pela heurística', variacao_detectada:'variação temporal detectada',
    insuficiente:'dados insuficientes para a heurística'}[result.stability.status];
  const lines = [
    `Qualidade da rodada: ${result.variant} / ${result.scenario} / repetição ${result.repetition}.`,
    `Integridade: ${result.integrity.latency_samples} amostras de duração; contagem confere com row.json e http_reqs.`,
    `Carga programada: ${result.delivery.expected_requests} requisições. Observadas: ${result.integrity.row_requests}.`,
    `Carga entregue: ${result.load_delivered ? 'sim' : 'não'}. Requisições não iniciadas: ${result.delivery.dropped_iterations}.`,
    `Respostas inválidas ou falhas: ${result.error_count}.`,
    `Variação ao longo da rodada: ${status}.`,
    'Heurística: três janelas iguais, pelo menos 60 s no total e 30 amostras por janela.',
    'Alerta quando a amplitude dos p95 excede o maior entre 5 ms e 20% da mediana; ou a amplitude das contagens excede 10% da mediana.',
  ];
  if (result.excluded_samples.count) {
    lines.push(`Durações impossíveis retiradas: ${result.excluded_samples.count} de ${result.integrity.row_requests} ` +
      `(${(result.excluded_samples.fraction*100).toFixed(6)}%), confirmadas em http_req_duration. A rodada foi ` +
      `preservada e os percentis vêm das amostras restantes; registre a exclusão ao apresentar a rodada.`);
  }
  const ms = value => value === null ? 'indisponível' : value.toFixed(3) + ' ms';
  lines.push(`Percentis recalculados das amostras brutas: p50=${ms(result.latency.p50_ms)}; ` +
    `p95=${ms(result.latency.p95_ms)}; p99=${ms(result.latency.p99_ms)}.`);
  for (const w of result.stability.windows) {
    lines.push(`Janela ${w.window} (${w.from_seconds.toFixed(1)}–${w.to_seconds.toFixed(1)} s): n=${w.n}; p95=${w.p95_ms === null ? 'indisponível' : w.p95_ms.toFixed(2)+' ms'}.`);
  }
  lines.push(`Conclusões após o fim programado (drenagem): ${result.stability.drainage.n}; analisadas separadamente.`,
    result.stability.start_uncertainty, result.stability.interpretation,
    'A triagem não identifica sozinha a causa de descartes, falhas ou variação. Os dados brutos foram preservados.');
  return lines.join('\n')+'\n';
}

/** Read-only analysis. The CLI, not this function, writes derived reports. */
export async function analyzeRun(folder) {
  let row;
  try { row = JSON.parse((await readFile(join(folder, 'row.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { throw Error(`Não foi possível ler row.json: ${error.message}`, {cause:error}); }
  checkRow(row);
  const metricName = row.latency_metric || 'request_wall_ms';
  const samples = await readSamples(join(folder, 'samples.json.gz'), metricName);
  const {points, latencySamples, requests, records} = samples;
  if (latencySamples !== row.requests || requests !== row.requests) {
    throw Error(`Contagem inconsistente: row.requests=${row.requests}, ${metricName}=${latencySamples}, http_reqs=${requests}.`);
  }
  if (row.protocol_version >= 4) {
    if (samples.nativeSamples !== row.requests) {
      throw Error(`Contagem nativa http_req_duration inconsistente: ${samples.nativeSamples} para ${row.requests} requisições.`);
    }
    if (samples.successSamples !== row.requests || samples.successfulRequests !== row.successful_requests) {
      throw Error(`Contagem de respostas corretas inconsistente: successful_requests bruto=${samples.successfulRequests}, resumo=${row.successful_requests}; amostras=${samples.successSamples}.`);
    }
  }
  const excluded = reviewNegativeSamples(samples);
  const values = points.map(p => p.value);
  // A carga oferecida do aquecimento em degrau não é taxa × duração; o gerador informa
  // expected_requests e o cálculo antigo continua valendo para a medição em taxa fixa.
  const expected = Number.isFinite(row.expected_requests) && row.expected_requests > 0
    ? row.expected_requests : row.offered_rps*row.scheduled_seconds;
  const errorCount = row.requests-row.successful_requests;
  const result = {
    schema_version:3, latency_metric:metricName, timing_basis:row.timing_basis || 'civil_clock_difference',
    variant:row.variant, scenario:row.scenario, repetition:row.repetition,
    integrity:{counts_match:true, row_requests:row.requests, latency_samples:latencySamples,
      analyzed_samples:points.length, raw_http_requests:requests, raw_records:records,
      native_duration_samples:samples.nativeSamples,
      raw_successful_requests:samples.successfulRequests, success_counter_samples:samples.successSamples,
      native_and_success_checked:row.protocol_version>=4},
    excluded_samples:excluded,
    // Autoritativo para o relatório: percentis das amostras brutas analisadas, pela mesma
    // fórmula em toda rodada, tenha havido exclusão de ponto ou não. O resumo do k6 fica
    // registrado ao lado para conferência, não para compor a tabela final.
    latency_basis:'raw_samples_filtered',
    latency:{samples:values.length, p50_ms:percentile(values,0.5), p95_ms:percentile(values,0.95),
      p99_ms:percentile(values,0.99),
      mean_ms:values.length ? values.reduce((sum,x) => sum+x, 0)/values.length : null},
    k6_summary_latency:{p50_ms:row.latency_p50_ms ?? null, p95_ms:row.latency_p95_ms ?? null,
      p99_ms:row.latency_p99_ms ?? null, mean_ms:row.latency_mean_ms ?? null},
    load_delivered:row.dropped_iterations === 0 && row.requests >= expected-1,
    error_count:errorCount,
    has_errors:errorCount > 0 || row.http_error_rate > 0,
    delivery:{expected_requests:expected, dropped_iterations:row.dropped_iterations,
      missing_against_target:Math.max(0,expected-row.requests),
      delivered_fraction:expected > 0 ? row.requests/expected : null,
      boundary_tolerance_requests:1,
      interpretation:'Carga entregue exige zero descartes e contagem observada de pelo menos alvo − 1; tolerância de fronteira do agendamento.'},
    stability:evaluateStability(points, row.scheduled_seconds),
  };
  result.report_pt = describe(result);
  return result;
}
