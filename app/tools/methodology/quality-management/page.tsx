import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ShieldCheck } from 'lucide-react';

/**
 * Quality Management placeholder page.
 *
 * Added as a nav-level option under the Audit dropdown. The feature spec is
 * still to be defined — this stub exists so the dropdown link doesn't 404.
 * Replace the body once the spec lands.
 */
export default async function QualityManagementPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/methodology/quality-management');
  }
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-xl w-full bg-white border border-slate-200 rounded-xl shadow-sm p-10 text-center">
        <div className="flex justify-center mb-6">
          <div className="h-14 w-14 rounded-full bg-blue-50 flex items-center justify-center">
            <ShieldCheck className="h-7 w-7 text-blue-600" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-slate-900 mb-3">Quality Management</h1>
        <p className="text-slate-600 mb-2">
          A new module covering the firm&apos;s Quality Management system (ISQM 1 / ISQM 2 / ISA 220).
        </p>
        <p className="text-sm text-slate-500 mb-8">
          Specification in progress — this area will capture risk assessment, policies, monitoring, and remediation for the firm&apos;s system of quality management.
        </p>
        <Link
          href="/"
          className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
