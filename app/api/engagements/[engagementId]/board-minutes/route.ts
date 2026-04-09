import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { processPdf } from '@/lib/pdf-to-images';
import { extractBoardMinutes, generatePeriodSummary, identifyCarryForward } from '@/lib/board-minutes-ai';
import { uploadToInbox, CONTAINERS } from '@/lib/azure-blob';

const MAX_DOC_CHARS = 80_000;

const DEFAULT_BOARD_HEADINGS = ['Litigation', 'Committed Capital Expenditure', 'Performance Concerns', 'Significant Disposals', 'Fraud'];
const DEFAULT_TCWG_HEADINGS = ['Valuations', 'Accounting Policies', 'Cashflow', 'Significant Transactions', 'Fraud', 'Audit Matters', 'Control Breaches', 'Regulator Issues'];

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

async function getSignOffs(engagementId: string, meetingId: string) {
  const row = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: `boardmin_${meetingId}_signoffs` } },
  });
  return (row?.data as Record<string, unknown>) || {};
}

async function setSignOffs(engagementId: string, meetingId: string, data: Record<string, unknown>) {
  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: `boardmin_${meetingId}_signoffs` } },
    create: { engagementId, sectionKey: `boardmin_${meetingId}_signoffs`, data: data as object },
    update: { data: data as object },
  });
}

async function getFirmHeadings(firmId: string, docType: 'board_minutes' | 'tcwg'): Promise<string[]> {
  const tableType = docType === 'tcwg' ? 'tcwg_headings' : 'board_minutes_headings';
  const row = await prisma.methodologyRiskTable.findUnique({
    where: { firmId_tableType: { firmId, tableType } },
  });
  const headings = (row?.data as any)?.headings;
  if (Array.isArray(headings) && headings.length > 0) return headings;
  return docType === 'tcwg' ? DEFAULT_TCWG_HEADINGS : DEFAULT_BOARD_HEADINGS;
}

// DOCX text extraction (reuse walkthrough-flowchart pattern)
async function extractDocxText(buffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) return '';
  const matches = docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
  return matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ');
}

// GET — list all board minutes / TCWG records for engagement
export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const docType = url.searchParams.get('type') || 'board_minutes';

  const meetings = await prisma.auditMeeting.findMany({
    where: { engagementId, meetingType: docType },
    include: { createdBy: { select: { name: true } } },
    orderBy: { meetingDate: 'desc' },
  });

  const results = await Promise.all(meetings.map(async m => {
    const signOffs = await getSignOffs(engagementId, m.id);
    return {
      id: m.id,
      title: m.title,
      meetingDate: m.meetingDate,
      meetingType: m.meetingType,
      minutes: m.minutes,
      minutesStatus: m.minutesStatus,
      hasTranscript: !!m.transcriptRaw,
      createdBy: m.createdBy?.name || 'Unknown',
      createdAt: m.createdAt,
      signOffs,
    };
  }));

  // Load firm headings
  const headings = await getFirmHeadings(session.user.firmId, docType as 'board_minutes' | 'tcwg');

  return NextResponse.json({ records: results, headings });
}

