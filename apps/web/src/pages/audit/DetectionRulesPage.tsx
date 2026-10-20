import { useId, useState } from 'react';
import { api } from '../../api/client';
import { call, describeFailure } from '../../api/errors';
import { useAuth } from '../../auth';
import { Facts } from '../../audit/DetailParts';
import { Badge } from '../../audit/EventTable';
import { SelectField } from '../../audit/fields';
import { formatDateTime, words } from '../../audit/format';
import { LoadView } from '../../audit/LoadView';
import { isReauthenticationRequired, useStepUp } from '../../audit/step-up';
import type {
  DetectionRule,
  DetectionRules,
  EscalationPolicies,
  EscalationPolicy,
} from '../../audit/types';
import { Alert } from '../../components/Alert';
import { useLoader } from '../../hooks/useLoader';

type Outcome = { ok: boolean; text: string } | null;
type Severity = EscalationPolicy['severity'];

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const CHANNELS = ['email', 'chat'] as const;

const KIND_WORDS: Record<string, string> = {
  realtime: 'On every event',
  periodic: 'Every 5 minutes, over a window',
  health: "Every minute, over the sources' state",
  integrity: 'After each integrity verification',
};

const failureText = (failure: Parameters<typeof describeFailure>[0]) =>
  isReauthenticationRequired(failure)
    ? 'Nothing was saved: it needs you to confirm it is you.'
    : describeFailure(failure);

// What the detection rules look for, how serious each is, how its detections
// group into one alert and when it resolves by itself; and when an alert
// nobody acknowledges is escalated, by severity. Everyone who reads alerts
// sees them; an administrator tunes them (a step-up first): turns a rule off,
// sets its severity or its thresholds within bounds, and sets the escalation.
export function DetectionRulesPage() {
  const auth = useAuth();
  const admin = auth.status === 'authenticated' && auth.user.role === 'admin';
  const rules = useLoader(() => call(api.GET('/api/detection-rules')));
  const policies = useLoader(() => call(api.GET('/api/escalation-policies')));
  return (
    <section className="stack" aria-labelledby="rules-heading">
      <h1 id="rules-heading">Detection rules</h1>
      <p className="muted">
        What raises alerts, as this deployment is set.{' '}
        {admin
          ? 'Changes apply within 30 seconds and are recorded in the audit trail.'
          : 'An administrator can tune them.'}
      </p>
      <LoadView state={rules.state} retry={rules.retry} label="the detection rules">
        {(data) => <RuleList data={data} admin={admin} onSaved={() => void rules.refresh()} />}
      </LoadView>
      <LoadView state={policies.state} retry={policies.retry} label="the escalation policies">
        {(data) => <Escalation data={data} admin={admin} onSaved={() => void policies.refresh()} />}
      </LoadView>
    </section>
  );
}

function RuleList({
  data,
  admin,
  onSaved,
}: {
  data: DetectionRules;
  admin: boolean;
  onSaved: () => void;
}) {
  return (
    <>
      <p className="muted">
        A rule opens at most {data.maxNewAlertsPerHour} new alerts per application within an hour:
        past that, its detections fold into one alert, so a flood never buries the rest.
      </p>
      <ul className="stack plain-list">
        {data.items.map((rule) => (
          <RuleItem key={rule.id} rule={rule} admin={admin} onSaved={onSaved} />
        ))}
      </ul>
    </>
  );
}

