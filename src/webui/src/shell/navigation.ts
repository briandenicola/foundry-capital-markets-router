import type { ReactNode } from 'react';

/** App roles from the Entra app registration. */
export type AppRole = 'Router.Invoke' | 'Router.Read' | 'Approver';

export interface ScreenDefinition {
  path: string;
  title: string;
  /** Any one of these grants navigation. Empty means every authenticated user. */
  requiredRoles: AppRole[];
  /** Demo beat this screen serves, for the runbook cross-reference. */
  beat?: number;
}

/**
 * The screen inventory from docs/ui-design.md.
 *
 * Navigation is hidden for roles that cannot use a screen, but actions inside a screen render
 * disabled with a stated reason rather than vanishing — the approval beat needs something visible
 * to refuse, and an invisible control demonstrates nothing.
 */
export const SCREENS: readonly ScreenDefinition[] = [
  { path: '/request', title: 'Request console', requiredRoles: ['Router.Invoke'], beat: 2 },
  { path: '/scoreboard', title: 'Scoreboard', requiredRoles: ['Router.Read'], beat: 3 },
  { path: '/comparison', title: 'Cost comparison', requiredRoles: ['Router.Read'], beat: 3 },
  { path: '/decisions', title: 'Decisions', requiredRoles: ['Router.Read'], beat: 3 },
  { path: '/research', title: 'Research', requiredRoles: ['Router.Invoke'], beat: 7 },
  { path: '/surveillance', title: 'Surveillance triage', requiredRoles: ['Router.Read'], beat: 4 },
  { path: '/order-routing', title: 'Order routing', requiredRoles: ['Router.Read'], beat: 6 },
  { path: '/approvals', title: 'Approvals', requiredRoles: ['Approver'], beat: 6 },
  { path: '/policy', title: 'Policy sets', requiredRoles: ['Router.Read'], beat: 5 },
  { path: '/audit', title: 'Audit reconstruction', requiredRoles: ['Router.Read'], beat: 8 },
] as const;

export function visibleScreens(roles: readonly AppRole[]): ScreenDefinition[] {
  return SCREENS.filter(
    (screen) => screen.requiredRoles.length === 0 || screen.requiredRoles.some((r) => roles.includes(r)),
  );
}

export function canAccess(screen: ScreenDefinition, roles: readonly AppRole[]): boolean {
  return screen.requiredRoles.length === 0 || screen.requiredRoles.some((r) => roles.includes(r));
}

export interface DisabledAction {
  disabled: boolean;
  reason?: ReactNode;
}

/**
 * Why an action is unavailable, stated rather than implied.
 *
 * Segregation of duties is a claim the demo makes out loud; a greyed-out button with no
 * explanation is indistinguishable from a bug.
 */
export function requireRole(roles: readonly AppRole[], required: AppRole, action: string): DisabledAction {
  if (roles.includes(required)) {
    return { disabled: false };
  }
  return {
    disabled: true,
    reason: `${action} requires the ${required} role. Your account does not hold it.`,
  };
}
