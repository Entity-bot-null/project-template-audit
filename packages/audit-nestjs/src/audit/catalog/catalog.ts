import { APP_ACTIONS } from '../app-catalog.js';
import {
  type ActionSpec,
  type CatalogDocument,
  catalogVersionOf,
  type ResponseAction,
  sha256Hex,
} from '../contract/index.js';
import { BASE_ACTIONS } from './base-catalog.js';

/** Every action of this project: the template's flows and its own. */
export const ACTIONS: Readonly<Record<string, ActionSpec>> = { ...BASE_ACTIONS, ...APP_ACTIONS };

/** An action the project may record: a typo fails the type check. */
export type AuditAction = keyof (typeof BASE_ACTIONS & typeof APP_ACTIONS);

/** The base catalog's names an app catalog must not reuse (a spec checks it). */
export const BASE_ACTION_NAMES: readonly string[] = Object.keys(BASE_ACTIONS);

/** A catalog's actions: this project's (ACTIONS), or a spec's own. */
export type Actions = Readonly<Record<string, ActionSpec>>;

export function actionSpec(action: string, actions: Actions = ACTIONS): ActionSpec | undefined {
  return Object.hasOwn(actions, action) ? actions[action] : undefined;
}

/**
 * The catalog Audit Hub validates the events against. Its version is the
 * hash of the document: the connector's version stands for the app's, so a
 * deploy that adds no action keeps the version, and events queued before it
 * stay valid (the forwarder stamps the current version when it sends).
 */
export function catalogDocument(
  app: string,
  version: string,
  responseActions: readonly ResponseAction[],
): CatalogDocument {
  return {
    catalogFormat: 1,
    app: { name: app, version },
    ...(responseActions.length === 0 ? {} : { responseActions: [...responseActions] }),
    actions: { ...ACTIONS },
  };
}

export function catalogVersion(catalog: CatalogDocument): string {
  return catalogVersionOf(catalog, sha256Hex);
}