function RuleItem({
  rule,
  admin,
  onSaved,
}: {
  rule: DetectionRule;
  admin: boolean;
  onSaved: () => void;
}) {
  const { settings } = rule;
  const severity = settings.severity ?? rule.severity;
  return (
    <li className="card stack">
      <h2 className="actions">
        <span>{rule.name}</span>
        {severity === null ? (
          <span className="muted">severity per detection</span>
        ) : (
          <Badge kind="sev" value={severity} />
        )}
        {!settings.enabled && <span className="badge">off</span>}
      </h2>
      <p>{rule.description}</p>
      <Facts
        rows={[
          [
            'Rule',
            <span key="id" className="mono">
              {rule.id}
            </span>,
          ],
          ['Runs', KIND_WORDS[rule.kind] ?? words(rule.kind)],
          ['One alert per', rule.grouping],
          ['Window', rule.window],
          [
            'Resolves by itself',
            rule.autoResolves ? 'Yes, once the condition clears' : 'No: someone resolves it',
          ],
          ...rule.params.map(
            (param) => [param.label, paramText(param, settings.params[param.name])] as const,
          ),
          ['Changed', settings.updatedAt === null ? null : formatDateTime(settings.updatedAt)],
        ]}
      />
      {admin && <RuleForm rule={rule} onSaved={onSaved} />}
    </li>
  );
}

/** A threshold as set, and its default when it differs. */
function paramText(param: DetectionRule['params'][number], value: number | undefined): string {
  const current = value ?? param.default;
  return `${String(current)} ${param.unit}${current === param.default ? ' (default)' : ` (default ${String(param.default)})`}`;
}

