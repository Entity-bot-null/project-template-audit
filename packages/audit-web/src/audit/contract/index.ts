// The integration contract (packages/audit-contract). In a connected web app this
// directory holds a copy of the part the connector uses, made by
// `pnpm connector add --kind spa`, with an index of its own: the connector's
// imports (./contract, ./contract/uuidv7) read the same in both places (docs/adr/0009).
export * from 'audit-contract';
