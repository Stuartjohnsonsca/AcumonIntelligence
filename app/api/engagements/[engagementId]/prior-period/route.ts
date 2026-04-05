import { NextResponse, after } from 'next/server';
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

const REVIEWABLE_DOCS = ['pp_letter_of_comment', 'pp_letter_of_representation', 'pp_financial_statements'];

// Storage keys
const LINKS_KEY = '__prior_period_links';
const SUMMARIES_KEY = '__prior_period_summaries';
const POINTS_KEY = '__prior_period_points';
const OB_KEY = '__prior_period_opening_balances';
const OB_MAPPING_KEY = '__prior_period_ob_mapping';

async function getData(engagementId: string, key: string) {
  const rec = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: key } },
  });
  return (rec?.data || {}) as Record<string, unknown>;
}

async function setData(engagementId: string, key: string, data: Record<string, unknown>) {
  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: key } },
    create: { engagementId, sectionKey: key, data: data as object },
    update: { data: data as object },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  if (url.searchParams.get('meta') === 'signoffs') {
    return getPermanentFileSignOffs(engagementId, 'prior-period');
  }

  const documents = await prisma.auditDocument.findMany({
    where: { engagementId },
    include: { requestedBy: { select: { id: true, name: true } }, uploadedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const links = await getData(engagementId, LINKS_KEY) as Record<string, string>;

  const docStatus = REQUIRED_DOCS.map(rd => {
    const linkedDocId = links[rd.key];
    const matched = linkedDocId ? documents.find(d => d.id === linkedDocId) : null;
    return {
      ...rd,
      documentId: matched?.id || null,
      documentName: matched?.documentName || null,
      uploaded: !!matched?.uploadedDate,
      storagePath: matched?.storagePath || null,
    };
  });

  const summaries = await getData(engagementId, SUMMARIES_KEY);
  const points = await getData(engagementId, POINTS_KEY);
  const openingBalances = await getData(engagementId, OB_KEY);
  const obMapping = await getData(engagementId, OB_MAPPING_KEY);

  return NextResponse.json({ requiredDocs: REQUIRED_DOCS, docStatus, documents, summaries, points, openingBalances, obMapping });
}

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();

  if (body.action === 'signoff') {
    return handlePermanentFileSignOff(engagementId, { userId: session.user.id, userName: session.user.name || '', role: body.role }, 'prior-period');
  }
  if (body.action === 'unsignoff') {
    return handlePermanentFileUnsignOff(engagementId, session.user.id, body.role, 'prior-period');
  }

  // Link document
  if (body.action === 'link_document') {
    const { docKey, documentId } = body;
    if (!docKey || !documentId) return NextResponse.json({ error: 'docKey and documentId required' }, { status: 400 });
    const links = await getData(engagementId, LINKS_KEY) as Record<string, string>;
    links[docKey] = documentId;
    await setData(engagementId, LINKS_KEY, links);
    return NextResponse.json({ success: true });
  }

  // AI review — background task
  if (body.action === 'ai_review') {
    const { docKey, documentName } = body;
    if (!docKey || !REVIEWABLE_DOCS.includes(docKey)) return NextResponse.json({ error: 'Invalid doc for review' }, { status: 400 });

    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 503 });

    // Create background task and return immediately
    const task = await prisma.backgroundTask.create({
      data: { userId: session.user.id, type: 'ai-review', status: 'running', progress: { phase: 'starting', message: 'Reading document...' } as any },
    });

    after(async () => {
      const updateProgress = (progress: any) => prisma.backgroundTask.update({ where: { id: task.id }, data: { progress } });
      try {
        const prompts: Record<string, string> = {
          pp_letter_of_comment: `You are reviewing a prior period Letter of Comment (Management Letter). List each key point as a separate numbered item. For each point include: the finding/recommendation, management's response if any, and current status. Output as a JSON array of objects with fields: "point" (string), "detail" (string). Aim for 5-10 points covering control deficiencies, recommendations, and outstanding items.`,
          pp_letter_of_representation: `You are reviewing a prior period Letter of Representation. List each key representation as a separate numbered item. Output as a JSON array of objects with fields: "point" (string), "detail" (string). Cover representations about: fraud awareness, going concern, related party transactions, completeness of information, compliance with laws, subsequent events. Aim for 6-10 points.`,
          pp_financial_statements: `You are reviewing the prior period Financial Statements, focusing on the Audit Opinion. List each key finding as a separate item. Output as a JSON array of objects with fields: "point" (string), "detail" (string). Cover: opinion type (unqualified/qualified/adverse/disclaimer), emphasis of matter paragraphs, key audit matters, going concern assessment, material uncertainties. Aim for 4-8 points.`,
        };

        await updateProgress({ phase: 'reading', message: 'Reading document...' });
        // Try to get actual document content
        let documentContent = '';
        try {
          const links = await getData(engagementId, LINKS_KEY) as Record<string, string>;
          const linkedDocId = links[docKey];
          if (linkedDocId) {
            const doc = await prisma.auditDocument.findUnique({ where: { id: linkedDocId } });
            if (doc?.storagePath) {
              const { downloadBlob } = await import('@/lib/azure-blob');
              const buffer = await downloadBlob(doc.storagePath, process.env.AZURE_STORAGE_CONTAINER_INBOX || 'upload-inbox');
              // For PDFs, extract text; for other files, use raw text
              if (doc.mimeType?.includes('pdf')) {
                try {
                  const pdf = await import('pdf-parse');
                  const parsed = await pdf.default(buffer);
                  documentContent = parsed.text?.slice(0, 8000) || '';
                } catch {
                  documentContent = buffer.toString('utf-8').slice(0, 8000);
                }
              } else {
                documentContent = buffer.toString('utf-8').slice(0, 8000);
              }
            }
          }
        } catch (err) {
          console.error('Failed to read document content:', err);
        }

        await updateProgress({ phase: 'analysing', message: 'AI is reviewing the document...' });
        const userMessage = documentContent
          ? `Document: "${documentName || docKey}"\n\nDocument Content:\n${documentContent}\n\nBased on the above document content, provide a structured review. Return ONLY valid JSON array.`
          : `Document: "${documentName || docKey}"\n\nProvide a structured review based on standard audit practice for this type of prior period document. Return ONLY valid JSON array.`;

        const aiRes = await fetch('https://api.together.xyz/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
            messages: [
              { role: 'system', content: prompts[docKey] },
              { role: 'user', content: userMessage },
            ],
            max_tokens: 2000,
            temperature: 0.3,
          }),
        });

        if (!aiRes.ok) throw new Error(`AI returned ${aiRes.status}`);
        const aiData = await aiRes.json();
        let content = aiData.choices?.[0]?.message?.content?.trim() || '[]';

        // Parse JSON from AI response (may have markdown wrapping)
        content = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
        let parsedPoints: { point: string; detail: string }[] = [];
        try { parsedPoints = JSON.parse(content); } catch {
          // Fallback: split by newlines
          parsedPoints = content.split('\n').filter((l: string) => l.trim()).map((l: string, i: number) => ({ point: `Point ${i + 1}`, detail: l.trim() }));
        }

        // Store points with default statuses
        const pointsWithStatus = parsedPoints.map((p: { point: string; detail: string }, i: number) => ({
          id: `${docKey}_${i}`,
          point: p.point,
          detail: p.detail,
          notRelevant: false,
          carryForward: false,
          signOffs: {},
        }));

        const allPoints = await getData(engagementId, POINTS_KEY);
        allPoints[docKey] = pointsWithStatus;
        await setData(engagementId, POINTS_KEY, allPoints);

        // Also store raw summary
        const summaries = await getData(engagementId, SUMMARIES_KEY);
        summaries[docKey] = content;
        await setData(engagementId, SUMMARIES_KEY, summaries);

        await prisma.backgroundTask.update({
          where: { id: task.id },
          data: { status: 'completed', result: { points: pointsWithStatus, docKey } as any },
        });
      } catch (err: any) {
        console.error('AI review failed:', err);
        await prisma.backgroundTask.update({
          where: { id: task.id },
          data: { status: 'error', error: err.message || 'AI review failed' },
        });
      }
    }); // end after()

    return NextResponse.json({ taskId: task.id });
  }

  // Poll background task status
  if (body.action === 'poll_task') {
    const tsk = await prisma.backgroundTask.findUnique({ where: { id: body.taskId } });
    if (!tsk) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({
      status: tsk.status,
      progress: tsk.progress,
      result: tsk.status === 'completed' ? tsk.result : undefined,
      error: tsk.error,
    });
  }

  // Update points (checkboxes, sign-offs)
  if (body.action === 'update_points') {
    const { docKey, points } = body;
    if (!docKey || !points) return NextResponse.json({ error: 'docKey and points required' }, { status: 400 });
    const allPoints = await getData(engagementId, POINTS_KEY);
    allPoints[docKey] = points;
    await setData(engagementId, POINTS_KEY, allPoints);
    return NextResponse.json({ success: true });
  }

  // Save opening balances
  if (body.action === 'save_opening_balances') {
    await setData(engagementId, OB_KEY, body.data || {});
    return NextResponse.json({ success: true });
  }

  // AI: Extract FS Line Items from opening TB
  if (body.action === 'ai_extract_fs_lines') {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
    const { tbData } = body;

    try {
      const aiRes = await fetch('https://api.together.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
          messages: [
            { role: 'system', content: 'You are an audit assistant. Given trial balance account data, extract and group them into standard Financial Statement line items. Return a JSON array of objects with fields: "fsLineItem" (string), "accounts" (array of account names that map to this line item). Use standard FS categories like Revenue, Cost of Sales, Gross Profit, Administrative Expenses, etc.' },
            { role: 'user', content: `Trial balance data:\n${JSON.stringify(tbData)}\n\nExtract FS Line Items and map accounts. Return ONLY valid JSON array.` },
          ],
          max_tokens: 1000,
          temperature: 0.2,
        }),
      });

      if (!aiRes.ok) throw new Error(`AI returned ${aiRes.status}`);
      const aiData = await aiRes.json();
      let content = aiData.choices?.[0]?.message?.content?.trim() || '[]';
      content = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      let mapping;
      try { mapping = JSON.parse(content); } catch { mapping = []; }

      await setData(engagementId, OB_MAPPING_KEY, { mapping });
      return NextResponse.json({ mapping });
    } catch (err) {
      console.error('AI FS extraction failed:', err);
      return NextResponse.json({ error: 'AI extraction failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
