import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { normalizeProspectCsvRecord, type ProspectCsvRow } from '../lib/prospects.js';

type ProspectManifest = {
  headers: string[];
  rows: unknown[][];
};

const manifestPath = process.env.PROSPECT_MANIFEST_PATH ?? '';
const outputDir = process.env.PROSPECT_PAYLOAD_OUTPUT_DIR ?? '';
if (!manifestPath || !outputDir) {
  throw new Error('PROSPECT_MANIFEST_PATH and PROSPECT_PAYLOAD_OUTPUT_DIR are required.');
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ProspectManifest;
if (!Array.isArray(manifest.headers) || !Array.isArray(manifest.rows)) {
  throw new Error('Invalid prospect manifest.');
}

const candidates: Array<ProspectCsvRow & { tags: string[] }> = [];
const invalidRows: Array<{ row: number; error: string }> = [];
for (let index = 0; index < manifest.rows.length; index += 1) {
  const values = manifest.rows[index] ?? [];
  const record = Object.fromEntries(
    manifest.headers.map((header, column) => [header, values[column] ?? null])
  );
  const normalized = normalizeProspectCsvRecord(record, index + 2);
  if (!normalized.row) {
    invalidRows.push({ row: index + 2, error: normalized.error ?? 'Invalid prospect.' });
    continue;
  }
  candidates.push({
    ...normalized.row,
    tags: ['needs profile capture'],
  });
}

if (invalidRows.length > 0) {
  throw new Error(`Prospect payload contains ${invalidRows.length} invalid rows.`);
}

const payload = gzipSync(Buffer.from(JSON.stringify(candidates), 'utf8')).toString('base64');
const partSize = 40_000;
const parts = Array.from({ length: Math.ceil(payload.length / partSize) }, (_, index) =>
  payload.slice(index * partSize, (index + 1) * partSize)
);
if (parts.length > 30) {
  throw new Error(`Payload needs ${parts.length} secret parts; maximum is 30.`);
}

await mkdir(outputDir, { recursive: true });
for (let index = 0; index < parts.length; index += 1) {
  await writeFile(
    `${outputDir}/payload-${String(index + 1).padStart(2, '0')}.txt`,
    parts[index] ?? '',
    'utf8'
  );
}
await writeFile(
  `${outputDir}/payload-summary.json`,
  JSON.stringify({
    candidates: candidates.length,
    invalidRows: invalidRows.length,
    compressedBase64Characters: payload.length,
    parts: parts.length,
  }),
  'utf8'
);
console.log(
  JSON.stringify({
    candidates: candidates.length,
    invalidRows: invalidRows.length,
    compressedBase64Characters: payload.length,
    parts: parts.length,
  })
);
