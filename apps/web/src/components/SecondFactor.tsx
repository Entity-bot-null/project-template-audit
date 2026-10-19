import { useEffect, useState } from 'react';
import { type ApiResult, describeFailure } from '../api/errors';
import { type AuthSession, type MfaChallenge, type MfaEnrollment, useAuth } from '../auth';
import { NO_PANEL_ACCESS_MESSAGE } from '../auth/panel-access';
import { startEnrollment } from '../auth/session';
import { useFocusFirstInvalid } from '../hooks/useFocusFirstInvalid';
import { Alert } from './Alert';
import { FocusHeading } from './FocusHeading';
import { TextField } from './TextField';

// The second factor's step of every sign-in (docs/adr/0012), loaded when a
// password step answers with a challenge: `verify` asks for a code from the
// authenticator app (or a recovery code), `enroll` sets the app up first and
// shows the recovery codes once. Only a session ends it; the challenge lasts
// five minutes and a few wrong codes, then the person starts over.

const CODE = /^\d{6}$/;

// One secret per challenge: each request replaces the secret the server
// keeps, so a second one (an effect run twice in development, a remount)
// would leave the person scanning a secret that no longer counts.
let pendingEnrollment: { token: string; result: Promise<ApiResult<MfaEnrollment>> } | null = null;

function enrollmentFor(challengeToken: string): Promise<ApiResult<MfaEnrollment>> {
  if (pendingEnrollment?.token !== challengeToken) {
    pendingEnrollment = { token: challengeToken, result: startEnrollment(challengeToken) };
  }
  return pendingEnrollment.result;
}

/** A code as people type it: spaces and dashes the app shows are not part of it. */
const digitsOf = (value: string) => value.replace(/[\s-]/g, '');

export function SecondFactor({
  challenge,
  onSignedIn,
  onStartOver,
}: {
  challenge: MfaChallenge;
  /** After the session started: a page outside GuestOnly moves on here. */
  onSignedIn?: () => void;
  onStartOver: () => void;
}) {
  return challenge.mfa === 'verify' ? (
    <Verify challengeToken={challenge.challengeToken} onStartOver={onStartOver} />
  ) : (
    <Enroll
      challengeToken={challenge.challengeToken}
      onSignedIn={onSignedIn}
      onStartOver={onStartOver}
    />
  );
}

/** Why a code was refused, for people: never the server's message as is. */
function refusal(status: number, failure: Parameters<typeof describeFailure>[0]): string {
  if (status === 401) {
    return 'That code did not work: it is wrong, was already used, or this step expired. Try the newest code, or start over.';
  }
  if (status === 409) return 'This set-up ended. Start over to set up your app again.';
  // The account lost its way into the panel since its password was checked.
  if (status === 403) return NO_PANEL_ACCESS_MESSAGE;
  return describeFailure(failure);
}

function Verify({
  challengeToken,
  onStartOver,
}: {
  challengeToken: string;
  onStartOver: () => void;
}) {
  const { formRef, focusInvalid } = useFocusFirstInvalid();
  const auth = useAuth();
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const entered = digitsOf(value);
    if (recovery ? value.trim().length === 0 : !CODE.test(entered)) {
      setError(
        recovery
          ? 'Enter one of your recovery codes.'
          : 'Enter the 6-digit code your authenticator app shows.',
      );
      return;
    }
    setError(null);
    setFailure(null);
    setSubmitting(true);
    const result = await auth.verifyMfa(
      challengeToken,
      recovery ? { recoveryCode: value.trim() } : { code: entered },
    );
    // On success the session starts and the page moves on.
    if (!result.ok) {
      setSubmitting(false);
      setValue('');
      setFailure(refusal(result.failure.status, result.failure));
    }
  }

  return (
    <main className="auth-page">
      <FocusHeading>Two-step verification</FocusHeading>
      <form
        ref={formRef}
        className="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit().then(focusInvalid);
        }}
      >
        <p>
          {recovery
            ? 'Enter one of the recovery codes you saved. Each works once.'
            : 'Enter the code your authenticator app shows for Audit Hub.'}
        </p>
        {failure !== null && <Alert>{failure}</Alert>}
        {recovery ? (
          <TextField
            key="recovery"
            label="Recovery code"
            name="recovery-code"
            autoComplete="off"
            maxLength={32}
            value={value}
            onChange={setValue}
            error={error}
          />
        ) : (
          <TextField
            key="code"
            label="Code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={9}
            value={value}
            onChange={setValue}
            error={error}
          />
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Verifying…' : 'Verify'}
        </button>
        <p>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setRecovery(!recovery);
              setValue('');
              setError(null);
            }}
          >
            {recovery ? 'Use your authenticator app' : 'Use a recovery code instead'}
          </button>
        </p>
        <p>
          <button type="button" className="link-button" onClick={onStartOver}>
            Start over
          </button>
        </p>
      </form>
    </main>
  );
}

