import { redirect } from 'next/navigation';

/**
 * Messaging Providers moved to Super Admin
 * (/my-account/admin → Messaging Providers tab).
 *
 * Providers are a platform-level service Acumon runs across every
 * firm and meters for billing, so they sit alongside the other
 * SuperAdmin-only tabs (Products, Firms, Audit Trail, …) rather
 * than inside Methodology Admin.
 *
 * Keep this stub so old bookmarks / saved links don't 404 — it
 * just kicks the user across to the new home. Once enough time has
 * passed we can delete this file too.
 */
export default function MovedToSuperAdmin() {
  redirect('/my-account/admin');
}