// POST — upload, extract, generate summary, sign-off
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const contentType = req.headers.get('content-type') || '';

  // Handle multipart file upload
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const docType = (formData.get('type') as string) || 'board_minutes';
    const meetingDateStr = formData.get('meetingDate') as string;
    const title = formData.get('title') as string;
    const files = formData.getAll('files') as File[];

    if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

    const headings = await getFirmHeadings(session.user.firmId, docType as 'board_minutes' | 'tcwg');
    const results: any[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileName = file.name || 'document.pdf';
      const ext = fileName.toLowerCase().split('.').pop() || '';

      // Extract text
      let documentText = '';
      if (ext === 'pdf') {
        const pdfResult = await processPdf(buffer, 50);
        documentText = (pdfResult.text || '').slice(0, MAX_DOC_CHARS);
      } else if (ext === 'docx' || ext === 'doc') {
        documentText = (await extractDocxText(buffer)).slice(0, MAX_DOC_CHARS);
      } else if (ext === 'txt' || ext === 'csv') {
        documentText = buffer.toString('utf-8').slice(0, MAX_DOC_CHARS);
      } else {
        results.push({ error: `Unsupported file type: ${ext}`, fileName });
        continue;
      }

      if (!documentText.trim()) {
        results.push({ error: 'No text could be extracted from the document', fileName });
        continue;
      }

      // Upload to blob storage
      const blobName = `board-minutes/${engagementId}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await uploadToInbox(blobName, buffer, file.type || 'application/pdf');

      // AI extraction
      let extraction;
      try {
        extraction = await extractBoardMinutes(documentText, headings, docType as 'board_minutes' | 'tcwg', meetingDateStr);
      } catch (err: any) {
        console.error('[BoardMinutes] AI extraction failed:', err);
        extraction = null;
      }

      // Create meeting record
      const meeting = await prisma.auditMeeting.create({
        data: {
          engagementId,
          title: title || fileName.replace(/\.[^.]+$/, ''),
          meetingDate: meetingDateStr ? new Date(meetingDateStr) : new Date(),
          meetingType: docType,
          source: 'upload',
          transcriptRaw: documentText,
          minutes: extraction ? (extraction as object) : undefined,
          minutesStatus: extraction ? 'generated' : 'draft',
          createdById: session.user.id,
        },
      });

      results.push({ id: meeting.id, title: meeting.title, extraction, fileName });
    }

    return NextResponse.json({ results }, { status: 201 });
  }

  // Handle JSON actions
  const body = await req.json();
  const { action } = body;

  // Re-extract minutes from existing record
  if (action === 'regenerate') {
    const { meetingId } = body;
    if (!meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 });

    const meeting = await prisma.auditMeeting.findUnique({ where: { id: meetingId } });
    if (!meeting?.transcriptRaw) return NextResponse.json({ error: 'No document text available' }, { status: 400 });

    const headings = await getFirmHeadings(session.user.firmId, meeting.meetingType as 'board_minutes' | 'tcwg');
    const extraction = await extractBoardMinutes(
      meeting.transcriptRaw,
      headings,
      meeting.meetingType as 'board_minutes' | 'tcwg',
      meeting.meetingDate.toISOString().slice(0, 10),
    );

    await prisma.auditMeeting.update({
      where: { id: meetingId },
      data: { minutes: extraction as object, minutesStatus: 'generated' },
    });

    return NextResponse.json({ extraction });
  }

  // Save updates to a record
  if (action === 'save') {
    const { meetingId, title, minutes, meetingDate } = body;
    if (!meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 });

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (minutes !== undefined) data.minutes = minutes;
    if (meetingDate !== undefined) data.meetingDate = new Date(meetingDate);

    await prisma.auditMeeting.update({ where: { id: meetingId }, data: data as any });
    return NextResponse.json({ success: true });
  }

  // Generate period summary
  if (action === 'period_summary') {
    const docType = body.type || 'board_minutes';
    const headings = await getFirmHeadings(session.user.firmId, docType);

    const allMeetings = await prisma.auditMeeting.findMany({
      where: { engagementId, meetingType: docType },
      select: { meetingDate: true, minutes: true },
      orderBy: { meetingDate: 'asc' },
    });

    const extractions = allMeetings
      .filter(m => m.minutes && typeof m.minutes === 'object')
      .map(m => ({
        meetingDate: m.meetingDate.toISOString().slice(0, 10),
        headings: (m.minutes as any).headings || {},
      }));

    if (extractions.length === 0) {
      return NextResponse.json({ error: 'No extracted minutes to summarise' }, { status: 400 });
    }

    const [summary, carryForward] = await Promise.all([
      generatePeriodSummary(extractions, headings, docType),
      identifyCarryForward(extractions, headings),
    ]);

    return NextResponse.json({ summary, carryForward });
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

    const allSigned = ['preparer', 'reviewer', 'ri'].every(r => signOffs[r]);
    if (allSigned) {
      await prisma.auditMeeting.update({ where: { id: meetingId }, data: { minutesStatus: 'signed_off' } });
    }

    return NextResponse.json({ signOffs });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

// DELETE — remove a board minutes record
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
