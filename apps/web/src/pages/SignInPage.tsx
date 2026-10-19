import { useState } from 'react';
import { Link } from 'react-router';
import { describeFailure } from '../api/errors';
import { type MfaChallenge, useAuth } from '../auth';
import { useCapabilities } from '../auth/capabilities';
import { NO_PANEL_ACCESS_MESSAGE } from '../auth/panel-access';
import { emailError, passwordError } from '../auth/validation';
import { Alert } from '../components/Alert';
import { PasswordField } from '../components/PasswordField';
import { preloadSecondFactor } from '../components/second-factor-loader';
import { SecondFactorStep } from '../components/SecondFactorStep';
import { TextField } from '../components/TextField';
import { useFocusFirstInvalid } from '../hooks/useFocusFirstInvalid';

interface FieldErrors {
  email: string | null;
  password: string | null;
}

// The password first, then the second factor (SecondFactorStep): once it
// passes, the session store switches to authenticated and GuestOnly sends
// the user on (back where they came from, or home).
export function SignInPage() {
  const { formRef, focusInvalid } = useFocusFirstInvalid();
  const auth = useAuth();
  // The links show only where they work (email configured, sign-up open).
  const capabilities = useCapabilities();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({ email: null, password: null });
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);

  async function submit() {
    const next = { email: emailError(email), password: passwordError(password) };
    setErrors(next);
    if (next.email !== null || next.password !== null) return;

    setSubmitting(true);
    setFailure(null);
    preloadSecondFactor();
    // Never throws: every failure, an answer that is not a challenge included,
    // comes back as a result (session.ts), so the button always comes back.
    const result = await auth.signIn(email.trim(), password);
    setSubmitting(false);
    if (result.ok) {
      setPassword('');
      setChallenge(result.data);
      return;
    }
    // 403: the right password, for an account the panel is not for.
    setFailure(
      result.failure.status === 401
        ? 'Invalid email or password.'
        : result.failure.status === 403
          ? NO_PANEL_ACCESS_MESSAGE
          : describeFailure(result.failure),
    );
  }

  if (challenge !== null) {
    return (
      <SecondFactorStep
        challenge={challenge}
        onStartOver={() => {
          setChallenge(null);
        }}
      />
    );
  }

  return (
    <main className="auth-page">
      <h1>Sign in</h1>
      <form
        ref={formRef}
        className="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit().then(focusInvalid);
        }}
      >
        {auth.status === 'anonymous' && auth.signedOut === 'failed' && (
          <Alert>
            You are signed out here, but the server could not be reached to end the session.{' '}
            <button type="button" onClick={() => void auth.retrySignOut()}>
              Retry sign-out
            </button>
          </Alert>
        )}
        {failure !== null && <Alert>{failure}</Alert>}
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          error={errors.email}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        {capabilities?.passwordReset === true && (
          <p>
            <Link to="/forgot-password">Forgot your password?</Link>
          </p>
        )}
        {capabilities?.signUp === true && (
          <p>
            New here? <Link to="/sign-up">Create an account</Link>
          </p>
        )}
      </form>
    </main>
  );
}