function RuleForm({ rule, onSaved }: { rule: DetectionRule; onSaved: () => void }) {
  const stepUp = useStepUp();
  const base = useId();
  const [enabled, setEnabled] = useState(rule.settings.enabled);
  const [severity, setSeverity] = useState(rule.settings.severity ?? '');
  const [params, setParams] = useState<Record<string, string>>(
    Object.fromEntries(
      rule.params.map((param) => [
        param.name,
        String(rule.settings.params[param.name] ?? param.default),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function save() {
    const values: Record<string, number> = {};
    for (const param of rule.params) {
      const value = Number(params[param.name]);
      if (!Number.isInteger(value) || value < param.min || value > param.max) {
        setOutcome({
          ok: false,
          text: `${param.label}: a whole number from ${String(param.min)} to ${String(param.max)}.`,
        });
        return;
      }
      values[param.name] = value;
    }
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(
        api.PUT('/api/detection-rules/{rule}', {
          params: { path: { rule: rule.id } },
          body: {
            enabled,
            severity: severity === '' ? null : (severity as Severity),
            params: values,
          },
        }),
      ),
    );
    setBusy(false);
    if (result.ok) {
      setOutcome({ ok: true, text: 'Saved.' });
      onSaved();
    } else {
      setOutcome({ ok: false, text: failureText(result.failure) });
    }
  }

  return (
    <details>
      <summary>Tune this rule</summary>
      <form
        className="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
            }}
          />
          On: it raises alerts
        </label>
        {!enabled && (
          <p className="muted">Off, it raises nothing: what it would detect goes unnoticed.</p>
        )}
        <div className="filters">
          {rule.severity !== null && (
            <SelectField
              label="Severity"
              value={severity}
              onChange={setSeverity}
              anyLabel={`Its own (${rule.severity})`}
              options={SEVERITIES.map((value) => [value, value] as const)}
            />
          )}
          {rule.params.map((param) => (
            <div key={param.name} className="field">
              <label htmlFor={`${base}-${param.name}`}>
                {param.label} ({param.unit}, {param.min} to {param.max})
              </label>
              <input
                id={`${base}-${param.name}`}
                inputMode="numeric"
                value={params[param.name] ?? ''}
                onChange={(event) => {
                  setParams((current) => ({ ...current, [param.name]: event.target.value }));
                }}
              />
            </div>
          ))}
        </div>
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </details>
  );
}

function Escalation({
  data,
  admin,
  onSaved,
}: {
  data: EscalationPolicies;
  admin: boolean;
  onSaved: () => void;
}) {
  const { available } = data;
  return (
    <section className="card stack" aria-labelledby="escalation-heading">
      <h2 id="escalation-heading">Escalation</h2>
      <p className="muted">
        An alert nobody acknowledges is sent again, by severity: email to the administrators and the
        application&apos;s auditors, and the chat channels. Acknowledging it (or putting it in
        review) stops that; a silence holds it.
      </p>
      <p>
        This deployment sends {available.email ? 'email' : 'no email (SMTP is not set)'}
        {available.chat.length > 0
          ? ` and to ${available.chat.join(', ')}.`
          : ', and to no chat channel (none is set).'}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Severity</th>
              <th scope="col">Escalates</th>
              <th scope="col">First after</th>
              <th scope="col">Then every</th>
              <th scope="col">At most</th>
              <th scope="col">Through</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((policy) => (
              <tr key={policy.severity}>
                <th scope="row">
                  <Badge kind="sev" value={policy.severity} />
                </th>
                <td>{policy.enabled ? 'Yes' : 'No'}</td>
                <td>{policy.firstAfterMinutes} min</td>
                <td>{policy.repeatEveryMinutes} min</td>
                <td>{policy.maxEscalations} times</td>
                <td>{policy.channels.length === 0 ? '—' : policy.channels.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {admin &&
        data.items.map((policy) => (
          <PolicyForm key={policy.severity} policy={policy} onSaved={onSaved} />
        ))}
    </section>
  );
}

function PolicyForm({ policy, onSaved }: { policy: EscalationPolicy; onSaved: () => void }) {
  const stepUp = useStepUp();
  const base = useId();
  const [enabled, setEnabled] = useState(policy.enabled);
  const [first, setFirst] = useState(String(policy.firstAfterMinutes));
  const [every, setEvery] = useState(String(policy.repeatEveryMinutes));
  const [times, setTimes] = useState(String(policy.maxEscalations));
  const [channels, setChannels] = useState<EscalationPolicy['channels']>(policy.channels);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function save() {
    const numbers = [
      ['First after', first, 1, 10080],
      ['Then every', every, 5, 10080],
      ['At most', times, 1, 10],
    ] as const;
    for (const [label, value, min, max] of numbers) {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        setOutcome({
          ok: false,
          text: `${label}: a whole number from ${String(min)} to ${String(max)}.`,
        });
        return;
      }
    }
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(
        api.PUT('/api/escalation-policies/{severity}', {
          params: { path: { severity: policy.severity } },
          body: {
            enabled,
            firstAfterMinutes: Number(first),
            repeatEveryMinutes: Number(every),
            maxEscalations: Number(times),
            channels,
          },
        }),
      ),
    );
    setBusy(false);
    if (result.ok) {
      setOutcome({ ok: true, text: 'Saved.' });
      onSaved();
    } else {
      setOutcome({ ok: false, text: failureText(result.failure) });
    }
  }

  return (
    <details>
      <summary>Change the escalation of {policy.severity} alerts</summary>
      <form
        className="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
            }}
          />
          Escalate {policy.severity} alerts nobody acknowledges
        </label>
        <div className="filters">
          <div className="field">
            <label htmlFor={`${base}-first`}>First after (minutes)</label>
            <input
              id={`${base}-first`}
              inputMode="numeric"
              value={first}
              onChange={(event) => {
                setFirst(event.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${base}-every`}>Then every (minutes)</label>
            <input
              id={`${base}-every`}
              inputMode="numeric"
              value={every}
              onChange={(event) => {
                setEvery(event.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${base}-times`}>At most (times)</label>
            <input
              id={`${base}-times`}
              inputMode="numeric"
              value={times}
              onChange={(event) => {
                setTimes(event.target.value);
              }}
            />
          </div>
        </div>
        <fieldset className="checkboxes">
          <legend>Through</legend>
          {CHANNELS.map((channel) => (
            <label key={channel} className="checkbox">
              <input
                type="checkbox"
                checked={channels.includes(channel)}
                onChange={(event) => {
                  setChannels((current) =>
                    event.target.checked
                      ? [...current, channel]
                      : current.filter((value) => value !== channel),
                  );
                }}
              />
              {channel === 'email' ? 'Email' : 'Chat (Slack, Teams)'}
            </label>
          ))}
        </fieldset>
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </details>
  );
}
