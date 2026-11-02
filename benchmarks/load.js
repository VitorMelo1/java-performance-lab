import http from 'k6/http';
import {check} from 'k6';
import exec from 'k6/execution';
import {Counter, Rate, Trend} from 'k6/metrics';

const base = __ENV.BASE_URL || 'http://mvc-resttemplate:8080';
const scenario = __ENV.SCENARIO || 'http';
const rate = Number(__ENV.RATE || 100);
const seconds = Number(__ENV.SECONDS || 45);
const delayMs = Number(__ENV.DELAY_MS || 100);
const maxVus = Number(__ENV.MAX_VUS || 500);
const warmup = __ENV.WARMUP === '1';
const successful = new Counter('successful_requests');
const invalid = new Rate('invalid_responses');
const wall = new Trend('request_latency_ms', true);
const goodWall = new Trend('successful_latency_ms', true);
// Protocolo 4: o bloqueio do gerador (fila interna e estabelecimento de conexao) passa a
// ficar visivel ao lado da duracao, e a soma reproduz a latencia observada pelo cliente.
const blockedWall = new Trend('request_blocked_ms', true);
const clientWall = new Trend('client_latency_ms', true);
// Contadores restritos ao plato final do aquecimento: dizem se a aplicacao sustenta a taxa
// alvo ja aquecida, separando "comecou frio" de "esta acima do joelho".
const plateauRequests = new Counter('plateau_requests');
const plateauSuccessful = new Counter('plateau_successful_requests');
const plateauWall = new Trend('plateau_latency_ms', true);

if (!['http', 'db-read', 'db-write', 'upstream', 'orders', 'inventory'].includes(scenario)) throw Error('Cenario invalido');
if (![rate,seconds,maxVus].every(x => Number.isInteger(x) && x > 0)) throw Error('Parametros de carga invalidos');
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 1000) throw Error('Atraso invalido');

// O aquecimento sobe devagar e termina com um plato na taxa alvo. A medicao continua em
// taxa constante, para que a carga oferecida seja exatamente rate x seconds.
//
// O degrau curto de 15 s nao bastava. Na rodada de diagnostico mvc-feign/orders a
// 1000 req/s, a aplicacao fria nao acompanhou a subida: o aquecimento inteiro ficou em
// p50 de 974 ms entregando 413 req/s, nunca atingiu estado estavel, e a medicao comecou
// fria -- o p95 da rodada (672 ms) era inteiramente o primeiro terco, contra 11,8 ms no
// segundo e 23,3 ms no terceiro. Subindo ao longo de 75% da janela, a aplicacao passa pela
// faixa que consegue sustentar, compila e enche os pools antes de chegar ao alvo.
//
// O plato final mede se ela sustenta o alvo ja aquecida: se nao sustentar, a condicao esta
// acima do joelho e isso fica declarado em plateau_delivered_fraction, em vez de aparecer
// depois como cauda fria dentro da janela medida.
const ramping = warmup && seconds >= 30;
const rampSeconds = ramping ? Math.round(seconds * 0.75) : 0;
const plateauSeconds = ramping ? seconds - rampSeconds : 0;
const startRate = Math.max(1, Math.round(rate / 10));
const load = ramping
  ? {executor:'ramping-arrival-rate', startRate, timeUnit:'1s', preAllocatedVUs:maxVus, maxVUs:maxVus,
     gracefulStop:'10s', stages:[{duration:rampSeconds + 's', target:rate},
                                 {duration:plateauSeconds + 's', target:rate}]}
  : {executor:'constant-arrival-rate', rate, timeUnit:'1s', duration:seconds + 's',
     preAllocatedVUs:maxVus, maxVUs:maxVus, gracefulStop:'10s'};
const expectedRequests = ramping
  ? Math.round((startRate + rate) / 2 * rampSeconds + rate * plateauSeconds)
  : rate * seconds;
const plateauExpected = ramping ? rate * plateauSeconds : 0;

export const options = {
  scenarios: {load},
  summaryTrendStats:['avg','min','med','p(95)','p(99)','max'],
  systemTags:['status','method','name','scenario','expected_response'],
  thresholds: {invalid_responses:['rate<0.01'], dropped_iterations:['count==0']},
};

// A escrita grava um valor que varia por iteracao: o UPDATE altera de fato a linha e
// produz nova versao e WAL, em vez de reescrever o mesmo 100 do povoamento inicial.
export function writeStock(iteration) { return 100 + (iteration % 401); }

