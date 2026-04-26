/**
 * Document Generator permission gate.
 *
 * Each DocumentTemplate carries a `sendPermission` value (set in the
 * Document Template Editor) that drives whether the Send / Download
 * routes are allowed to run for a given engagement. The check looks at
 * the engagement-level sign-off state stored in
 * `auditPermanentFile` under sectionKey '__signoffs', which is the
 * same record the methodology UI shows as the engagement's overall
 * green-dot state.
 *
 * Permission semantics:
 *   'None'     → always passes (legacy behaviour)
 *   'Preparer' → operator (Preparer) sign-off must exist
 *                (or any higher sign-off, since reviewer/partner
 *                sign-offs always come after preparer in the
 *                methodology workflow — but we don't assume that and
 *                just check the operator slot directly)
 *   'Reviewer' → reviewer OR partner sign-off must exist
 *   'RI'       → partner sign-off must exist
 *
 * Returns null when the gate passes, or a structured failure object
 * the route can put straight into a 403 response. The modal surfaces
 * the `reason` to render the "Permission to Send not Ready" popup.
 */
import { prisma } from '@/lib/db';

export type SendPermission = 'None' | 'Preparer' | 'Reviewer' | 'RI';

export interface SendPermissionFailure {
  error: string;
  reason: 'permission_not_ready';
  required: SendPermission;
  detail: string;
}

/**
 * Read the engagement's overall sign-off record. The shape mirrors what
 * `signoff-handler.ts` writes — keys are role names ('operator',
 * 'reviewer', 'partner') and the values are the sign-off metadata. We
 * only care about presence here, not the metadata.
 */
async function loadEngagementSignOffs(engagementId: string): Promise<Record<string, unknown>> {
  const row = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: '__signoffs' } },
  }).catch(() => null);
  if (!row?.data || typeof row.data !== 'object') return {};
  return row.data as Record<string, unknown>;
}

/**
 * Check whether the engagement's sign-off state satisfies a template's
 * `sendPermission`. Returns null on pass, a failure payload on fail.
 *
 * Designed to be called from the send / download document routes
 * BEFORE any rendering work — failing fast keeps the popup snappy
 * and avoids burning cycles producing a .docx the caller can't ship.
 */
export async function checkSendPermission(
  engagementId: string,
  template: { sendPermission?: string | null },
): Promise<SendPermissionFailure | null> {
  // Normalise to one of the four known values; treat unrecognised as
  // 'None' so a typo or migration mid-flight doesn't accidentally lock
  // every send.
  const raw = (template.sendPermission || 'None').trim();
  const required: SendPermission = raw === 'Preparer' || raw === 'Reviewer' || raw === 'RI'
    ? raw as SendPermission
    : 'None';

  if (required === 'None') return null;

  const signOffs = await loadEngagementSignOffs(engagementId);
  const hasOperator = signOffs.operator != null;
  const hasReviewer = signOffs.reviewer != null;
  const hasPartner = signOffs.partner != null;

  let passes = false;
  if (required === 'Preparer') passes = hasOperator || hasReviewer || hasPartner;
  else if (required === 'Reviewer') passes = hasReviewer || hasPartner;
  else if (required === 'RI') passes = hasPartner;

  if (passes) return null;

  // Build the popup detail string. We name the role we needed so the
  // auditor can see at a glance what's blocking. Keeps the wording
  // consistent with the user's spec — the popup itself is rendered by
  // the modal which reads the `reason` field.
  const roleLabel: Record<SendPermission, string> = {
    None: 'None',
    Preparer: 'Preparer',
    Reviewer: 'Reviewer (or RI)',
    RI: 'RI',
  };
  return {
    error: 'Permission to Send not Ready',
    reason: 'permission_not_ready',
    required,
    detail: `This document is gated on ${roleLabel[required]} sign-off, which has not been recorded on this engagement yet.`,
  };
}
