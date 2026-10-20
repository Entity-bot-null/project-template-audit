import { createRoutesFromElements, Route } from 'react-router';
import { GuestOnly, RequireAuth, RequireRole } from './auth';
import { LoadingScreen } from './components/LoadingScreen';
import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorPage } from './pages/RouteErrorPage';
import { SignInPage } from './pages/SignInPage';

// Every route, guarded as a layout route. Add a screen by placing its route
// under the guard it needs; the matching API routes need @Auth() as well, and
// its pattern goes in the API's Web Vitals pages (WEB_VITALS_ROUTES, in
// apps/api/src/telemetry/web-vitals.schemas.ts: webVitalsReporter.spec.ts
// fails until it is there). Screens few visits need are loaded when opened
// (lazy): the bundle every visit downloads stays within its budget
// (docs/testing.md#performance-budget).
const READERS = ['admin', 'auditor', 'viewer'] as const;
const EXPORTERS = ['admin', 'auditor'] as const;

export const routes = createRoutesFromElements(
  <Route errorElement={<RouteErrorPage />} hydrateFallbackElement={<LoadingScreen />}>
    <Route element={<GuestOnly />}>
      <Route path="sign-in" element={<SignInPage />} />
      <Route
        path="forgot-password"
        lazy={() =>
          import('./pages/ForgotPasswordPage').then(({ ForgotPasswordPage }) => ({
            Component: ForgotPasswordPage,
          }))
        }
      />
      <Route
        path="sign-up"
        lazy={() =>
          import('./pages/SignUpPage').then(({ SignUpPage }) => ({ Component: SignUpPage }))
        }
      />
    </Route>
    {/* Signed in or not: a person may open an emailed link in any state. */}
    <Route
      path="accept-invitation"
      lazy={() =>
        import('./pages/AcceptInvitationPage').then(({ AcceptInvitationPage }) => ({
          Component: AcceptInvitationPage,
        }))
      }
    />
    <Route
      path="confirm-email-change"
      lazy={() =>
        import('./pages/ConfirmEmailChangePage').then(({ ConfirmEmailChangePage }) => ({
          Component: ConfirmEmailChangePage,
        }))
      }
    />
    <Route
      path="revert-email-change"
      lazy={() =>
        import('./pages/RevertEmailChangePage').then(({ RevertEmailChangePage }) => ({
          Component: RevertEmailChangePage,
        }))
      }
    />
    <Route
      path="confirm-sign-up"
      lazy={() =>
        import('./pages/ConfirmSignUpPage').then(({ ConfirmSignUpPage }) => ({
          Component: ConfirmSignUpPage,
        }))
      }
    />
    <Route
      path="reset-password"
      lazy={() =>
        import('./pages/ResetPasswordPage').then(({ ResetPasswordPage }) => ({
          Component: ResetPasswordPage,
        }))
      }
    />
    <Route element={<RequireAuth />}>
      {/* The signed-in frame and every page in it load after sign-in: the
          bundle every visit downloads is the shell and sign-in only. */}
      <Route
        lazy={() =>
          import('./components/AppLayout').then(({ AppLayout }) => ({ Component: AppLayout }))
        }
      >
        {/* The overview for those who read audit data, a welcome for members. */}
        <Route
          index
          lazy={() =>
            import('./pages/IndexPage').then(({ IndexPage }) => ({ Component: IndexPage }))
          }
        />
        <Route
          path="account"
          lazy={() =>
            import('./pages/AccountPage').then(({ AccountPage }) => ({ Component: AccountPage }))
          }
        />
        {/* The admin pages (docs/adr/0014): every one a lazy chunk of its own. */}
        <Route element={<RequireRole role={READERS} />}>
          <Route
            path="events"
            lazy={() =>
              import('./pages/audit/EventsPage').then(({ EventsPage }) => ({
                Component: EventsPage,
              }))
            }
          />
          <Route
            path="events/:eventId"
            lazy={() =>
              import('./pages/audit/EventDetailPage').then(({ EventDetailPage }) => ({
                Component: EventDetailPage,
              }))
            }
          />
          <Route
            path="apps/:appId/actors/:actorId"
            lazy={() =>
              import('./pages/audit/ActorPage').then(({ ActorPage }) => ({ Component: ActorPage }))
            }
          />
          <Route
            path="apps/:appId/resources/:resourceType/:resourceId"
            lazy={() =>
              import('./pages/audit/ResourcePage').then(({ ResourcePage }) => ({
                Component: ResourcePage,
              }))
            }
          />
          <Route
            path="security"
            lazy={() =>
              import('./pages/audit/SecurityPage').then(({ SecurityPage }) => ({
                Component: SecurityPage,
              }))
            }
          />
          <Route
            path="alerts"
            lazy={() =>
              import('./pages/audit/AlertsPage').then(({ AlertsPage }) => ({
                Component: AlertsPage,
              }))
            }
          />
          <Route
            path="alerts/:alertId"
            lazy={() =>
              import('./pages/audit/AlertDetailPage').then(({ AlertDetailPage }) => ({
                Component: AlertDetailPage,
              }))
            }
          />
          <Route
            path="soc"
            lazy={() =>
              import('./pages/audit/SocPage').then(({ SocPage }) => ({ Component: SocPage }))
            }
          />
          <Route
            path="detection-rules"
            lazy={() =>
              import('./pages/audit/DetectionRulesPage').then(({ DetectionRulesPage }) => ({
                Component: DetectionRulesPage,
              }))
            }
          />
          <Route
            path="account/notifications"
            lazy={() =>
              import('./pages/audit/NotificationSettingsPage').then(
                ({ NotificationSettingsPage }) => ({ Component: NotificationSettingsPage }),
              )
            }
          />
        </Route>
        <Route element={<RequireRole role={EXPORTERS} />}>
          <Route
            path="exports"
            lazy={() =>
              import('./pages/audit/ExportsPage').then(({ ExportsPage }) => ({
                Component: ExportsPage,
              }))
            }
          />
        </Route>
        <Route element={<RequireRole role="admin" />}>
          <Route
            path="admin/users"
            lazy={() =>
              import('./pages/AdminUsersPage').then(({ AdminUsersPage }) => ({
                Component: AdminUsersPage,
              }))
            }
          />
          <Route
            path="admin/invitations"
            lazy={() =>
              import('./pages/AdminInvitationsPage').then(({ AdminInvitationsPage }) => ({
                Component: AdminInvitationsPage,
              }))
            }
          />
          <Route
            path="apps"
            lazy={() =>
              import('./pages/audit/AppsPage').then(({ AppsPage }) => ({ Component: AppsPage }))
            }
          />
          <Route
            path="apps/new"
            lazy={() =>
              import('./pages/audit/AppNewPage').then(({ AppNewPage }) => ({
                Component: AppNewPage,
              }))
            }
          />
          <Route
            path="apps/:appId"
            lazy={() =>
              import('./pages/audit/AppDetailPage').then(({ AppDetailPage }) => ({
                Component: AppDetailPage,
              }))
            }
          />
          <Route
            path="response-actions"
            lazy={() =>
              import('./pages/audit/ResponseActionsPage').then(({ ResponseActionsPage }) => ({
                Component: ResponseActionsPage,
              }))
            }
          />
          <Route
            path="retention"
            lazy={() =>
              import('./pages/audit/RetentionPage').then(({ RetentionPage }) => ({
                Component: RetentionPage,
              }))
            }
          />
          <Route
            path="integrity"
            lazy={() =>
              import('./pages/audit/IntegrityPage').then(({ IntegrityPage }) => ({
                Component: IntegrityPage,
              }))
            }
          />
          <Route
            path="admin/users/:userId"
            lazy={() =>
              import('./pages/audit/AdminUserPage').then(({ AdminUserPage }) => ({
                Component: AdminUserPage,
              }))
            }
          />
        </Route>
      </Route>
    </Route>
    <Route path="*" element={<NotFoundPage />} />
  </Route>,
);
