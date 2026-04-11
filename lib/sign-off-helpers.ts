/**
 * Shared helpers for Preparer / Reviewer / RI / EQR sign-off dots.
 *
 * Keeps the role-gating logic consistent across Completion, Communication,
 * and anywhere else the same three-or-four dot pattern shows up.
 */

export interface TeamMemberLite {
  userId: string;
  role: string;
  /** Optional display name — accepted in both `name` and `userName` forms for compat with different callers */
  name?: string | null;
  userName?: string | null;
}

// Map display roles (as stored on AuditTeamMember.role) to sign-off keys.
export const ROLE_KEY_MAP: Record<string, string> = {
  Junior: 'preparer',
  Manager: 'reviewer',
  RI: 'ri',
  EQR: 'eqr',
};

/**
 * Returns true if the current user is on the engagement team in a role that
 * corresponds to the sign-off key being asked about. E.g. `canUserSign('ri', ...)`
 * is only true for users whose team role is 'RI'.
 */
export function canUserSign(
  roleKey: string,
  userId: string | undefined,
  teamMembers: TeamMemberLite[] | undefined,
): boolean {
  if (!userId || !teamMembers || teamMembers.length === 0) return false;
  return teamMembers.some(m => ROLE_KEY_MAP[m.role] === roleKey && m.userId === userId);
}

export function roleNotAllowedTooltip(roleKey: string): string {
  if (roleKey === 'ri') return 'Only the RI can sign here';
  if (roleKey === 'eqr') return 'Only the EQR can sign here';
  if (roleKey === 'preparer') return 'Only Preparers can sign here';
  if (roleKey === 'reviewer') return 'Only Reviewers can sign here';
  return `Only ${roleKey}s can sign here`;
}

export function hasEQROnTeam(teamMembers: TeamMemberLite[] | undefined): boolean {
  return !!teamMembers?.some(m => m.role === 'EQR');
}

export function roleLabel(roleKey: string): string {
  if (roleKey === 'ri') return 'RI';
  if (roleKey === 'eqr') return 'EQR';
  return roleKey.charAt(0).toUpperCase() + roleKey.slice(1);
}
