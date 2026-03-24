import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getPermanentFileSignOffs, handlePermanentFileSignOff, handlePermanentFileUnsignOff } from '@/lib/signoff-handler';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

const REQUIRED_DOCS = [
  { key: 'pp_engagement_letter', label: 'Signed PP Engagement Letter' },
  { key: 'pp_letter_of_comment', label: 'Signed PP Letter of Comment' },
  { key: 'pp_letter_of_representation', label: 'Signed PP Letter of Representation' },
  { key: 'pp_financial_statements', label: 'Signed PP Financial Statements for PY' },
];

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  if (url.searchParams.get('meta') === 'signoffs') {
    return getPermanentFileSignOffs(engagementId, 'prior-period');
  }

  // Get all documents for this engagement
  const documents = await prisma.auditDocument.findMany({
    where: { engagementId },
    include: {
      requestedBy: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Match documents to required prior period docs
  const docStatus = REQUIRED_DOCS.map(rd => {
    const matched = documents.find(d =>
      d.documentName.toLowerCase().includes(rd.key.replace(/pp_/g, '').replace(/_/g, ' '))
      || d.documentName.toLowerCase().includes(rd.label.toLowerCase())
    );
    return {
      ...rd,
      documentId: matched?.id || null,
      documentName: matched?.documentName || null,
      uploaded: !!matched?.uploadedDate,
      storagePath: matched?.storagePath || null,
    };
  });

  // Load AI summaries (stored in permanent file table with prior-period prefix)
  const summaryRec = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: '__prior_period_summaries' } },
  });

  return NextResponse.json({
    requiredDocs: REQUIRED_DOCS,
    docStatus,
    documents, // All docs for the file picker
    summaries: summaryRec?.data || {},
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();

  // Sign-off actions
  if (body.action === 'signoff') {
    return handlePermanentFileSignOff(engagementId, {
      userId: session.user.id, userName: session.user.name || session.user.email || '', role: body.role,
    }, 'prior-period');
  }
  if (body.action === 'unsignoff') {
    return handlePermanentFileUnsignOff(engagementId, session.user.id, body.role, 'prior-period');
  }

  // Link a document from the repository to a prior period slot
  if (body.action === 'link_document') {
    const { docKey, documentId } = body;
    if (!docKey || !documentId) return NextResponse.json({ error: 'docKey and documentId required' }, { status: 400 });

    // Store the mapping
    const existing = await prisma.auditPermanentFile.findUnique({
      where: { engagementId_sectionKey: { engagementId, sectionKey: '__prior_period_links' } },
    });
    const links = (existing?.data || {}) as Record<string, string>;
    links[docKey] = documentId;

    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey: '__prior_period_links' } },
      create: { engagementId, sectionKey: '__prior_period_links', data: links as object },
      update: { data: links as object },
    });

    return NextResponse.json({ success: true, links });
  }

  // AI review of a document
  if (body.action === 'ai_review') {
    const { docKey, documentName } = body;
    if (!docKey) return NextResponse.json({ error: 'docKey required' }, { status: 400 });

    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 503 });

    // Determine the prompt based on doc type
    const prompts: Record<string, string> = {
      pp_letter_of_comment: `You are reviewing a prior period Letter of Comment (Management Letter) for an audit engagement. Summarise the key points, recommendations, and any unresolved matters that the current audit team should be aware of. Focus on: control deficiencies identified, recommendations made, management responses, and any outstanding items. Be concise and professional.`,
      pp_letter_of_representation: `You are reviewing a prior period Letter of Representation for an audit engagement. Summarise the key representations made by management, any qualifications or limitations noted, and matters the current audit team should carry forward. Focus on: specific representations about fraud, going concern, related parties, and completeness of information.`,
      pp_financial_statements: `You are reviewing the prior period Financial Statements for an audit engagement. Focus ONLY on the Audit Opinion. Summarise: the type of opinion (unqualified/qualified/adverse/disclaimer), any emphasis of matter paragraphs, key audit matters, and any modifications. Note any going concern issues or material uncertainties mentioned.`,
    };

    const prompt = prompts[docKey];
    if (!prompt) return NextResponse.json({ error: 'AI review not applicable for this document type' }, { status: 400 });

    try {
      const aiRes = await fetch('https://api.together.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `Document: "${documentName || docKey}"\n\nNote: The actual document content is not available for direct analysis. Based on standard audit practice, provide a template summary of what the audit team should look for and document when reviewing this prior period document. Structure your response with clear bullet points.` },
          ],
          max_tokens: 600,
          temperature: 0.3,
        }),
      });

      if (!aiRes.ok) throw new Error(`AI returned ${aiRes.status}`);
      const aiData = await aiRes.json();
      const summary = aiData.choices?.[0]?.message?.content?.trim() || '';

      // Store summary
      const existing = await prisma.auditPermanentFile.findUnique({
        where: { engagementId_sectionKey: { engagementId, sectionKey: '__prior_period_summaries' } },
      });
      const summaries = (existing?.data || {}) as Record<string, string>;
      summaries[docKey] = summary;

      await prisma.auditPermanentFile.upsert({
        where: { engagementId_sectionKey: { engagementId, sectionKey: '__prior_period_summaries' } },
        create: { engagementId, sectionKey: '__prior_period_summaries', data: summaries as object },
        update: { data: summaries as object },
      });

      return NextResponse.json({ summary });
    } catch (err) {
      console.error('AI review failed:', err);
      return NextResponse.json({ error: 'AI review failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
