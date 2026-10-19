import { Link } from 'react-router';
import { api } from '../../api/client';
import { call } from '../../api/errors';
import { Badge } from '../../audit/EventTable';
import { formatDateTime } from '../../audit/format';
import { LoadView } from '../../audit/LoadView';
import { useLoader } from '../../hooks/useLoader';

const fetchApps = () => call(api.GET('/api/connected-apps'));

/** Administrators: the connected applications, each one an environment of a project. */
export function AppsPage() {
  const { state, retry } = useLoader(fetchApps);
  return (
    <section className="stack" aria-labelledby="apps-heading">
      <div className="page-header">
        <h1 id="apps-heading">Applications</h1>
        <Link to="/apps/new">Register an application</Link>
      </div>
      <LoadView state={state} retry={retry} label="applications">
        {(apps) =>
          apps.length === 0 ? (
            <p>No application yet: register the first one to receive its audit log.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Slug</th>
                    <th scope="col">Environment</th>
                    <th scope="col">Status</th>
                    <th scope="col">Signing keys</th>
                    <th scope="col">Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app) => (
                    <tr key={app.id}>
                      <td>
                        <Link to={`/apps/${app.id}`}>{app.name}</Link>
                      </td>
                      <td className="mono">{app.slug}</td>
                      <td>{app.environment}</td>
                      <td>
                        <Badge kind="status" value={app.status} />
                      </td>
                      <td>{app.keys.filter((key) => key.revokedAt === null).length} active</td>
                      <td>{formatDateTime(app.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </LoadView>
    </section>
  );
}
