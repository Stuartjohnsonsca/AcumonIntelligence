import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { extractMeetingMinutes } from '@/lib/meeting-minutes-ai';
import { listRecentMeetings, getMeetingTranscript, createTeamsMeeting, isTeamsConfigured } from '@/lib/teams-meetings';
import { sendMeetingActionsEmail, sendExpertActionEmail } from '@/lib/audit-email';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// Helper: get/set permanent file data for sign-offs
async function getSignOffs(engagementId: string, meetingId: string) {
  const row = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: `meeting_${meetingId}_signoffs` } },
  });
  return (row?.data as Record<string, unknown>) || {};
}

async function setSignOffs(engagementId: string, meetingId: string, data: Record<string, unknown>) {
  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: `meeting_${meetingId}_signoffs` } },
    create: { engagementId, sectionKey: `meeting_${meetingId}_signoffs`, data: data as object },
    update: { data: data as object },
  });
}

// GET — list all meetings for engagement
export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const meetingTypeFilter = url.searchParams.get('meetingType');

  const where: Record<string, unknown> = { engagementId };
  if (meetingTypeFilter) where.meetingType = meetingTypeFilter;

  const meetings = await prisma.auditMeeting.findMany({
    where,
    include: { createdBy: { select: { name: true } } },
    orderBy: { meetingDate: 'desc' },
  });

  // Load sign-offs for all meetings
  const meetingsWithSignOffs = await Promise.all(meetings.map(async m => {
    const signOffs = await getSignOffs(engagementId, m.id);
    return {
      id: m.id,
      title: m.title,
      meetingDate: m.meetingDate,
      meetingType: m.meetingType,
      attendees: m.attendees,
      source: m.source,
      hasTranscript: !!m.transcriptRaw,
      minutes: m.minutes,
      minutesStatus: m.minutesStatus,
      createdBy: m.createdBy?.name || 'Unknown',
      createdAt: m.createdAt,
      signOffs,
    };
  }));

  return NextResponse.json({ meetings: meetingsWithSignOffs, teamsEnabled: isTeamsConfigured() });
}

