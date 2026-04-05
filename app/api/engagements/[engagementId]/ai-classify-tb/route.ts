import { NextRequest, NextResponse, after } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import OpenAI from 'openai';

export const maxDuration = 120; // Allow up to 2 minutes for large TB classification

const CATEGORY_TO_STATEMENT: Record<string, string> = {
  pnl: 'Profit & Loss',
  balance_sheet: 'Balance Sheet',
  cashflow: 'Cash Flow Statement',
  notes: 'Notes',
};

const apiKey = process.env.TOGETHER_API_KEY || process.env.TOGETHER_DOC_SUMMARY_KEY || '';
const client = new OpenAI({
  apiKey,
  baseURL: 'https://api.together.xyz/v1',
});

const MODEL = process.env.TOGETHER_CLASSIFY_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

/**
 * POST /api/engagements/[engagementId]/ai-classify-tb
 * Uses AI to classify trial balance rows into FS Note, FS Level, FS Statement.
 *
 * Body: { rows: [{ index, accountCode, description, currentYear }] }
 * Returns: { classifications: [{ index, fsNoteLevel, fsLevel, fsStatement }] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { engagementId } = await params;
  const firmId = session.user.firmId;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { auditType: true, firmId: true, clientId: true },
  });

  if (!engagement || (engagement.firmId !== firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!apiKey) {
    return NextResponse.json({ error: 'AI service not configured (TOGETHER_API_KEY missing)' }, { status: 503 });
  }

  console.log(`[AI Classify] Using model: ${MODEL}, API key prefix: ${apiKey.slice(0, 8)}...`);

  const body = await req.json();

  // If action=poll, check background task status
  if (body.action === 'poll' && body.taskId) {
    const task = await prisma.backgroundTask.findUnique({ where: { id: body.taskId } });
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ status: task.status, progress: task.progress, error: task.error, result: task.result });
  }

  const { rows } = body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows array required' }, { status: 400 });
  }

  // Create background task and return immediately
  const task = await prisma.backgroundTask.create({
    data: { userId: session.user.id, type: 'ai-classify-tb', status: 'running', progress: { phase: 'starting', classified: 0, total: rows.length } as any },
  });

  // Process in background — continues even if user navigates away
  after(async () => {
    try {
      // Load the firm's FS Lines hierarchy for context
      const fsLines = await prisma.methodologyFsLine.findMany({
        where: { firmId, isActive: true },
        include: { parent: { select: { id: true, name: true, fsCategory: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      const fsLineItems = fsLines
        .filter(l => l.lineType === 'fs_line_item')
        .map(l => `${l.name} (${CATEGORY_TO_STATEMENT[l.fsCategory] || l.fsCategory})`);

      const noteItems = fsLines
        .filter(l => l.lineType === 'note_item')
        .map(l => {
          const parent = l.parent;
          return `${l.name} → parent: ${parent?.name || 'none'} (${parent ? CATEGORY_TO_STATEMENT[parent.fsCategory] || parent.fsCategory : l.fsCategory})`;
        });

      const systemPrompt = `You are a financial statement classification expert for UK statutory audits.

Given trial balance account descriptions, classify each into:
- fsNoteLevel: The specific note disclosure item (e.g. "Trade Debtors", "Revenue", "Depreciation")
- fsLevel: The aggregated FS line item it belongs to (e.g. "Debtors", "Revenue", "Fixed Assets")
- fsStatement: Which financial statement (exactly one of: "Profit & Loss", "Balance Sheet", "Cash Flow Statement")

CRITICAL — Accounting System Type OVERRIDES description:
When a "Type" field is provided from the accounting system, it is the AUTHORITATIVE classification.
The account description/name may be misleading — always trust the Type over the description.
Key Type mappings:
- Type: BANK → ALWAYS "Cash at Bank", fsStatement "Balance Sheet"
- Type: REVENUE → ALWAYS Revenue, fsStatement "Profit & Loss"
- Type: DIRECTCOSTS → ALWAYS Cost of Sales, fsStatement "Profit & Loss"
- Type: EXPENSE or OVERHEADS → ALWAYS Expenses/Administrative Expenses, fsStatement "Profit & Loss"
- Type: FIXED → ALWAYS Fixed Assets, fsStatement "Balance Sheet"
- Type: CURRENT → ALWAYS Current Assets (Debtors), fsStatement "Balance Sheet"
- Type: CURRLIAB → ALWAYS Current Liabilities (Creditors), fsStatement "Balance Sheet"
- Type: TERMLIAB → ALWAYS Non-Current Liabilities, fsStatement "Balance Sheet"
- Type: EQUITY → ALWAYS Capital & Reserves, fsStatement "Balance Sheet"
- Type: OTHERINCOME → ALWAYS Other Income, fsStatement "Profit & Loss"
- Type: INVENTORY → ALWAYS Stock/Inventory, fsStatement "Balance Sheet"
- Type: PREPAYMENT → ALWAYS Prepayments (Debtors), fsStatement "Balance Sheet"
- Type: DEPRECIATN → ALWAYS Depreciation, fsStatement "Profit & Loss"
Also: accounts with NO account code (null/empty) are typically bank accounts in Xero.

Additional description-based rules (only when Type is not provided):
- Sales, revenue, turnover, fees, commissions → fsLevel "Revenue", fsStatement "Profit & Loss"
- Cost of sales, direct costs, materials → fsLevel "Cost of Sales", fsStatement "Profit & Loss"
- Wages, salaries, NI, pensions, staff costs → fsLevel "Administrative Expenses", fsStatement "Profit & Loss"
- Rent, utilities, insurance, repairs, office costs → fsLevel "Administrative Expenses", fsStatement "Profit & Loss"
- Depreciation CHARGE → fsLevel "Depreciation", fsStatement "Profit & Loss"
- ACCUMULATED depreciation (contra asset) → fsLevel "Tangible Fixed Assets", fsStatement "Balance Sheet"
- Interest, bank charges → fsLevel "Interest", fsStatement "Profit & Loss"
- Tax, corporation tax → fsLevel "Taxation", fsStatement "Profit & Loss"
- Trade debtors, prepayments, other debtors, VAT recoverable → fsLevel "Debtors", fsStatement "Balance Sheet"
- Cash, bank → fsLevel "Cash at Bank", fsStatement "Balance Sheet"
- Trade creditors, accruals, other creditors, VAT payable → fsLevel "Creditors", fsStatement "Balance Sheet"
- Loans, HP, mortgages → fsLevel "Loans & Borrowings", fsStatement "Balance Sheet"
- Fixed assets, plant, equipment → fsLevel "Tangible Fixed Assets", fsStatement "Balance Sheet"
- Share capital, reserves, retained earnings, dividends → fsLevel "Capital & Reserves", fsStatement "Balance Sheet"

The firm has these FS Line Items configured:
${fsLineItems.join('\n')}

And these Note Items (with parents):
${noteItems.join('\n')}

Prefer matching to existing configured items where possible.

Respond ONLY with a JSON array. Each element: { "index": <number>, "fsNoteLevel": "<string>", "fsLevel": "<string>", "fsStatement": "<string>", "confidence": <number 0-100> }
No other text.`;

      // Load all TB rows from DB for matching
      const tbRowsDb = await prisma.auditTBRow.findMany({
        where: { engagementId },
        select: { id: true, accountCode: true },
        orderBy: { sortOrder: 'asc' },
      });

      let totalClassified = 0;

      // Process in batches of 30
      for (let i = 0; i < rows.length; i += 30) {
        const batch = rows.slice(i, i + 30);

        await prisma.backgroundTask.update({
          where: { id: task.id },
          data: { progress: { phase: 'classifying', classified: totalClassified, total: rows.length, batch: `${i + 1}–${Math.min(i + 30, rows.length)}` } as any },
        });

        const rowDescriptions = batch
          .map((r: any) => {
            let line = `[${r.index}] Code: "${r.accountCode || ''}" | Desc: "${r.description || ''}" | Amount: ${r.currentYear ?? 'nil'}`;
            if (r.sourceMetadata) {
              const meta = r.sourceMetadata;
              if (meta.xeroType) line += ` | Type: ${meta.xeroType}`;
              if (meta.xeroClass) line += ` | Class: ${meta.xeroClass}`;
              if (meta.xeroDescription) line += ` | Detail: ${meta.xeroDescription}`;
            }
            if (r.category) line += ` | Category: ${r.category}`;
            return line;
          })
          .join('\n');

        try {
          const completion = await client.chat.completions.create({
            model: MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: rowDescriptions },
            ],
            max_tokens: 4096,
            temperature: 0.1,
          });

          const responseText = completion.choices[0]?.message?.content || '';
          let jsonStr = responseText.trim();
          if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

          const classifications = JSON.parse(jsonStr);

          // Save each classification directly to DB
          for (const c of classifications) {
            const sourceRow = batch.find((r: any) => r.index === c.index);
            if (!sourceRow) continue;
            const dbRow = tbRowsDb.find(r => r.accountCode === sourceRow.accountCode);
            if (dbRow && (c.fsNoteLevel || c.fsLevel || c.fsStatement)) {
              await prisma.auditTBRow.update({
                where: { id: dbRow.id },
                data: {
                  fsNoteLevel: c.fsNoteLevel || undefined,
                  fsLevel: c.fsLevel || undefined,
                  fsStatement: c.fsStatement || undefined,
                  aiConfidence: c.confidence ?? null,
                },
              });
              totalClassified++;
            }
          }

          // Log AI usage
          try {
            const usage = completion.usage;
            await prisma.aiUsage.create({
              data: {
                clientId: engagement!.clientId,
                userId: session.user.id,
                action: 'TB Classification',
                model: MODEL,
                operation: 'classify_tb_rows',
                promptTokens: usage?.prompt_tokens || 0,
                completionTokens: usage?.completion_tokens || 0,
                totalTokens: usage?.total_tokens || 0,
                estimatedCostUsd: ((usage?.prompt_tokens || 0) * 0.0008 + (usage?.completion_tokens || 0) * 0.0008) / 1000,
              },
            });
          } catch {}
        } catch (err: any) {
          console.error(`[AI Classify] Batch ${i}–${i + 30} failed:`, err?.message);
          // Continue with next batch
        }
      }

      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { status: 'completed', result: { classified: totalClassified, total: rows.length } as any },
      });
    } catch (err: any) {
      console.error('[AI Classify] Background task failed:', err);
      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { status: 'error', error: err.message || 'Classification failed' },
      });
    }
  });

  return NextResponse.json({ taskId: task.id, status: 'running', total: rows.length });
}
