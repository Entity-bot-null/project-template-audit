import { formatNumber } from './format';

/** Previous and next pages of an offset list, with where the page is in the whole. */
export function OffsetPager({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  if (total === 0) return null;
  const last = Math.min(offset + limit, total);
  return (
    <nav className="pager" aria-label="Pages">
      <span>
        {formatNumber(offset + 1)}–{formatNumber(last)} of {formatNumber(total)}
      </span>
      <button
        type="button"
        className="secondary"
        disabled={offset === 0}
        onClick={() => {
          onChange(Math.max(0, offset - limit));
        }}
      >
        Previous
      </button>
      <button
        type="button"
        className="secondary"
        disabled={last >= total}
        onClick={() => {
          onChange(offset + limit);
        }}
      >
        Next
      </button>
    </nav>
  );
}

/**
 * The next page of a cursor list (newest first): older items, and the way
 * back to the newest. The browser's back button returns page by page.
 */
export function CursorPager({
  nextCursor,
  onOlder,
  onNewest,
  atNewest,
}: {
  nextCursor: string | null;
  onOlder: (cursor: string) => void;
  onNewest: () => void;
  atNewest: boolean;
}) {
  if (nextCursor === null && atNewest) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button type="button" className="secondary" disabled={atNewest} onClick={onNewest}>
        Newest
      </button>
      <button
        type="button"
        className="secondary"
        disabled={nextCursor === null}
        onClick={
          nextCursor === null
            ? undefined
            : () => {
                onOlder(nextCursor);
              }
        }
      >
        Older
      </button>
    </nav>
  );
}
