import { describe, it, expect } from 'vitest';
import { SCREENS, canAccess, requireRole, visibleScreens } from './navigation';

describe('navigation', () => {
  it('hides screens the caller has no role for', () => {
    const reader = visibleScreens(['Router.Read']).map((s) => s.path);

    expect(reader).toContain('/scoreboard');
    expect(reader).not.toContain('/approvals');
    expect(reader).not.toContain('/request');
  });

  it('grants the approver the approvals screen', () => {
    expect(visibleScreens(['Approver']).map((s) => s.path)).toContain('/approvals');
  });

  it('gives every screen at least one role, so nothing is unintentionally public', () => {
    expect(SCREENS.every((s) => s.requiredRoles.length > 0)).toBe(true);
  });

  it('covers every demo beat that has a screen', () => {
    const beats = new Set(SCREENS.map((s) => s.beat).filter(Boolean));
    expect([...beats].sort((a, b) => Number(a) - Number(b))).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('states why an action is unavailable rather than only disabling it', () => {
    const blocked = requireRole(['Router.Invoke'], 'Approver', 'Approving this escalation');

    expect(blocked.disabled).toBe(true);
    expect(String(blocked.reason)).toContain('Approver');
  });

  it('allows the action when the role is held', () => {
    expect(requireRole(['Approver'], 'Approver', 'Approving').disabled).toBe(false);
  });

  it('canAccess agrees with visibleScreens', () => {
    const roles = ['Router.Read'] as const;
    for (const screen of SCREENS) {
      expect(canAccess(screen, roles)).toBe(visibleScreens(roles).includes(screen));
    }
  });
});
