// The integration contract (packages/audit-contract). In a connected app this
// directory holds a copy of the part the connector uses, made by
// `pnpm connector add --kind expo`, with an index of its own: the connector's
// imports (./contract) read the same in both places (docs/adr/0009).
export * from 'audit-contract';
