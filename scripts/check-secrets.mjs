import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = 'dist-bare';
const canary = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!canary || canary.length < 12) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY to a canary before building the bare bundle.');
  process.exit(1);
}

const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
}
walk(root);
const hits = [];
for (const file of files) {
  const text = readFileSync(file);
  if (text.includes(canary)) hits.push(`${file} contains the service-role canary`);
  const source = text.toString('utf8');
  if (source.includes('VITE_SUPABASE_SERVICE_ROLE_KEY')) hits.push(`${file} references VITE_SUPABASE_SERVICE_ROLE_KEY`);
}
if (hits.length > 0) {
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log(`scanned ${files.length} bare-build files; no service-role credential found`);
