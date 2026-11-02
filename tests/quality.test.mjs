import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {analyzeRun, evaluateStability} from '../benchmarks/quality.mjs';

const epoch = Date.UTC(2026, 8, 28, 12);
function observations(values = [10, 10, 10], counts = [100, 100, 100]) {
  return counts.flatMap((n, w) => Array.from({length:n}, (_, i) => ({
    time:epoch + w * 20000 + 10 + i * 19000 / n, value:values[w],
  })));
}

test('constant latency and completion rate raise no temporal warning', () => {
  const points = observations();
  const before = structuredClone(points);
  const result = evaluateStability(points, 60);
  assert.equal(result.status, 'sem_alerta');
  assert.deepEqual(result.windows.map(w => w.n), [100, 100, 100]);
  assert.deepEqual(result.windows.map(w => w.p95_ms), [10, 10, 10]);
  assert.deepEqual(points, before);
  assert.equal(result.start_source, 'min_completion_minus_wall');
});

test('empty and short measurements cannot establish temporal stability', () => {
  assert.equal(evaluateStability([], 60).status, 'insuficiente');
  assert.equal(evaluateStability(observations(), 45).status, 'insuficiente');
  assert.equal(evaluateStability(observations([10,10,10], [100,29,100]), 60).status, 'insuficiente');
});

test('latency drift raises a warning', () => {
  const result = evaluateStability(observations([10,10,80]), 60);
  assert.equal(result.status, 'variacao_detectada');
  assert.equal(result.latency.passed, false);
  assert.equal(result.completion_rate.passed, true);
});

test('intermediate latency spike is detected even when first and last windows match', () => {
  assert.equal(evaluateStability(observations([10,80,10]), 60).status, 'variacao_detectada');
});

test('completion rate variation raises a warning with unchanged latency', () => {
  const result = evaluateStability(observations([10,10,10], [100,65,100]), 60);
  assert.equal(result.status, 'variacao_detectada');
  assert.equal(result.latency.passed, true);
  assert.equal(result.completion_rate.passed, false);
});

test('post-schedule completions are drainage and do not distort temporal windows', () => {
  const points = [...observations(), {time:epoch + 62000, value:5000}];
  const result = evaluateStability(points, 60);
  assert.equal(result.status, 'sem_alerta');
  assert.equal(result.drainage.n, 1);
  assert.equal(result.drainage.p95_ms, 5000);
  assert.equal(result.drainage.seconds_after_end, 2);
  assert.equal(result.windows.reduce((n,w) => n+w.n, 0), 300);
});

test('near-zero latency uses an absolute tolerance without division by zero', () => {
  const result = evaluateStability(observations([0,0.001,0.01]), 60);
  assert.equal(result.status, 'sem_alerta');
  assert.equal(result.latency.limit_ms, 5);
  assert.ok(Number.isFinite(result.latency.spread_ms));
});

test('invalid points and non-positive duration are rejected', () => {
  assert.throws(() => evaluateStability([{time:NaN,value:10}], 60));
  assert.throws(() => evaluateStability([{time:epoch,value:-1}], 60));
  assert.throws(() => evaluateStability([], 0));
});

async function fixture(t, {points=observations(), row={}, bom=false, records=null} = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'java-quality-'));
  t.after(() => rm(folder, {recursive:true, force:true}));
  const details = {variant:'test', scenario:'http', repetition:1, offered_rps:5,
    scheduled_seconds:60, requests:points.length, successful_requests:points.length,
    invalid_rate:0, http_error_rate:0, dropped_iterations:0, ...row};
  const raw = records ?? points.flatMap(p => [
    {type:'Point', metric:'request_wall_ms', data:{time:new Date(p.time).toISOString(), value:p.value}},
    {type:'Point', metric:'http_reqs', data:{time:new Date(p.time).toISOString(), value:1}},
  ]);
  await writeFile(join(folder, 'row.json'), (bom?'\ufeff':'') + JSON.stringify(details));
  await writeFile(join(folder, 'samples.json.gz'), gzipSync((bom?'\ufeff':'') + raw.map(x => JSON.stringify(x)).join('\n')));
  return folder;
}

