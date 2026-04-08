import { redirect } from 'next/navigation';

// Redirect old URL to new route — preserves bookmarks and external links
export default function LegacySMEAuditRedirect() {
  redirect('/tools/methodology/StatAudit');
}
