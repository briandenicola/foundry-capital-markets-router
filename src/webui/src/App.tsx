import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { visibleScreens, type AppRole } from './shell/navigation';
import { PlaceholderScreen } from './shell/PlaceholderScreen';

/**
 * Application shell.
 *
 * Roles are hard-coded here until T-028b wires MSAL. The shape of the prop is the shape MSAL will
 * supply, so that task becomes a substitution rather than a rewrite.
 */
export function App({ roles = ['Router.Invoke', 'Router.Read'] }: { roles?: AppRole[] }) {
  const screens = visibleScreens(roles);

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
                element={<PlaceholderScreen title={screen.title} beat={screen.beat} />}
              />
            ))}
            <Route path="*" element={<PlaceholderScreen title="Not found" />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
