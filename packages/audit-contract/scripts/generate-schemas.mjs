// Writes the contract's JSON Schema files (schema/v1/*.json) from the compiled
// Zod schemas. Run through `pnpm --filter audit-contract schemas`, which
// compiles first; src/json-schemas.spec.ts fails when the files drift.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateJsonSchemas, schemaFileText } from '../dist/json-schemas.js';

const directory = fileURLToPath(new URL('../schema/v1/', import.meta.url));
mkdirSync(directory, { recursive: true });
const files = generateJsonSchemas();
for (const name of readdirSync(directory)) {
  if (!(name in files)) rmSync(new URL(name, `file://${directory}`));
}
for (const [name, schema] of Object.entries(files)) {
  writeFileSync(`${directory}${name}`, schemaFileText(schema));
}
console.log(`JSON Schema written to ${directory} (${String(Object.keys(files).length)} files)`);
