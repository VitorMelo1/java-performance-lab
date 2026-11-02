import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function source() {
  let code = await readFile(new URL('../benchmarks/load.js', import.meta.url), 'utf8');
  return code.replace(/^import .*;\r?\n/gm, '').replace(/export default function \(\)/, 'function run()').replace(/export /g, '');
}
function harness(env, extra = {}) {
  const samples = {};
  class Metric { constructor(name) { this.name=name; samples[name]=[]; } add(n) { samples[this.name].push(n); } }
  return {samples, context:vm.createContext({__ENV:env, Counter:Metric, Rate:Metric, Trend:Metric,
    exec:{scenario:{iterationInTest:0}}, Date:{now:()=>1},
    http:{get:()=>({status:200,timings:{duration:2.75,blocked:0.3},json:()=>({id:1,name:'Produto 1',priceCents:1001,stock:100})})},
    check:(r,checks)=>Object.values(checks).every(fn=>fn(r)), probe:{}, ...extra})};
}

// A rodada de diagnostico mvc-feign/orders a 1000 req/s mostrou que subir em 15 s nao
// aquecia: o aquecimento ficou saturado em p50 de 974 ms entregando 413 de 1000 req/s, e a
// medicao comecou fria (p95 de 1030 ms na primeira janela contra 11,8 ms na segunda).
test('warmup ramps over most of the window and ends on a plateau at the target rate', async () => {
  const {context} = harness({SCENARIO:'orders', WARMUP:'1', SECONDS:'60', RATE:'1000'});
  vm.runInContext(await source()+'\nprobe.options=options;probe.expected=expectedRequests;probe.plateau=plateauExpected;', context);
  const scenario = context.probe.options.scenarios.load;
  assert.equal(scenario.executor, 'ramping-arrival-rate');
  assert.equal(scenario.startRate, 100);
  // Array.from reconstroi neste realm: Array.prototype.map preserva o realm do vm e o
  // assert estrito compara prototipos.
  assert.deepEqual(Array.from(scenario.stages, s => ({duration:s.duration, target:s.target})),
    [{duration:'45s',target:1000},{duration:'15s',target:1000}]);
  // Subida: media de 100 a 1000 por 45 s, mais 15 s no alvo.
  assert.equal(context.probe.expected, Math.round((100+1000)/2*45 + 1000*15));
  assert.equal(context.probe.plateau, 15000);
});

test('the measurement itself stays on a constant arrival rate', async () => {
  const {context} = harness({SCENARIO:'orders', SECONDS:'90', RATE:'1000'});
  vm.runInContext(await source()+'\nprobe.options=options;probe.expected=expectedRequests;probe.plateau=plateauExpected;', context);
  const scenario = context.probe.options.scenarios.load;
  assert.equal(scenario.executor, 'constant-arrival-rate');
  assert.equal(scenario.rate, 1000);
  assert.equal(scenario.duration, '90s');
  assert.equal(context.probe.expected, 90000);
  assert.equal(context.probe.plateau, 0);
});

test('a short warmup keeps a constant rate so the quick run stays comparable', async () => {
  const {context} = harness({SCENARIO:'db-read', WARMUP:'1', SECONDS:'3', RATE:'20'});
  vm.runInContext(await source()+'\nprobe.options=options;probe.expected=expectedRequests;', context);
  assert.equal(context.probe.options.scenarios.load.executor, 'constant-arrival-rate');
  assert.equal(context.probe.expected, 60);
});

test('plateau counters only record iterations after the ramp has finished', async () => {
  const code = await source();
  for (const [sinceStartMs, expected] of [[10_000, 0], [50_000, 1]]) {
    const {samples, context} = harness({SCENARIO:'db-read', WARMUP:'1', SECONDS:'60', RATE:'1000'},
      {exec:{scenario:{iterationInTest:0}, instance:{currentTestRunDuration:sinceStartMs}}});
    vm.runInContext(code+'\nrun();', context);
    assert.equal(samples.plateau_requests.length, expected, `em ${sinceStartMs} ms`);
    assert.equal(samples.request_latency_ms.length, 1);
  }
});

// A verificacao de colisao entre os campos do row.json e os que o harness acrescenta vive
// em tests/BenchmarkProtocol.ps1: ela precisa ler scripts/Benchmark.ps1, e o container
// checker monta apenas ./tests e ./benchmarks.

test('duration comes from native HTTP timing even when civil clock moves backward', async () => {
  let code = await readFile(new URL('../benchmarks/load.js', import.meta.url), 'utf8');
  code = code.replace(/^import .*;\r?\n/gm, '').replace(/export default function \(\)/, 'function run()').replace(/export /g, '');
  const samples = {};
  class Metric { constructor(name) { this.name=name; samples[name]=[]; } add(n) { samples[this.name].push(n); } }
  let clock = 100;
  const context = vm.createContext({__ENV:{SCENARIO:'db-read'}, Counter:Metric, Rate:Metric, Trend:Metric,
    exec:{scenario:{iterationInTest:0}}, Date:{now:()=>clock--},
    http:{get:()=>({status:200,timings:{duration:2.75,blocked:0.3},json:()=>({id:1,name:'Produto 1',priceCents:1001,stock:100})})},
    check:(r,checks)=>Object.values(checks).every(fn=>fn(r))});
  vm.runInContext(code+'\nrun();', context);
  assert.deepEqual(samples.request_latency_ms, [2.75]);
});
