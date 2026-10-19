import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { call } from '../../api/errors';
import { Badge } from '../../audit/EventTable';
import { formatDateTime, formatNumber } from '../../audit/format';
import { JsonView } from '../../audit/JsonView';
import { LoadView } from '../../audit/LoadView';
import { OffsetPager } from '../../audit/Pager';
import { useLoader } from '../../hooks/useLoader';

const PAGE_SIZE = 20;

// The exports made (an administrator sees everyone's): the filters, the rows
// and the SHA-256 of the body sent, to check a copy later. New exports start
// from the explorer, with its filters.
export function ExportsPage() {
  const [params, setParams] = useSearchParams();
  const offset = Math.max(0, Number.parseInt(params.get('offset') ?? '0', 10) || 0);
  const { state, retry } = useLoader(
    () => call(api.GET('/api/exports', { params: { query: { limit: PAGE_SIZE, offset } } })),
    offset,
  );
  return (
    <section className="stack" aria-labelledby="exports-heading">
      <div className="page-header">
        <h1 id="exports-heading">Exports</h1>
        <Link to="/events">New export from the explorer</Link>
      </div>
      <p className="muted">
        Check a saved copy against its digest:{' '}
        <span className="mono">openssl dgst -sha256 -binary FILE | base64</span> prints the same
        text.
      </p>
      <LoadView state={state} retry={retry} label="exports">
        {(page) =>
          page.items.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <>
              <ul className="stack">
                {page.items.map((job) => (
                  <li key={job.id} className="card stack">
                    <div className="page-header">
                      <strong>
                        {formatDateTime(job.startedAt)} ·{' '}
                        {job.format === 'csv' ? 'CSV' : 'JSON Lines'}
                      </strong>
                      <Badge kind="status" value={job.status} />
                    </div>
                    <dl className="details-grid">
                      <dt>Rows</dt>
                      <dd>
                        {job.rowCount === null ? '—' : formatNumber(job.rowCount)} (at most{' '}
                        {formatNumber(job.rowCap)})
                      </dd>
                      <dt>SHA-256</dt>
                      <dd className="mono">{job.digest ?? '—'}</dd>
                      <dt>Finished</dt>
                      <dd>{formatDateTime(job.finishedAt)}</dd>
                      <dt>Filters</dt>
                      <dd>
                        <JsonView value={job.filters} />
                      </dd>
                      <dt>Export id</dt>
                      <dd className="mono">{job.id}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
              <OffsetPager
                total={page.total}
                limit={PAGE_SIZE}
                offset={offset}
                onChange={(next) => {
                  setParams(next > 0 ? { offset: String(next) } : {});
                }}
              />
            </>
          )
        }
      </LoadView>
    </section>
  );
}
