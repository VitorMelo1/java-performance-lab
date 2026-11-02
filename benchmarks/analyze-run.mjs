import {writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {analyzeRun} from './quality.mjs';

try {
  const folder = process.argv[2];
  if (process.argv.length !== 3 || !folder || !isAbsolute(folder)) {
    throw Error('Uso: node benchmarks/analyze-run.mjs "caminho absoluto da rodada"');
  }
  const quality = await analyzeRun(folder);
  await writeFile(join(folder, 'quality.json'), JSON.stringify(quality,null,2)+'\n', 'utf8');
  await writeFile(join(folder, 'quality.txt'), quality.report_pt, 'utf8');
  process.stdout.write(quality.report_pt);
} catch (error) {
  process.stderr.write(`Falha na análise de qualidade: ${error.message}\n`);
  process.exitCode = 1;
}
