import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { describeFailure } from '../api/errors';
import { type MfaChallenge, useAuth } from '../auth';
import { type LinkToken, useLinkToken } from '../auth/useLinkToken';
import { Alert } from '../components/Alert';
import { FocusHeading } from '../components/FocusHeading';
import { PasswordField } from '../components/PasswordField';
import { preloadSecondFactor } from '../components/second-factor-loader';
import { SecondFactorStep } from '../components/SecondFactorStep';
import { useFocusFirstInvalid } from '../hooks/useFocusFirstInvalid';

type Outcome = 'invalid-link' | 'exists' | null;

// Finishes a sign-up with the link of its message and the password chosen
// with it; the account is created, sets up its second factor and is signed
// in. The token is handled by useLinkToken (out of the address bar and the
// history at once, in memory only). Only the form's submit spends it, and only with the right password,
// so a person who gets a message they did not ask for cannot finish someone
// else's sign-up.
export function ConfirmSignUpPage() {
  // Keyed by the link: a second link opened in this tab starts the page over.
  const { linkId, ...link } = useLinkToken();
  return <ConfirmSignUpContent key={linkId} {...link} />;
}

function ConfirmSignUpContent({ token, dropToken }: LinkToken) {
  const { formRef, focusInvalid } = useFocusFirstInvalid();
  const auth = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);

  async function submit(currentToken: string) {
    if (password.length === 0) {
      setError('Enter the password you chose when signing up.');
      return;
    }
    setError(null);
    setSubmitting(true);
    setFailure(null);
    preloadSecondFactor();
    const result = await auth.confirmSignUp(currentToken, password);
    setSubmitting(false);
    if (result.ok) {
      dropToken();
      setPassword('');
      setChallenge(result.data);
      return;
    }
    const { status } = result.failure;
    if (status === 401) {
      setError(
        'This is not the password you chose when signing up. A few wrong tries cancel the sign-up.',
      );
    } else if (status === 404) {
      dropToken();
      setOutcome('invalid-link');
    } else if (status === 409) {
      dropToken();
      setOutcome('exists');
    } else if (status === 403) {
      setFailure('Sign-up is closed here. Ask your administrator for an account.');
    } else {
      setFailure(describeFailure(result.failure));
    }
  }

  // The account exists now: it signs in once its second factor is set up.
  if (challenge !== null) {
    return (
      <SecondFactorStep
        challenge={challenge}
        onSignedIn={() => {
          void navigate('/', { replace: true });
        }}
        onStartOver={() => {
          void navigate('/sign-in', { replace: true });
        }}
      />
    );
  }

  if (outcome === 'exists') {
    return (
      <main className="auth-page stack">
        <FocusHeading>You already have an account</FocusHeading>
        <Alert tone="info">An account with this address exists: sign in with it.</Alert>
        <p>
          <Link to="/sign-in">Sign in</Link>
        </p>
      </main>
    );
  }

  if (token === null) {
    return (
      <main className="auth-page stack">
        <FocusHeading>This link does not work</FocusHeading>
        <Alert>
          {outcome === 'invalid-link'
            ? 'This link was already used, has expired, or was replaced by a newer sign-up.'
            : 'This link is incomplete. Open the whole link from the message, or sign up again.'}
        </Alert>
        <p>
          <Link to="/sign-up">Sign up again</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <h1>Confirm your account</h1>
      <form
        ref={formRef}
        className="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit(token).then(focusInvalid);
        }}
      >
        <p>Enter the password you chose when signing up to finish creating your account.</p>
        {failure !== null && <Alert>{failure}</Alert>}
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={error}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Confirming…' : 'Confirm my account'}
        </button>
      </form>
    </main>
  );
}
