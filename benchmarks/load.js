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
const successful = new Counter('successful_requests');
const invalid = new Rate('invalid_responses');
const wall = new Trend('request_wall_ms', true);
const goodWall = new Trend('successful_wall_ms', true);

if (!['http', 'db-read', 'db-write', 'upstream'].includes(scenario)) throw Error('Cenario invalido');
if (![rate,seconds,maxVus].every(x => Number.isInteger(x) && x > 0)) throw Error('Parametros de carga invalidos');
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 1000) throw Error('Atraso invalido');

export const options = {
  scenarios: {load: {executor:'constant-arrival-rate', rate, timeUnit:'1s',
    duration:seconds + 's', preAllocatedVUs:maxVus, maxVUs:maxVus, gracefulStop:'10s'}},
  summaryTrendStats:['avg','min','med','p(95)','p(99)','max'],
  systemTags:['status','method','name','scenario','expected_response'],
  thresholds: {invalid_responses:['rate<0.01'], dropped_iterations:['count==0']},
};

export default function () {
  const id = (exec.scenario.iterationInTest % 10000) + 1;
  const sql = scenario.startsWith('db-');
  const path = scenario === 'upstream' ? '/catalog/' + id + '?delayMs=' + delayMs :
    (sql ? '/api/products/' + id : '/api/remote/' + id + '?delayMs=' + delayMs);
  const params = {timeout:'8s', tags:{name:scenario}};
  const start = Date.now();
  const response = scenario === 'db-write'
    ? http.put(base + path + '/stock', JSON.stringify({stock:100}), {...params, headers:{'Content-Type':'application/json'}})
    : http.get(base + path, params);
  const elapsed = Date.now() - start;
  let body;
  try { body = response.json(); } catch (_) { body = null; }
  const ok = check(response, {
    'status e conteudo corretos': r => r.status === 200 && body !== null &&
      body.id === id && body.name === 'Produto ' + id && body.priceCents === 1000 + id &&
      (!sql || body.stock === 100)
  });
  wall.add(elapsed);
  successful.add(ok ? 1 : 0);
  invalid.add(!ok);
  if (ok) goodWall.add(elapsed);
}

export function handleSummary(data) {
  const out = __ENV.OUT_DIR || '/results';
  const metric = (name, key) => data.metrics[name]?.values?.[key] ?? null;
  const elapsedSeconds = data.state.testRunDurationMs / 1000;
  const row = {
    variant:__ENV.VARIANT || 'manual', scenario, repetition:Number(__ENV.REPETITION || 1),
    offered_rps:rate, scheduled_seconds:seconds, elapsed_seconds:elapsedSeconds, delay_ms:delayMs,
    max_vus:maxVus, requests:metric('http_reqs','count'), successful_requests:metric('successful_requests','count'),
    completed_rps:metric('http_reqs','rate'),
    successful_rps:elapsedSeconds > 0 ? metric('successful_requests','count') / elapsedSeconds : null,
    invalid_rate:metric('invalid_responses','rate'), http_error_rate:metric('http_req_failed','rate'),
    dropped_iterations:metric('dropped_iterations','count') ?? 0,
    wall_p50_ms:metric('request_wall_ms','med'), wall_p95_ms:metric('request_wall_ms','p(95)'),
    wall_p99_ms:metric('request_wall_ms','p(99)'), wall_mean_ms:metric('request_wall_ms','avg'),
    successful_p95_ms:metric('successful_wall_ms','p(95)'), successful_p99_ms:metric('successful_wall_ms','p(99)'),
    http_p95_ms:metric('http_req_duration','p(95)'), http_blocked_p95_ms:metric('http_req_blocked','p(95)'),
    allocated_vus_max:metric('vus_max','max'),
  };
  return {
    [out + '/summary.json']:JSON.stringify(data,null,2),
    [out + '/row.json']:JSON.stringify(row,null,2),
    stdout:JSON.stringify(row,null,2) + '\n',
  };
}