test('analyzes real gzip JSONL with UTF-8 BOM without modifying raw samples', async t => {
  const folder = await fixture(t, {bom:true});
  const before = await readFile(join(folder, 'samples.json.gz'));
  const result = await analyzeRun(folder);
  assert.equal(result.stability.status, 'sem_alerta');
  assert.equal(result.load_delivered, true);
  assert.equal(result.error_count, 0);
  assert.equal(result.integrity.latency_samples, 300);
  assert.equal(result.integrity.counts_match, true);
  assert.match(result.report_pt, /heur/i);
  assert.deepEqual(await readFile(join(folder, 'samples.json.gz')), before);
});

test('flags incomplete offered load and API failures independently of temporal warning', async t => {
  const folder = await fixture(t, {row:{dropped_iterations:10, successful_requests:298, invalid_rate:2/300}});
  const result = await analyzeRun(folder);
  assert.equal(result.stability.status, 'sem_alerta');
  assert.equal(result.load_delivered, false);
  assert.equal(result.error_count, 2);
  assert.equal(result.has_errors, true);
});

test('does not call load delivered when requests fall short without a dropped metric', async t => {
  const folder = await fixture(t, {row:{offered_rps:10}});
  assert.equal((await analyzeRun(folder)).load_delivered, false);
});

test('rejects missing raw samples or missing row metadata', async t => {
  const folder = await fixture(t);
  await rm(join(folder, 'samples.json.gz'));
  await assert.rejects(analyzeRun(folder), /samples/i);
  await rm(join(folder, 'row.json'));
  await assert.rejects(analyzeRun(folder), /row/i);
});

test('rejects malformed gzip, malformed JSONL and empty raw data', async t => {
  const folder = await fixture(t);
  await writeFile(join(folder, 'samples.json.gz'), 'broken gzip');
  await assert.rejects(analyzeRun(folder));
  await writeFile(join(folder, 'samples.json.gz'), gzipSync('{broken}\n'));
  await assert.rejects(analyzeRun(folder), /linha|JSON/i);
  await writeFile(join(folder, 'samples.json.gz'), gzipSync(''));
  await assert.rejects(analyzeRun(folder), /vazio|empty/i);
});

test('rejects sample count mismatch rather than granting a successful report', async t => {
  const folder = await fixture(t, {row:{requests:301, successful_requests:301}});
  await assert.rejects(analyzeRun(folder), /contagem|count/i);
});

// Protocolo 4: amostras de duração impossíveis são retiradas ponto a ponto dentro de um
// orçamento declarado, em vez de descartar a repetição inteira. Ver maxNegativeCount.
function nativeFixture(count, {negatives=[], native=null} = {}) {
  const points = Array.from({length:count}, (_, i) => ({time:epoch + 10 + i*59000/count, value:10}));
  for (const [index, value] of negatives) points[index].value = value;
  const records = points.flatMap(p => [
    {type:'Point', metric:'request_latency_ms', data:{time:new Date(p.time).toISOString(), value:p.value}},
    {type:'Point', metric:'http_req_duration', data:{time:new Date(p.time).toISOString(), value:p.value}},
    {type:'Point', metric:'successful_requests', data:{value:1}},
    {type:'Point', metric:'http_reqs', data:{value:1}},
  ]);
  if (native !== null) {
    for (const record of records) {
      if (record.metric === 'http_req_duration' && record.data.value < 0) record.data.value = native;
    }
  }
  return {points, records};
}
const nativeRow = {protocol_version:4, latency_metric:'request_latency_ms',
  timing_basis:'k6_http_duration', elapsed_seconds:60, scheduled_seconds:60};

test('protocol 4 reads native latency points and recomputes percentiles from raw samples', async t => {
  const {records} = nativeFixture(1200);
  const folder = await fixture(t, {row:{...nativeRow, requests:1200, successful_requests:1200}, records});
  const result = await analyzeRun(folder);
  assert.equal(result.integrity.counts_match, true);
  assert.equal(result.integrity.native_duration_samples, 1200);
  assert.equal(result.latency_basis, 'raw_samples_filtered');
  assert.equal(result.latency.p95_ms, 10);
  assert.equal(result.latency.samples, 1200);
  assert.equal(result.excluded_samples.count, 0);
});

