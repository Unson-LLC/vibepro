import { readFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';

const partPaths = ['scripts/.one-shot-review-causal-convergence.part-00', 'scripts/.one-shot-review-causal-convergence.part-01', 'scripts/.one-shot-review-causal-convergence.part-02', 'scripts/.one-shot-review-causal-convergence.part-03', 'scripts/.one-shot-review-causal-convergence.part-04', 'scripts/.one-shot-review-causal-convergence.part-05', 'scripts/.one-shot-review-causal-convergence.part-06'];
const encoded = (await Promise.all(partPaths.map((file) => readFile(file, 'utf8')))).join('');
const source = brotliDecompressSync(Buffer.from(encoded, 'base64')).toString('utf8');
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