export default function () {
  const iteration = exec.scenario.iterationInTest;
  const id = (iteration % (scenario === 'orders' || scenario === 'inventory' ? 9999 : 10000)) + 1;
  const requestId = '00000000-0000-4000-8000-' + String(iteration + 1).padStart(12, '0');
  const sql = scenario.startsWith('db-');
  const stock = scenario === 'db-write' ? writeStock(iteration) : 100;
  const path = scenario === 'orders' ? '/api/orders' : scenario === 'inventory' ? '/inventory/' + id : scenario === 'upstream' ? '/catalog/' + id + '?delayMs=' + delayMs :
    (sql ? '/api/products/' + id : '/api/remote/' + id + '?delayMs=' + delayMs);
  const params = {timeout:'8s', redirects:0, tags:{name:scenario}};
  const response = scenario === 'orders'
    ? http.post(base + path, JSON.stringify({requestId, productId:id, quantity:2}), {...params, headers:{'Content-Type':'application/json'}})
    : scenario === 'db-write'
    ? http.put(base + path + '/stock', JSON.stringify({stock}), {...params, headers:{'Content-Type':'application/json'}})
    : http.get(base + path, params);
  const elapsed = response.timings.duration;
  const blocked = response.timings.blocked;
  let body;
  try { body = response.json(); } catch (_) { body = null; }
  const ok = check(response, {
    'status e conteudo corretos': r => scenario === 'orders' ? r.status === 201 && body !== null && body.requestId === requestId &&
      body.productId === id && body.quantity === 2 && body.unitPriceCents === 1000 + id &&
      body.totalCents === 2 * (1000 + id) && body.status === 'RECORDED' : r.status === 200 && body !== null &&
      body.id === id && body.name === 'Produto ' + id && body.priceCents === 1000 + id &&
      (!(sql || scenario === 'inventory') || body.stock === stock)
  });
  wall.add(elapsed);
  blockedWall.add(blocked);
  clientWall.add(elapsed + blocked);
  successful.add(ok ? 1 : 0);
  invalid.add(!ok);
  if (ok) goodWall.add(elapsed);
  // exec.instance pode nao existir em harness de teste; sem ele nao ha plato a contar.
  const sinceStart = exec.instance?.currentTestRunDuration ?? 0;
  if (plateauSeconds > 0 && sinceStart >= rampSeconds * 1000) {
    plateauRequests.add(1);
    plateauWall.add(elapsed);
    if (ok) plateauSuccessful.add(1);
  }
}

export function handleSummary(data) {
  const out = __ENV.OUT_DIR || '/results';
  const metric = (name, key) => data.metrics[name]?.values?.[key] ?? null;
  const elapsedSeconds = data.state.testRunDurationMs / 1000;
  const requests = metric('http_reqs','count');
  const row = {
    protocol_version:4, latency_metric:"request_latency_ms", timing_basis:"k6_http_duration",
    timing_revision:"monotonic-anchor-v1",
    phase:warmup ? 'warmup' : 'measurement',
    variant:__ENV.VARIANT || 'manual', scenario, repetition:Number(__ENV.REPETITION || 1),
    offered_rps:rate, scheduled_seconds:seconds, elapsed_seconds:elapsedSeconds, delay_ms:delayMs,
    // Descreve a forma da carga DESTA execucao, por isso load_shape e nao warmup_shape:
    // a medicao tambem emite esta linha, e o harness guarda a forma do aquecimento num
    // campo separado (warmup_shape) ao montar o result.json.
    load_shape:ramping ? 'ramp75_plateau25' : 'constant',
    ramp_seconds:rampSeconds, plateau_seconds:plateauSeconds,
    expected_requests:expectedRequests,
    plateau_expected_requests:plateauExpected,
    plateau_requests:metric('plateau_requests','count'),
    plateau_successful_requests:metric('plateau_successful_requests','count'),
    plateau_delivered_fraction:plateauExpected > 0
      ? (metric('plateau_requests','count') ?? 0) / plateauExpected : null,
    plateau_p95_ms:metric('plateau_latency_ms','p(95)'),
    max_vus:maxVus, requests, successful_requests:metric('successful_requests','count'),
    completed_rps:metric('http_reqs','rate'),
    successful_rps:elapsedSeconds > 0 ? metric('successful_requests','count') / elapsedSeconds : null,
    delivered_fraction:expectedRequests > 0 && requests !== null ? requests / expectedRequests : null,
    invalid_rate:metric('invalid_responses','rate'), http_error_rate:metric('http_req_failed','rate'),
    dropped_iterations:metric('dropped_iterations','count') ?? 0,
    latency_p50_ms:metric('request_latency_ms','med'), latency_p95_ms:metric('request_latency_ms','p(95)'),
    latency_p99_ms:metric('request_latency_ms','p(99)'), latency_mean_ms:metric('request_latency_ms','avg'),
    successful_p95_ms:metric('successful_latency_ms','p(95)'), successful_p99_ms:metric('successful_latency_ms','p(99)'),
    blocked_p50_ms:metric('request_blocked_ms','med'), blocked_p95_ms:metric('request_blocked_ms','p(95)'),
    blocked_p99_ms:metric('request_blocked_ms','p(99)'),
    client_p95_ms:metric('client_latency_ms','p(95)'), client_p99_ms:metric('client_latency_ms','p(99)'),
    http_p95_ms:metric('http_req_duration','p(95)'), http_blocked_p95_ms:metric('http_req_blocked','p(95)'),
    allocated_vus_max:metric('vus_max','max'),
  };
  return {
    [out + '/summary.json']:JSON.stringify(data,null,2),
    [out + '/row.json']:JSON.stringify(row,null,2),
    stdout:JSON.stringify(row,null,2) + '\n',
  };
}