test('a sparse impossible duration confirmed by k6 is dropped without losing the round', async t => {
  const {records} = nativeFixture(1200, {negatives:[[0,-1.284739]]});
  const folder = await fixture(t, {row:{...nativeRow, requests:1200, successful_requests:1200}, records});
  const result = await analyzeRun(folder);
  assert.equal(result.excluded_samples.count, 1);
  assert.equal(result.excluded_samples.confirmed_by_native, true);
  assert.equal(result.excluded_samples.details[0].value, -1.284739);
  assert.equal(result.integrity.analyzed_samples, 1199);
  assert.equal(result.latency.samples, 1199);
  assert.equal(result.latency.p95_ms, 10);
  assert.match(result.report_pt, /impossíveis retiradas/);
});

test('impossible durations beyond the declared budget still reject the measurement', async t => {
  const many = nativeFixture(1200, {negatives:Array.from({length:11}, (_, i) => [i, -1-i])});
  const folder = await fixture(t, {row:{...nativeRow, requests:1200, successful_requests:1200}, records:many.records});
  await assert.rejects(analyzeRun(folder), /orçamento/);
  const fraction = nativeFixture(300, {negatives:[[0,-1]]});
  const small = await fixture(t, {row:{...nativeRow, requests:300, successful_requests:300}, records:fraction.records});
  await assert.rejects(analyzeRun(small), /orçamento/);
});

test('an impossible duration the generator does not confirm rejects the measurement', async t => {
  const unconfirmed = nativeFixture(1200, {negatives:[[0,-1.5]], native:0.5});
  const folder = await fixture(t, {row:{...nativeRow, requests:1200, successful_requests:1200}, records:unconfirmed.records});
  await assert.rejects(analyzeRun(folder), /não confirma/);
  const points = Array.from({length:1200}, (_, i) => ({time:epoch + 10 + i*49, value:i ? 10 : -1}));
  const records = points.flatMap(p => [
    {type:'Point', metric:'request_latency_ms', data:{time:new Date(p.time).toISOString(), value:p.value}},
    {type:'Point', metric:'http_reqs', data:{value:1}},
  ]);
  const bare = await fixture(t, {row:{...nativeRow, requests:1200, successful_requests:1200}, records});
  await assert.rejects(analyzeRun(bare), /http_req_duration/);
});

test('the ramped warmup load is measured against expected_requests, not rate times seconds', async t => {
  const {records} = nativeFixture(1200);
  const folder = await fixture(t, {records,
    row:{...nativeRow, phase:'warmup', offered_rps:100, expected_requests:1200,
      requests:1200, successful_requests:1200}});
  const result = await analyzeRun(folder);
  assert.equal(result.delivery.expected_requests, 1200);
  assert.equal(result.delivery.delivered_fraction, 1);
  assert.equal(result.load_delivered, true);
});

test('protocol 3 rejects an elapsed test lasting hours instead of scheduled seconds', async t => {
  const folder=await fixture(t,{row:{protocol_version:3,elapsed_seconds:33434.295,scheduled_seconds:90}});
  await assert.rejects(analyzeRun(folder),/duração total|tempo total|elapsed/i);
});

test('zero requests with valid metric-only JSONL is insufficient', async t => {
  const folder = await fixture(t, {points:[], records:[{type:'Metric',metric:'request_wall_ms',data:{type:'trend'}}]});
  const result = await analyzeRun(folder);
  assert.equal(result.stability.status, 'insuficiente');
  assert.equal(result.load_delivered, false);
});

test('CLI writes JSON and readable report only after a successful analysis', async t => {
  const folder = await fixture(t);
  const cli = resolve(import.meta.dirname, '../benchmarks/analyze-run.mjs');
  const command = spawnSync(process.execPath, [cli, folder], {encoding:'utf8'});
  assert.equal(command.status, 0, command.stderr);
  assert.equal(JSON.parse(await readFile(join(folder, 'quality.json'), 'utf8')).stability.status, 'sem_alerta');
  assert.match(await readFile(join(folder, 'quality.txt'), 'utf8'), /heur/i);
  await rm(join(folder, 'samples.json.gz'));
  assert.notEqual(spawnSync(process.execPath, [cli, folder]).status, 0);
});
