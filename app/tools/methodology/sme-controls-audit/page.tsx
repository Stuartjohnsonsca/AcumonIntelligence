import { redirect } from 'next/navigation';

// Redirect old URL to new route — preserves bookmarks and external links
export default function LegacySMEControlsAuditRedirect() {
  redirect('/tools/methodology/StatControlsAudit');
}
