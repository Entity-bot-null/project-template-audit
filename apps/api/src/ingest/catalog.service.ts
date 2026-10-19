import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  type ActionSpec,
  type CatalogDocument,
  CatalogDocumentSchema,
  type CatalogPublishResult,
  catalogVersionOf,
  MIN_RETENTION_DAYS,
  retentionDowngrades,
} from 'audit-contract';
import { sha256Hex } from 'audit-contract/node';
import { PrismaService } from '../prisma/prisma.service.js';

/** A catalog version as ingestion uses it. */
export interface ResolvedCatalog {
  id: string;
  actions: ReadonlyMap<string, ActionSpec>;
}

// Published catalogs never change (append-only table), so a resolved version
// can be kept in the process; an hour bounds the memory of versions no
// longer used. This caches data, never an authorization decision.
const CACHE_TTL_MS = 3_600_000;
const CACHE_MAX = 500;

// The catalogs applications publish (PUT /api/ingest/catalog, docs/adr/0005).
@Injectable()
export class CatalogService {
  private readonly logger = new Logger('Catalogs');
  private readonly cache = new Map<string, { catalog: ResolvedCatalog; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async publish(
    appId: string,
    keyId: string,
    catalog: CatalogDocument,
  ): Promise<CatalogPublishResult> {
    const version = catalogVersionOf(catalog, sha256Hex);
    const actions = Object.keys(catalog.actions).length;
    const existing = await this.prisma.catalogVersion.findUnique({
      where: { appId_version: { appId, version } },
      select: { id: true },
    });
    if (existing !== null) return { version, status: 'unchanged', actions };

    // Every version published so far: an action may never move to a
    // category kept for less time, even after it was dropped in between.
    const published = await this.prisma.catalogVersion.findMany({
      where: { appId },
      select: { document: true },
    });
    const problems: string[] = [];
    for (const { document } of published) {
      const previous = CatalogDocumentSchema.safeParse(document);
      if (!previous.success) continue;
      for (const downgrade of retentionDowngrades(previous.data, catalog)) {
        problems.push(
          `actions.${downgrade.action}.category: ${downgrade.to} keeps events ${String(MIN_RETENTION_DAYS[downgrade.to])} days, ${downgrade.from} ${String(MIN_RETENTION_DAYS[downgrade.from])}: an action never moves to a shorter retention`,
        );
      }
    }
    if (problems.length > 0) throw new BadRequestException([...new Set(problems)].join(', '));

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.catalogVersion.create({
        data: {
          appId,
          version,
          appVersion: catalog.app.version,
          document: catalog,
          keyId,
        },
        select: { id: true },
      });
      await tx.catalogAction.createMany({
        data: Object.entries(catalog.actions).map(([action, spec]) => ({
          catalogVersionId: created.id,
          appId,
          action,
          category: spec.category,
          severity: spec.severity,
          source: spec.source,
          tags: spec.tags ?? [],
          userVisible: spec.userVisible ?? false,
          description: spec.description,
          spec,
        })),
      });
    });
    this.logger.log(
      `Catalog ${version} published for application ${appId} (${String(actions)} actions)`,
    );
    return { version, status: 'created', actions };
  }

  /** A version this application published, or undefined. */
  async resolve(
    appId: string,
    version: string,
    now: number = Date.now(),
  ): Promise<ResolvedCatalog | undefined> {
    const key = `${appId}:${version}`;
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.expires > now) return cached.catalog;
    const row = await this.prisma.catalogVersion.findUnique({
      where: { appId_version: { appId, version } },
      select: { id: true, document: true },
    });
    if (row === null) return undefined;
    const document = CatalogDocumentSchema.parse(row.document);
    const catalog: ResolvedCatalog = {
      id: row.id,
      actions: new Map(Object.entries(document.actions)),
    };
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next();
      if (oldest.done !== true) this.cache.delete(oldest.value);
    }
    this.cache.set(key, { catalog, expires: now + CACHE_TTL_MS });
    return catalog;
  }
}
