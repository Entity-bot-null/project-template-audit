// Links to the admin pages built from values of the audit log. Only ids that
// match the contract's patterns (packages/audit-contract/src/patterns.ts)
// become links, each part encoded: a value from an event never reaches an
// href as it came (docs/adr/0014).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ID_PATTERN of the contract. */
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
/** RESOURCE_TYPE_PATTERN of the contract. */
const RESOURCE_TYPE = /^[a-z][a-z0-9_]{0,63}$/;

export const isUuid = (value: string): boolean => UUID.test(value);

export function eventPath(id: string): string | null {
  return UUID.test(id) ? `/events/${id}` : null;
}

export function actorPath(appId: string, actorId: string | null): string | null {
  if (actorId === null || !UUID.test(appId) || !ID.test(actorId)) return null;
  return `/apps/${appId}/actors/${encodeURIComponent(actorId)}`;
}

export function resourcePath(appId: string, type: string | null, id: string | null): string | null {
  if (type === null || id === null) return null;
  if (!UUID.test(appId) || !RESOURCE_TYPE.test(type) || !ID.test(id)) return null;
  return `/apps/${appId}/resources/${type}/${encodeURIComponent(id)}`;
}

export function alertPath(id: string): string | null {
  return UUID.test(id) ? `/alerts/${id}` : null;
}
