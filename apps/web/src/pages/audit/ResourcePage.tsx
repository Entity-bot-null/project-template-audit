import { Link, useParams, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { call } from '../../api/errors';
import { EventTable } from '../../audit/EventTable';
import { isUuid } from '../../audit/links';
import { LoadView } from '../../audit/LoadView';
import { CursorPager } from '../../audit/Pager';
import { useLoader } from '../../hooks/useLoader';

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const RESOURCE_TYPE = /^[a-z][a-z0-9_]{0,63}$/;

/** A resource's history in an application: events about it, or about what it contains. */
export function ResourcePage() {
  const { appId = '', resourceType = '', resourceId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const cursor = params.get('cursor');
  const valid = isUuid(appId) && RESOURCE_TYPE.test(resourceType) && ID.test(resourceId);
  const { state, retry } = useLoader(
    () =>
      valid
        ? call(
            api.GET('/api/connected-apps/{appId}/resources/{resourceType}/{resource}', {
              params: {
                path: { appId, resourceType, resource: resourceId },
                query: { limit: 50, ...(cursor === null ? {} : { cursor }) },
              },
            }),
          )
        : Promise.resolve({
            ok: false as const,
            failure: { status: 404, message: 'Not a resource' },
          }),
    `${appId}/${resourceType}/${resourceId}?${params.toString()}`,
  );
  return (
    <section className="stack" aria-labelledby="resource-heading">
      <p>
        <Link to="/events">← Events</Link>
      </p>
      <h1 id="resource-heading">
        <span className="mono">{`${resourceType} ${resourceId}`}</span>
      </h1>
      <LoadView state={state} retry={retry} label="the history">
        {(page) => (
          <>
            <EventTable events={page.items} caption="Newest first" />
            <CursorPager
              nextCursor={page.nextCursor}
              atNewest={cursor === null}
              onNewest={() => {
                setParams({});
              }}
              onOlder={(next) => {
                setParams({ cursor: next });
              }}
            />
          </>
        )}
      </LoadView>
    </section>
  );
}
