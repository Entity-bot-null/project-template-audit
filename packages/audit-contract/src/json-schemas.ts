import { z } from 'zod';
import { CatalogDocumentSchema } from './catalog.js';
import {
  ActivityPageSchema,
  ErasureRequestSchema,
  ErasureResultSchema,
  SubjectExportPageSchema,
} from './connector-api.js';
import {
  AuditEventSchema,
  ClientEventBatchResultSchema,
  ClientEventBatchSchema,
  ClientEventSchema,
} from './event.js';
import {
  CatalogPublishResultSchema,
  CatalogPublishSchema,
  EventBatchResultSchema,
  EventBatchSchema,
  HeartbeatResultSchema,
  HeartbeatSchema,
} from './ingest.js';
import { WebhookReplySchema, WebhookSchema } from './webhook.js';

// The published, language-neutral form of the contract: JSON Schema (draft
// 2020-12) generated from the Zod schemas, committed under schema/v1/ and
// drift-checked by json-schemas.spec.ts. Regenerate with
// `pnpm --filter audit-contract schemas` (part of `pnpm contract`).

const BASE_ID = 'https://audit-hub.invalid/schema/v1/';

const FILES = {
  'event.schema.json': { title: 'AuditEvent', schema: AuditEventSchema },
  'client-event.schema.json': { title: 'ClientEvent', schema: ClientEventSchema },
  'client-event-batch.schema.json': { title: 'ClientEventBatch', schema: ClientEventBatchSchema },
  'client-event-batch-result.schema.json': {
    title: 'ClientEventBatchResult',
    schema: ClientEventBatchResultSchema,
  },
  'catalog.schema.json': { title: 'CatalogDocument', schema: CatalogDocumentSchema },
  'event-batch.schema.json': { title: 'EventBatch', schema: EventBatchSchema },
  'event-batch-result.schema.json': { title: 'EventBatchResult', schema: EventBatchResultSchema },
  'catalog-publish.schema.json': { title: 'CatalogPublish', schema: CatalogPublishSchema },
  'catalog-publish-result.schema.json': {
    title: 'CatalogPublishResult',
    schema: CatalogPublishResultSchema,
  },
  'heartbeat.schema.json': { title: 'Heartbeat', schema: HeartbeatSchema },
  'heartbeat-result.schema.json': { title: 'HeartbeatResult', schema: HeartbeatResultSchema },
  'webhook.schema.json': { title: 'Webhook', schema: WebhookSchema },
  'webhook-reply.schema.json': { title: 'WebhookReply', schema: WebhookReplySchema },
  'activity-page.schema.json': { title: 'ActivityPage', schema: ActivityPageSchema },
  'erasure-request.schema.json': { title: 'ErasureRequest', schema: ErasureRequestSchema },
  'erasure-result.schema.json': { title: 'ErasureResult', schema: ErasureResultSchema },
  'subject-export-page.schema.json': {
    title: 'SubjectExportPage',
    schema: SubjectExportPageSchema,
  },
} as const;

/** Every schema file of contract version 1, by file name. */
export function generateJsonSchemas(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const [name, { title, schema }] of Object.entries(FILES)) {
    const generated = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io: 'input',
      // Refinements (sizes, depths, uniqueness) have no JSON Schema form;
      // the generated schema is their superset and the descriptions say so.
      unrepresentable: 'any',
    });
    files[name] = { ...generated, $id: `${BASE_ID}${name}`, title };
  }
  return files;
}

/** The file's text as committed: two-space JSON and a final newline. */
export function schemaFileText(schema: unknown): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