// POST — all meeting actions
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json();
  const { action } = body;

  // Create meeting manually
  if (action === 'create') {
    const { title, meetingDate, meetingType, attendees, transcriptRaw } = body;
    if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

    const meeting = await prisma.auditMeeting.create({
      data: {
        engagementId,
        title,
        meetingDate: new Date(meetingDate || Date.now()),
        meetingType: meetingType || 'other',
        attendees: attendees || [],
        source: 'manual',
        transcriptRaw: transcriptRaw || null,
        createdById: session.user.id,
      },
    });
    return NextResponse.json({ meeting }, { status: 201 });
  }

  // Create a Teams online meeting via Graph API
  if (action === 'create_teams') {
    const { subject, startDateTime, durationMinutes } = body;
    if (!startDateTime) return NextResponse.json({ error: 'startDateTime required' }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { entraObjectId: true } });
    const userObjectId = user?.entraObjectId;
    if (!userObjectId) return NextResponse.json({ error: 'User not linked to Azure AD. Please set your Entra Object ID in user settings.' }, { status: 400 });

    const result = await createTeamsMeeting(userObjectId, subject || 'Walkthrough Meeting', startDateTime, durationMinutes || 60);
    if (!result) return NextResponse.json({ error: 'Failed to create Teams meeting. Check Azure AD permissions.' }, { status: 500 });

    const meeting = await prisma.auditMeeting.create({
      data: {
        engagementId,
        title: subject || 'Walkthrough Meeting',
        meetingDate: new Date(result.startDateTime),
        meetingType: 'walkthrough',
        source: 'teams',
        teamsEventId: result.eventId,
        createdById: session.user.id,
      },
    });

    return NextResponse.json({ meeting: { ...meeting, joinUrl: result.joinUrl } }, { status: 201 });
  }

  // Save meeting (update title, transcript, minutes, attendees)
  if (action === 'save') {
    const { meetingId, title, transcriptRaw, minutes, attendees, meetingType } = body;
    if (!meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 });

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (transcriptRaw !== undefined) data.transcriptRaw = transcriptRaw;
    if (minutes !== undefined) data.minutes = minutes;
    if (attendees !== undefined) data.attendees = attendees;
    if (meetingType !== undefined) data.meetingType = meetingType;

    const meeting = await prisma.auditMeeting.update({
      where: { id: meetingId },
      data: data as any,
    });
    return NextResponse.json({ meeting });
  }

  // Generate minutes from transcript using AI
  if (action === 'generate_minutes') {
    const { meetingId } = body;
    if (!meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 });

    const meeting = await prisma.auditMeeting.findUnique({ where: { id: meetingId } });
    if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    if (!meeting.transcriptRaw?.trim()) return NextResponse.json({ error: 'No transcript to extract from' }, { status: 400 });

    try {
      const minutes = await extractMeetingMinutes(
        meeting.transcriptRaw,
        meeting.title,
        meeting.meetingDate.toISOString().slice(0, 10),
      );

      await prisma.auditMeeting.update({
        where: { id: meetingId },
        data: { minutes: minutes as object, minutesStatus: 'generated' },
      });

      return NextResponse.json({ minutes });
    } catch (err: any) {
      console.error('[Meetings] AI extraction failed:', err);
      return NextResponse.json({ error: err.message || 'AI extraction failed' }, { status: 500 });
    }
  }

  // Fetch Teams meetings for import
  if (action === 'fetch_teams') {
    if (!isTeamsConfigured()) return NextResponse.json({ error: 'Teams not configured' }, { status: 400 });

    // Need user's Azure AD objectId
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { entraObjectId: true } });
    if (!user?.entraObjectId) return NextResponse.json({ error: 'User not linked to Azure AD' }, { status: 400 });

    try {
      const meetings = await listRecentMeetings(user.entraObjectId, body.daysBack || 30);
      return NextResponse.json({ teamsMeetings: meetings });
    } catch (err: any) {
      console.error('[Teams] List meetings failed:', err);
      return NextResponse.json({ error: err.message || 'Failed to fetch Teams meetings' }, { status: 500 });
    }
  }

  // Import a Teams meeting + transcript
  if (action === 'import_teams') {
    const { eventId, subject, startDateTime, participants, meetingType: importMeetingType } = body;
    if (!eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { entraObjectId: true } });
    if (!user?.entraObjectId) return NextResponse.json({ error: 'User not linked to Azure AD' }, { status: 400 });

    // Fetch transcript
    let transcript: string | null = null;
    try {
      transcript = await getMeetingTranscript(user.entraObjectId, eventId);
    } catch (err) {
      console.error('[Teams] Transcript fetch failed:', err);
    }

    // Create meeting record
    const meeting = await prisma.auditMeeting.create({
      data: {
        engagementId,
        title: subject || 'Teams Meeting',
        meetingDate: new Date(startDateTime || Date.now()),
        meetingType: importMeetingType || 'other',
        attendees: (participants || []).map((p: string) => ({ name: p, role: '' })),
        source: 'teams',
        teamsEventId: eventId,
        transcriptRaw: transcript,
        createdById: session.user.id,
      },
    });

    // Auto-generate minutes if transcript available
    if (transcript?.trim()) {
      try {
        const minutes = await extractMeetingMinutes(transcript, subject, startDateTime);
        await prisma.auditMeeting.update({
          where: { id: meeting.id },
          data: { minutes: minutes as object, minutesStatus: 'generated' },
        });
        return NextResponse.json({ meeting: { ...meeting, minutes, minutesStatus: 'generated' } }, { status: 201 });
      } catch { /* minutes generation failed, meeting still created */ }
    }

    return NextResponse.json({ meeting }, { status: 201 });
  }

  // Sign off / unsign off
  if (action === 'signoff' || action === 'unsignoff') {
    const { meetingId, role } = body;
    if (!meetingId || !role) return NextResponse.json({ error: 'meetingId and role required' }, { status: 400 });

    const signOffs = await getSignOffs(engagementId, meetingId);
    if (action === 'unsignoff') {
      delete signOffs[role];
    } else {
      signOffs[role] = {
        userId: session.user.id,
        userName: session.user.name || session.user.email,
        timestamp: new Date().toISOString(),
      };
    }
    await setSignOffs(engagementId, meetingId, signOffs);

    // Update meeting status if all signed
    const allSigned = ['preparer', 'reviewer', 'ri'].every(r => signOffs[r]);
    if (allSigned) {
      await prisma.auditMeeting.update({ where: { id: meetingId }, data: { minutesStatus: 'signed_off' } });
    }

    return NextResponse.json({ signOffs });
  }

  // Email action items to team or expert
  if (action === 'email_actions') {
    const { meetingId, emailType } = body;
    if (!meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 });

    const meeting = await prisma.auditMeeting.findUnique({
      where: { id: meetingId },
      include: { engagement: { select: { clientName: true, teamMembers: { include: { user: { select: { name: true, email: true } } } } } } },
    });
    if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

    const minutes = meeting.minutes as any;
    if (!minutes?.actionItems?.length) return NextResponse.json({ error: 'No action items to email' }, { status: 400 });

    const clientName = meeting.engagement?.clientName || 'Client';
    const meetingDate = meeting.meetingDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const summary = minutes.summary || '';
    const actionItems = minutes.actionItems;

    if (emailType === 'expert') {
      // Find expert attendee email (stored in attendees JSON)
      const attendees = (meeting.attendees as any[]) || [];
      const expertAttendee = attendees.find((a: any) => a.email);
      if (!expertAttendee?.email) {
        return NextResponse.json({ error: 'No expert email found. Add an attendee with an email address.' }, { status: 400 });
      }
      await sendExpertActionEmail(
        expertAttendee.email,
        expertAttendee.name || 'Expert',
        clientName,
        meeting.title,
        meetingDate,
        summary,
        actionItems,
      );
    } else {
      // Email all team members
      const teamMembers = meeting.engagement?.teamMembers || [];
      for (const member of teamMembers) {
        if (member.user?.email) {
          await sendMeetingActionsEmail(
            member.user.email,
            member.user.name || member.user.email,
            clientName,
            meeting.title,
            meetingDate,
            summary,
            actionItems,
          );
        }
      }
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

// DELETE — remove a meeting
export async function DELETE(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json();
  if (!body.meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 });
  await prisma.auditMeeting.delete({ where: { id: body.meetingId } });
  return NextResponse.json({ success: true });
}
