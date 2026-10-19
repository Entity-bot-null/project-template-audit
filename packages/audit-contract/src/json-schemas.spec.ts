import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateJsonSchemas, schemaFileText } from './json-schemas.js';

// Contract drift guard, like the API's openapi.spec.ts: the committed
// schema/v1/*.json must be what the Zod schemas produce. When it fails, run
// `pnpm --filter audit-contract schemas` (or `pnpm contract`).
const directory = fileURLToPath(new URL('../schema/v1/', import.meta.url));

describe('published JSON Schema', () => {
  const generated = generateJsonSchemas();

  it('matches the committed files (run `pnpm contract` when this fails)', () => {
    expect(readdirSync(directory).sort()).toEqual(Object.keys(generated).sort());
    for (const [name, schema] of Object.entries(generated)) {
      expect(readFileSync(`${directory}${name}`, 'utf8'), name).toBe(schemaFileText(schema));
    }
  });

  it('describes the event with draft 2020-12, its id and closed objects', () => {
    const event = generated['event.schema.json'] as Record<string, unknown>;
    expect(event.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(event.$id).toBe('https://audit-hub.invalid/schema/v1/event.schema.json');
    expect(event.additionalProperties).toBe(false);
    expect(event.required).toEqual(
      expect.arrayContaining(['schemaVersion', 'eventId', 'sourceSeq', 'actor']),
    );
  });
});
