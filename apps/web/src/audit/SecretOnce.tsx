import { useState } from 'react';
import { Alert } from '../components/Alert';

/**
 * Variables an application needs, its secrets among them, shown this once:
 * Audit Hub keeps only their ciphertexts. As `NAME=value` lines for the
 * application's environment, with a copy button.
 */
export function SecretOnce({
  variables,
  onDone,
  doneLabel = 'Done',
}: {
  variables: Record<string, unknown>;
  onDone: () => void;
  doneLabel?: string;
}) {
  const [kept, setKept] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const text = Object.entries(variables)
    .map(([name, value]) => `${name}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
  return (
    <div className="secret-once stack">
      <p>
        <strong>Shown this once.</strong> Put these in the application's environment (its secret
        store): Audit Hub cannot show them again.
      </p>
      <pre className="mono" data-testid="secret-variables">
        {text}
      </pre>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={() => {
            // No clipboard outside a secure context (a dev server over the LAN):
            // that rejects too, and says so.
            void Promise.resolve()
              .then(() => navigator.clipboard.writeText(`${text}\n`))
              .then(
                () => {
                  setCopied(true);
                },
                () => {
                  setCopied(false);
                },
              );
          }}
        >
          Copy
        </button>
      </div>
      {copied !== null && (
        <Alert tone={copied ? 'info' : 'error'}>
          {copied ? 'Copied.' : 'Could not copy: select the text instead.'}
        </Alert>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={kept}
          onChange={(event) => {
            setKept(event.target.checked);
          }}
        />
        I have stored them
      </label>
      <div className="actions">
        <button type="button" disabled={!kept} onClick={onDone}>
          {doneLabel}
        </button>
      </div>
    </div>
  );
}
