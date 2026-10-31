import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('./model-manifest.json', import.meta.url), 'utf8'));
function digest(bytes, algorithm) {
  if (algorithm === 'sha256') return createHash('sha256').update(bytes).digest('hex');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
for (const file of manifest) {
  const target = path.join(root, 'public/models', file.model, file.path);
  let existing;
  try { existing = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing?.length === file.size && digest(existing, file.algorithm) === file.hash) continue;
  console.log(`Downloading ${file.model}/${file.path} (${(file.size / 1048576).toFixed(1)} MiB)`);
  const response = await fetch(`https://huggingface.co/${file.model}/resolve/${file.revision}/${file.path}`, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== file.size || digest(bytes, file.algorithm) !== file.hash) throw new Error(`Integrity check failed: ${file.path}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(`${target}.tmp`, bytes);
  await rename(`${target}.tmp`, target);
}
const wasmDirectory = path.join(root, 'node_modules/onnxruntime-web/dist');
for (const name of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  await mkdir(path.join(root, 'public/wasm'), { recursive: true });
  await cp(path.join(wasmDirectory, name), path.join(root, 'public/wasm', name));
}
console.log('AI models verified and WebAssembly assets copied. Inference needs no external service.');
