import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import OpenAI from 'openai';

const CATEGORY_TO_STATEMENT: Record<string, string> = {
  pnl: 'Profit & Loss',
  balance_sheet: 'Balance Sheet',
  cashflow: 'Cash Flow Statement',
  notes: 'Notes',
};

const client = new OpenAI({
  apiKey: process.env.TOGETHER_API_KEY || process.env.TOGETHER_DOC_SUMMARY_KEY || '',
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

  const { rows } = await req.json();
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows array required' }, { status: 400 });
  }

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

  // Build the prompt
  const rowDescriptions = rows
    .slice(0, 50)
    .map((r: any) => `[${r.index}] Code: "${r.accountCode || ''}" | Desc: "${r.description || ''}" | Amount: ${r.currentYear ?? 'nil'}`)
    .join('\n');

  const systemPrompt = `You are a financial statement classification expert for UK statutory audits.

Given trial balance account descriptions, classify each into:
- fsNoteLevel: The specific note disclosure item (e.g. "Trade Debtors", "Revenue", "Depreciation")
- fsLevel: The aggregated FS line item it belongs to (e.g. "Debtors", "Revenue", "Fixed Assets")
- fsStatement: Which financial statement (exactly one of: "Profit & Loss", "Balance Sheet", "Cash Flow Statement")

Rules:
- Sales, revenue, turnover, fees, commissions, rebilled services → fsLevel "Revenue", fsStatement "Profit & Loss"
- Cost of sales, direct costs, materials → fsLevel "Cost of Sales", fsStatement "Profit & Loss"
- Wages, salaries, NI, pensions, staff costs → fsLevel "Staff Costs" or "Administrative Expenses", fsStatement "Profit & Loss"
- Rent, utilities, insurance, repairs, office costs → fsLevel "Administrative Expenses", fsStatement "Profit & Loss"
- Depreciation, amortisation → fsLevel "Depreciation", fsStatement "Profit & Loss"
- Interest, bank charges → fsLevel "Interest", fsStatement "Profit & Loss"
- Tax, corporation tax → fsLevel "Taxation", fsStatement "Profit & Loss"
- Trade debtors, prepayments, other debtors, VAT recoverable → fsLevel "Debtors", fsStatement "Balance Sheet"
- Cash, bank → fsLevel "Cash at Bank", fsStatement "Balance Sheet"
- Trade creditors, accruals, other creditors, VAT payable, PAYE → fsLevel "Creditors", fsStatement "Balance Sheet"
- Loans, HP, mortgages → fsLevel "Loans & Borrowings", fsStatement "Balance Sheet"
- Fixed assets, plant, equipment, vehicles, IT → fsLevel "Tangible Fixed Assets", fsStatement "Balance Sheet"
- Goodwill, IP, software → fsLevel "Intangible Fixed Assets", fsStatement "Balance Sheet"
- Share capital, reserves, retained earnings, dividends → fsLevel "Capital & Reserves", fsStatement "Balance Sheet"
- Provisions → fsLevel "Provisions", fsStatement "Balance Sheet"
- Use common sense for the fsNoteLevel — it should be the most specific description of what the account represents.

The firm has these FS Line Items configured:
${fsLineItems.join('\n')}

And these Note Items (with parents):
${noteItems.join('\n')}

Prefer matching to existing configured items where possible. If no exact match, suggest the most appropriate name.

Respond ONLY with a JSON array. Each element: { "index": <number>, "fsNoteLevel": "<string>", "fsLevel": "<string>", "fsStatement": "<string>" }
No other text.`;

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

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const classifications = JSON.parse(jsonStr);

    // Log usage
    try {
      const usage = completion.usage;
      await prisma.aiUsage.create({
        data: {
          clientId: engagement.clientId,
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

    return NextResponse.json({ classifications });
  } catch (err) {
    console.error('AI classification error:', err);
    return NextResponse.json({ error: 'AI classification failed' }, { status: 500 });
  }
}
