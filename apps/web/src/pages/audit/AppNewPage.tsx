import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api/client';
import { call, describeFailure, failedField } from '../../api/errors';
import { forgetVisibleApps } from '../../audit/apps';
import { SecretOnce } from '../../audit/SecretOnce';
import { isReauthenticationRequired, useStepUp } from '../../audit/step-up';
import type { CreatedApp } from '../../audit/types';
import { Alert } from '../../components/Alert';
import { TextField } from '../../components/TextField';
import { useFocusFirstInvalid } from '../../hooks/useFocusFirstInvalid';

const SLUG = /^[a-z][a-z0-9-]{1,30}$/;
const ENVIRONMENT = /^[a-z][a-z0-9-]{0,15}$/;

interface Errors {
  name: string | null;
  slug: string | null;
  environment: string | null;
  webhookUrl: string | null;
}
const NONE: Errors = { name: null, slug: null, environment: null, webhookUrl: null };

// Registers an application (an environment of a project): the answer holds
// its signing key and pseudonymization key, shown this once
// (docs/design/audit-hub/contract.md). Needs a step-up.
export function AppNewPage() {
  const navigate = useNavigate();
  const stepUp = useStepUp();
  const { formRef, focusInvalid } = useFocusFirstInvalid();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [environment, setEnvironment] = useState('production');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [errors, setErrors] = useState<Errors>(NONE);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedApp | null>(null);

  async function submit() {
    const found: Errors = {
      name: name.trim().length === 0 ? 'Enter a name.' : null,
      slug: SLUG.test(slug)
        ? null
        : 'Lowercase letters, digits and dashes, 2 to 31, starting with a letter. It never changes.',
      environment: ENVIRONMENT.test(environment)
        ? null
        : 'Lowercase letters, digits and dashes, up to 16: production, staging…',
      webhookUrl:
        webhookUrl === '' || /^https?:\/\/\S+$/.test(webhookUrl)
          ? null
          : 'A URL: the application’s POST /api/audit/webhooks.',
    };
    setErrors(found);
    if (Object.values(found).some((error) => error !== null)) return;
    setBusy(true);
    setFailure(null);
    const result = await stepUp.recent(() =>
      call(
        api.POST('/api/connected-apps', {
          body: {
            name: name.trim(),
            slug,
            environment,
            ...(webhookUrl === '' ? {} : { webhookUrl }),
          },
        }),
      ),
    );
    setBusy(false);
    if (result.ok) {
      forgetVisibleApps();
      setCreated(result.data);
      return;
    }
    const field = failedField(result.failure);
    if (result.failure.status === 409) {
      setErrors({ ...NONE, slug: 'This slug is taken: choose another one.' });
    } else if (field === 'webhookUrl') {
      setErrors({
        ...NONE,
        webhookUrl: 'Use https (http only on this machine) and an address on the internet.',
      });
    } else if (isReauthenticationRequired(result.failure)) {
      setFailure('Nothing was registered: it needs you to confirm it is you.');
    } else {
      setFailure(describeFailure(result.failure));
    }
  }

  if (created !== null) {
    return (
      <section className="stack" aria-labelledby="created-heading">
        <h1 id="created-heading">{created.app.name} is registered</h1>
        <SecretOnce
          variables={created.credentials.variables}
          doneLabel="Go to the application"
          onDone={() => {
            void navigate(`/apps/${created.app.id}`, { replace: true });
          }}
        />
      </section>
    );
  }

  return (
    <section className="stack" aria-labelledby="new-app-heading">
      <p>
        <Link to="/apps">← Applications</Link>
      </p>
      <h1 id="new-app-heading">Register an application</h1>
      <form
        ref={formRef}
        className="stack auth-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit().then(focusInvalid);
        }}
      >
        {failure !== null && <Alert>{failure}</Alert>}
        <TextField
          label="Name"
          name="name"
          maxLength={100}
          value={name}
          onChange={setName}
          error={errors.name}
        />
        <TextField
          label="Slug"
          name="slug"
          maxLength={31}
          value={slug}
          onChange={setSlug}
          error={errors.slug}
        />
        <TextField
          label="Environment"
          name="environment"
          maxLength={16}
          value={environment}
          onChange={setEnvironment}
          error={errors.environment}
        />
        <TextField
          label="Webhook URL (optional)"
          name="webhookUrl"
          value={webhookUrl}
          onChange={setWebhookUrl}
          error={errors.webhookUrl}
        />
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Registering…' : 'Register'}
          </button>
        </div>
      </form>
    </section>
  );
}
