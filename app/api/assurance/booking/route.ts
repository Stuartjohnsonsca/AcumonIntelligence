import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clientName } = await request.json();

    // For now, generate a mailto link.
    // Future: integrate with the Acumon booking app or Microsoft Graph API
    const subject = encodeURIComponent(`Assurance Discussion - ${clientName || 'New Client'}`);
    const body = encodeURIComponent(
      `Dear Thanzil,\n\nI would like to arrange a meeting to discuss assurance requirements for ${clientName || 'our organisation'}.\n\nPlease let me know your availability during office hours (Monday-Friday, 9am-5pm).\n\nBest regards,\n${session.user.name || ''}`,
    );

    const mailtoLink = `mailto:thanzil.khan@acumon.com?subject=${subject}&body=${body}`;

    return NextResponse.json({ bookingUrl: mailtoLink, type: 'mailto' });
  } catch (err) {
    console.error('[Assurance:Booking] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
