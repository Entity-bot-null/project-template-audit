/** The contract version this package implements (ADR 0005). */
export const CONTRACT_VERSION = 1;

/**
 * Versions Audit Hub accepts: the current one and the previous one, once
 * there is a previous one.
 */
export const SUPPORTED_CONTRACT_VERSIONS: readonly number[] = [CONTRACT_VERSION];

// Every limit of the wire format, in one place. A batch stays inside the
// template's default JSON body limit (100 kB, docs/api-conventions.md).
export const LIMITS = {
  batchEvents: 100,
  /** Serialized batch, leaving room for the envelope under 100 kB. */
  batchBytes: 96 * 1024,
  eventBytes: 16 * 1024,
  clientBatchEvents: 50,
  clientBatchBytes: 64 * 1024,
  /** Events a device keeps queued at most: past it, the oldest are dropped. */
  clientQueueEvents: 1000,
  label: 128,
  userAgent: 512,
  os: 32,
  osVersion: 32,
  deviceModel: 64,
  /** Client hints: brands listed, and the length of a brand, a version, a platform. */
  hintBrands: 8,
  hintBrand: 64,
  hintVersion: 32,
  hintPlatform: 32,
  detailsBytes: 8 * 1024,
  changeBytes: 16 * 1024,
  changedFields: 64,
  jsonDepth: 4,
  catalogActions: 500,
  catalogBytes: 512 * 1024,
  catalogFields: 32,
  description: 500,
} as const;

/** Seconds a signed request's timestamp may differ from the receiver's clock. */
export const SIGNATURE_WINDOW_SEC = 300;
