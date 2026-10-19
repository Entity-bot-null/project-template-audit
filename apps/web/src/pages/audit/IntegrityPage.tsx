import { api } from '../../api/client';
import { call } from '../../api/errors';
import { Badge } from '../../audit/EventTable';
import { formatDateTime, formatNumber, words } from '../../audit/format';
import { JsonView } from '../../audit/JsonView';
import { LoadView } from '../../audit/LoadView';
import { useLoader } from '../../hooks/useLoader';

const fetchStatus = () => call(api.GET('/api/integrity/status'));

// Whether the audit log is intact (docs/adr/0008): every stream's sealing,
// the daily verifications and the last checkpoint, whose digest is kept
// outside Audit Hub (pnpm --filter api audit checkpoint prints it).
export function IntegrityPage() {
  const { state, retry } = useLoader(fetchStatus);
  return (
    <section className="stack" aria-labelledby="integrity-heading">
      <h1 id="integrity-heading">Integrity</h1>
      <LoadView state={state} retry={retry} label="the integrity status">
        {(status) => (
          <>
            <section className="card stack" aria-labelledby="verification-heading">
              <h2 id="verification-heading">Verifications</h2>
              {status.verifications.length === 0 ? (
                <p className="muted">None yet: the first one runs within a day.</p>
              ) : (
                <ul className="stack">
                  {status.verifications.map((run) => (
                    <li key={run.id}>
                      <Badge
                        kind="outcome"
                        value={run.outcome === 'passed' ? 'success' : 'failure'}
                      />{' '}
                      {words(run.outcome)} · {formatDateTime(run.finishedAt)} ·{' '}
                      {formatNumber(run.sealsChecked)} seals, {run.eventsChecked} events (
                      {words(run.trigger)})
                      {run.failures > 0 && (
                        <details>
                          <summary>{formatNumber(run.failures)} failures</summary>
                          <JsonView value={run.failureSample} />
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card stack" aria-labelledby="checkpoint-heading">
              <h2 id="checkpoint-heading">Last checkpoint</h2>
              {status.lastCheckpoint === null ? (
                <p className="muted">None yet.</p>
              ) : (
                <p>
                  {formatDateTime(status.lastCheckpoint.createdAt)}:{' '}
                  <span className="mono">{status.lastCheckpoint.digest}</span>
                </p>
              )}
            </section>
            <section className="stack" aria-labelledby="streams-heading">
              <h2 id="streams-heading">Streams</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Application</th>
                      <th scope="col">Category</th>
                      <th scope="col">Last seal</th>
                      <th scope="col">Sealed through</th>
                      <th scope="col">Not sealed yet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.streams.map((stream) => (
                      <tr key={`${stream.appId}-${stream.category}`}>
                        <td>{stream.slug}</td>
                        <td>{words(stream.category)}</td>
                        <td>{stream.lastSealNo ?? '—'}</td>
                        <td>{formatDateTime(stream.sealedThrough)}</td>
                        <td className={stream.unsealedEvents > 0 ? 'outcome-error' : undefined}>
                          {formatNumber(stream.unsealedEvents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </LoadView>
    </section>
  );
}
