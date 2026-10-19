import { describe, expect, it } from 'vitest';
import { actorPath, alertPath, eventPath, isUuid, resourcePath } from './links';

const APP = '0190b6a1-0000-7000-8000-00000000000a';
const EVENT = '0190b6a1-0000-7000-8000-0000000000e1';

// Values from the audit log reach an href only when they match the contract's
// patterns, each part encoded (docs/adr/0014).
describe('links', () => {
  it('recognizes a UUID in either case, and nothing else', () => {
    expect(isUuid(APP)).toBe(true);
    expect(isUuid(APP.toUpperCase())).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(`${APP}x`)).toBe(false);
    expect(isUuid(` ${APP}`)).toBe(false);
  });

  it("links an event or an alert by its id, and nothing that isn't one", () => {
    expect(eventPath(EVENT)).toBe(`/events/${EVENT}`);
    expect(eventPath('../admin/users')).toBeNull();
    expect(alertPath(EVENT)).toBe(`/alerts/${EVENT}`);
    expect(alertPath('javascript:alert(1)')).toBeNull();
  });

  it('links an actor whose id matches the pattern, encoded', () => {
    expect(actorPath(APP, 'user-1')).toBe(`/apps/${APP}/actors/user-1`);
    // `:` is allowed by the pattern and still encoded in the path.
    expect(actorPath(APP, 'svc:billing.v2_x')).toBe(`/apps/${APP}/actors/svc%3Abilling.v2_x`);
    expect(actorPath(APP, 'a'.repeat(128))).toBe(`/apps/${APP}/actors/${'a'.repeat(128)}`);
  });

  it('does not link an actor without an id, with an odd id or an odd application', () => {
    expect(actorPath(APP, null)).toBeNull();
    expect(actorPath(APP, '')).toBeNull();
    expect(actorPath(APP, 'bad id!')).toBeNull();
    expect(actorPath(APP, '../../admin')).toBeNull();
    expect(actorPath(APP, 'a'.repeat(129))).toBeNull();
    expect(actorPath('not-an-app', 'user-1')).toBeNull();
  });

  it('links a resource whose type and id match their patterns, the id encoded', () => {
    expect(resourcePath(APP, 'invoice', 'inv-1')).toBe(`/apps/${APP}/resources/invoice/inv-1`);
    expect(resourcePath(APP, 'line_item2', 'a:b')).toBe(`/apps/${APP}/resources/line_item2/a%3Ab`);
  });

  it('does not link a resource with a missing part or one off the patterns', () => {
    expect(resourcePath(APP, null, 'inv-1')).toBeNull();
    expect(resourcePath(APP, 'invoice', null)).toBeNull();
    expect(resourcePath('not-an-app', 'invoice', 'inv-1')).toBeNull();
    expect(resourcePath(APP, 'Invoice', 'inv-1')).toBeNull();
    expect(resourcePath(APP, '1invoice', 'inv-1')).toBeNull();
    expect(resourcePath(APP, 'in voice', 'inv-1')).toBeNull();
    expect(resourcePath(APP, 'a'.repeat(65), 'inv-1')).toBeNull();
    expect(resourcePath(APP, 'invoice', 'inv/1')).toBeNull();
    expect(resourcePath(APP, 'invoice', '')).toBeNull();
  });
});
