import { useState } from 'react';
import { describeFailure } from '../api/errors';
import { useAuth } from '../auth';
import { Alert } from '../components/Alert';
import { FocusHeading } from '../components/FocusHeading';
import { PasswordField } from '../components/PasswordField';
import { TextField } from '../components/TextField';

const CODE = /^\d{6}$/;

/** The password and a fresh code again (docs/adr/0012), for StepUpProvider. */
export function StepUpDialog({ onDone }: { onDone: (confirmed: boolean) => void }) {
  const auth = useAuth();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ password: string | null; code: string | null }>({
    password: null,
    code: null,
  });
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const entered = code.replace(/[\s-]/g, '');
    const found = {
      password: password.length === 0 ? 'Enter your password.' : null,
      code: CODE.test(entered) ? null : 'Enter the 6-digit code your authenticator app shows.',
    };
    setErrors(found);
    if (found.password !== null || found.code !== null) return;
    setSubmitting(true);
    setFailure(null);
    const result = await auth.stepUp(password, entered);
    setSubmitting(false);
    if (result.ok) {
      onDone(true);
      return;
    }
    setCode('');
    setFailure(
      result.failure.status === 403
        ? 'The password or the code is wrong, or the code was already used.'
        : describeFailure(result.failure),
    );
  }

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-up-heading"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone(false);
        }}
      >
        <FocusHeading>
          <span id="step-up-heading">Confirm it is you</span>
        </FocusHeading>
        <p>This action needs your password and a fresh code from your authenticator app.</p>
        <form
          className="stack"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {failure !== null && <Alert>{failure}</Alert>}
          <PasswordField
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            error={errors.password}
          />
          <TextField
            label="Code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={9}
            value={code}
            onChange={setCode}
            error={errors.code}
          />
          <div className="actions">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Confirming…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onDone(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
