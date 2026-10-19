import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { call } from '../../api/errors';
import { useVisibleApps } from '../../audit/apps';
import { AppPicker } from '../../audit/AppPicker';
import { BarList, Heatmap, TimeSeriesChart } from '../../audit/charts';
import { Badge } from '../../audit/EventTable';
import { SelectField } from '../../audit/fields';
import { formatDay, formatNumber, words } from '../../audit/format';
import { LoadView } from '../../audit/LoadView';
import type { VisibleApp } from '../../audit/types';
import { useLoader } from '../../hooks/useLoader';

const PERIODS = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
] as const;

// An application's security at a glance: failed sign-ins by day, the
// addresses and countries they came from, when they happen, and the open
// anomalies. Each chart is one aggregation in the database, and has its
// numbers as a table too.
export function SecurityPage() {
  const apps = useVisibleApps();
  return (
    <section className="stack" aria-labelledby="security-heading">
      <h1 id="security-heading">Security</h1>
      <LoadView state={apps.state} retry={apps.retry} label="applications">
        {({ items }) => {
          const choosable = items.filter((app) => !app.system);
          return choosable.length === 0 ? (
            <p>No application to show yet.</p>
          ) : (
            <SecurityOf apps={choosable} />
          );
        }}
      </LoadView>
    </section>
  );
}

function SecurityOf({ apps }: { apps: VisibleApp[] }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('appId') ?? '';
  const appId = apps.some((app) => app.appId === asked) ? asked : (apps[0]?.appId ?? '');
  const days = PERIODS.find(([value]) => value === params.get('days'))?.[0] ?? '7';
  const { state, retry } = useLoader(
    () =>
      call(
        api.GET('/api/connected-apps/{appId}/security', {
          params: { path: { appId }, query: { days: Number(days) } },
        }),
      ),
    `${appId}/${days}`,
  );
  return (
    <>
      <div className="filters">
        <AppPicker
          apps={apps}
          value={appId}
          onChange={(next) => {
            setParams({ appId: next, days });
          }}
        />
        <SelectField
          label="Period"
          value={days}
          options={PERIODS}
          onChange={(next) => {
            setParams({ appId, days: next });
          }}
        />
      </div>
      <LoadView state={state} retry={retry} label="the security overview">
        {(security) => (
          <div className="stack">
            <TimeSeriesChart
              title="Failed sign-ins"
              description="Per day, UTC."
              labelHeading="Day"
              valueHeading="Failed sign-ins"
              points={security.failedSignIns.map((day) => ({
                label: formatDay(day.day),
                value: day.count,
              }))}
            />
            <div className="cards">
              <BarList
                title="Addresses with the most failed sign-ins"
                description="And how many accounts each one tried."
                labelHeading="Address"
                items={security.topIps.map((row) => ({
                  label: `${row.ip} (${formatNumber(row.accounts)} accounts)`,
                  value: row.count,
                }))}
                empty="No failed sign-ins."
              />
              {security.geolocation ? (
                <BarList
                  title="Countries"
                  description="Of failed sign-ins."
                  labelHeading="Country"
                  items={security.topCountries.map((row) => ({
                    label: row.country,
                    value: row.count,
                  }))}
                  empty="No failed sign-ins."
                />
              ) : (
                <p className="muted">
                  Countries need the IP geolocation files (docs/deploy-vps.md#ip-geolocation).
                </p>
              )}
            </div>
            <Heatmap
              title="When failed sign-ins happen"
              description="By day of the week and hour, UTC."
              cells={security.heatmap}
            />
            <section className="stack" aria-labelledby="anomalies-heading">
              <h2 id="anomalies-heading">Open anomalies</h2>
              {security.anomalies.length === 0 ? (
                <p className="muted">None open.</p>
              ) : (
                <ul>
                  {security.anomalies.map((anomaly) => (
                    <li key={`${anomaly.rule}-${anomaly.severity}`}>
                      <Badge kind="sev" value={anomaly.severity} />{' '}
                      <Link to={`/alerts?appId=${appId}&rule=${encodeURIComponent(anomaly.rule)}`}>
                        {words(anomaly.rule)}
                      </Link>{' '}
                      {formatNumber(anomaly.open)} open
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </LoadView>
    </>
  );
}
