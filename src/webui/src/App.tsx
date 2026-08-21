import type { ReactNode } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { visibleScreens, type AppRole } from './shell/navigation';
import { PlaceholderScreen } from './shell/PlaceholderScreen';
import { ApprovalDetailRoute, ApprovalsQueueRoute } from './features/approvals/routes';
import { OrderRoutingRoute } from './features/orderrouting/routes';
import { useApiClient } from './app/apiClient';
import type { ApiClient } from './api/client';

export interface AppProps {
  roles?: AppRole[];

  /**
   * The signed-in user's Entra object id.
   *
   * Null until MSAL is wired (T-028b), and null rather than a default: segregation of duties
   * compares the approver against the proposer, and an id the UI invented would let the approve
   * button light up for exactly the person it must not.
   */
  currentUserObjectId?: string | null;

  /** Injected in tests. Production builds construct one from the environment. */
  client?: ApiClient;
}

const noToken = () => Promise.resolve<string | null>(null);

/**
 * Application shell.
 *
 * Roles are hard-coded here until T-028b wires MSAL. The shape of the prop is the shape MSAL will
 * supply, so that task becomes a substitution rather than a rewrite.
 */
export function App({
  roles = ['Router.Invoke', 'Router.Read', 'Approver'],
  currentUserObjectId = null,
  client,
}: AppProps) {
  const screens = visibleScreens(roles);
  const defaultClient = useApiClient(noToken);
  const api = client ?? defaultClient;

  // Screens that exist. Everything else still renders a placeholder naming its demo beat, so an
  // unfinished screen reached during a rehearsal explains itself instead of looking broken.
  const implemented: Record<string, ReactNode> = {
    '/approvals': (
      <ApprovalsQueueRoute client={api} roles={roles} currentUserObjectId={currentUserObjectId} />
    ),
    '/order-routing': <OrderRoutingRoute client={api} />,
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Governed AI Exchange</h1>
        <nav className="app__nav">
          {screens.map((screen) => (
            <NavLink key={screen.path} to={screen.path}>
              {screen.title}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="app__main">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Navigate to={screens[0]?.path ?? '/scoreboard'} replace />} />
            {screens.map((screen) => (
              <Route
                key={screen.path}
                path={screen.path}
                element={
                  implemented[screen.path] ?? (
                    <PlaceholderScreen title={screen.title} beat={screen.beat} />
                  )
                }
              />
            ))}
            {roles.includes('Approver') && (
              <Route
                path="/approvals/:id"
                element={
                  <ApprovalDetailRoute
                    client={api}
                    roles={roles}
                    currentUserObjectId={currentUserObjectId}
                  />
                }
              />
            )}
            <Route path="*" element={<PlaceholderScreen title="Not found" />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
