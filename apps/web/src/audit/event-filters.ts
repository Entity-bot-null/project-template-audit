// The explorer's filters (GET /api/events): the same names in the page's
// URL, the API's query and an export's.

export const FILTER_NAMES = [
  'appId',
  'from',
  'to',
  'category',
  'action',
  'outcome',
  'severity',
  'minRisk',
  'actorId',
  'email',
  'resourceType',
  'resourceId',
  'ip',
  'country',
  'clientType',
  'requestId',
] as const;
export type FilterName = (typeof FILTER_NAMES)[number];
export type Filters = Partial<Record<FilterName, string>>;

/** The filters a URL holds, without empty ones. */
export function filtersOf(params: URLSearchParams): Filters {
  const filters: Filters = {};
  for (const name of FILTER_NAMES) {
    const value = params.get(name);
    if (value !== null && value !== '') filters[name] = value;
  }
  return filters;
}
