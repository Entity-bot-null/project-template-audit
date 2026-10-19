import { useState } from 'react';
import { api } from '../api/client';
import { call, describeFailure } from '../api/errors';
import { formatDateTime } from '../audit/format';
import { LoadView } from '../audit/LoadView';
import { isReauthenticationRequired, useStepUp } from '../audit/step-up';
import { Alert } from '../components/Alert';
import { useLoader } from '../hooks/useLoader';

const fetchStatus = () => call(api.GET('/api/account/mfa'));

/** The person's own second factor: since when, the recovery codes left, and new ones. */
export function AccountMfaSection() {
  const stepUp = useStepUp();
  const [version, setVersion] = useState(0);
  const { state, retry } = useLoader(fetchStatus, version);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function regenerate() {
    setBusy(true);
    setFailure(null);
    const result = await stepUp.recent(() => call(api.POST('/api/account/mfa/recovery-codes')));
    setBusy(false);
    if (result.ok) {
      setCodes(result.data.recoveryCodes);
      setVersion((current) => current + 1);
    } else {
      setFailure(
        isReauthenticationRequired(result.failure)
          ? 'No new codes: it needs you to confirm it is you.'
          : describeFailure(result.failure),
      );
    }
  }

  return (
    <section className="stack" aria-labelledby="mfa-heading">
      <h2 id="mfa-heading">Two-step verification</h2>
      <LoadView state={state} retry={retry} label="your second factor">
        {(status) => (
          <p>
            {status.confirmedAt === null
              ? 'Not set up.'
              : `On since ${formatDateTime(status.confirmedAt)}. Recovery codes left: ${String(status.recoveryCodesLeft)}.`}
          </p>
        )}
      </LoadView>
      {failure !== null && <Alert>{failure}</Alert>}
      {codes !== null ? (
        <div className="secret-once stack">
          <p>
            <strong>Your new recovery codes, shown this once.</strong> The old ones no longer work.
            Each signs you in once without your phone.
          </p>
          <ol className="recovery-codes" data-testid="recovery-codes">
            {codes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ol>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setCodes(null);
              }}
            >
              I have saved them
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void regenerate()}
          >
            {busy ? 'Making new codes…' : 'Make new recovery codes'}
          </button>
        </div>
      )}
    </section>
  );
}