function Enroll({
  challengeToken,
  onSignedIn,
  onStartOver,
}: {
  challengeToken: string;
  onSignedIn?: () => void;
  onStartOver: () => void;
}) {
  const { formRef, focusInvalid } = useFocusFirstInvalid();
  const auth = useAuth();
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [enrolled, setEnrolled] = useState<{
    session: AuthSession;
    recoveryCodes: string[];
  } | null>(null);

  useEffect(() => {
    let current = true;
    void enrollmentFor(challengeToken).then((result) => {
      if (!current) return;
      if (result.ok) setEnrollment(result.data);
      else setLoadFailure(refusal(result.failure.status, result.failure));
    });
    return () => {
      current = false;
    };
  }, [challengeToken]);

  async function submit() {
    const entered = digitsOf(code);
    if (!CODE.test(entered)) {
      setError('Enter the 6-digit code your authenticator app shows.');
      return;
    }
    setError(null);
    setFailure(null);
    setSubmitting(true);
    const result = await auth.confirmEnrollment(challengeToken, entered);
    setSubmitting(false);
    if (result.ok) {
      const { recoveryCodes, ...session } = result.data;
      setEnrolled({ session, recoveryCodes });
      return;
    }
    setCode('');
    setFailure(refusal(result.failure.status, result.failure));
  }

  if (enrolled !== null) {
    return (
      <RecoveryCodes
        codes={enrolled.recoveryCodes}
        onDone={() => {
          auth.enterSession(enrolled.session);
          onSignedIn?.();
        }}
      />
    );
  }

  if (loadFailure !== null) {
    return (
      <main className="auth-page stack">
        <FocusHeading>Set up two-step verification</FocusHeading>
        <Alert>{loadFailure}</Alert>
        <p>
          <button type="button" onClick={onStartOver}>
            Start over
          </button>
        </p>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <FocusHeading>Set up two-step verification</FocusHeading>
      {enrollment === null ? (
        <p role="status">Preparing your code…</p>
      ) : (
        <form
          ref={formRef}
          className="stack"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit().then(focusInvalid);
          }}
        >
          <p>
            Every account in Audit Hub signs in with a code from an authenticator app (such as
            Google Authenticator, Microsoft Authenticator, 1Password or Bitwarden). Scan this code
            with the app, then enter the code it shows.
          </p>
          <QrCode rows={enrollment.qr} label="QR code to add Audit Hub to your authenticator app" />
          <details>
            <summary>Can&apos;t scan it? Enter this key instead</summary>
            <p>
              <code className="secret" data-testid="mfa-secret">
                {enrollment.secret.replace(/(.{4})(?=.)/g, '$1 ')}
              </code>
            </p>
          </details>
          {failure !== null && <Alert>{failure}</Alert>}
          <TextField
            label="Code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={9}
            value={code}
            onChange={setCode}
            error={error}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Checking…' : 'Turn on two-step verification'}
          </button>
          <p>
            <button type="button" className="link-button" onClick={onStartOver}>
              Start over
            </button>
          </p>
        </form>
      )}
    </main>
  );
}

/**
 * The QR code's modules as one SVG path, with the four-module quiet zone
 * scanners need around it. Drawn here from the rows the API sends: the
 * secret never goes to a third-party service, and no QR library ships.
 */
export function QrCode({ rows, label }: { rows: string[]; label: string }) {
  const size = rows.length + 8;
  let path = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === '1') path += `M${String(x + 4)} ${String(y + 4)}h1v1h-1z`;
    }
  });
  return (
    <svg
      className="qr-code"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** The recovery codes, shown once: the session starts once they are kept. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [kept, setKept] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const text = `Audit Hub recovery codes (each works once)\n\n${codes.join('\n')}\n`;
  return (
    <main className="auth-page stack">
      <FocusHeading>Save your recovery codes</FocusHeading>
      <p>
        If you lose your phone, each of these codes signs you in once instead of a code from the
        app. Keep them somewhere safe, such as a password manager. They are not shown again.
      </p>
      <ol className="recovery-codes" data-testid="recovery-codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <p className="recovery-actions">
        <button
          type="button"
          onClick={() => {
            // No clipboard outside a secure context (a dev server over the LAN):
            // that rejects too, and says so.
            void Promise.resolve()
              .then(() => navigator.clipboard.writeText(text))
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
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download="audit-hub-recovery-codes.txt"
        >
          Download
        </a>
      </p>
      {copied !== null && (
        <Alert tone={copied ? 'info' : 'error'}>
          {copied ? 'Copied.' : 'Could not copy: select the codes, or download them.'}
        </Alert>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={kept}
          onChange={(event) => {
            setKept(event.target.checked);
          }}
        />{' '}
        I have saved these codes
      </label>
      <button type="button" disabled={!kept} onClick={onDone}>
        Continue
      </button>
    </main>
  );
}
