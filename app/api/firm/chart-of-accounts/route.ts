import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox, generateSasUrl, deleteBlob } from '@/lib/azure-blob';
import * as XLSX from 'xlsx';

// GET - retrieve firm's chart of accounts (any firm user)
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      firm: {
        include: {
          chartOfAccounts: { orderBy: { sortOrder: 'asc' } },
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  let downloadUrl: string | null = null;
  if (user.firm.chartOfAccountsBlobPath && user.firm.chartOfAccountsContainer) {
    downloadUrl = generateSasUrl(user.firm.chartOfAccountsBlobPath, user.firm.chartOfAccountsContainer);
  }

  return NextResponse.json({
    accounts: user.firm.chartOfAccounts.map(a => ({
      id: a.id,
      accountCode: a.accountCode,
      accountName: a.accountName,
      categoryType: a.categoryType,
      sortOrder: a.sortOrder,
    })),
    fileName: user.firm.chartOfAccountsFileName,
    downloadUrl,
    updatedAt: user.firm.chartOfAccountsUpdatedAt,
  });
}

// POST - upload/update chart of accounts (firm admin only)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  if (!session.user.isFirmAdmin && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Only firm admins can update the chart of accounts' }, { status: 403 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const containerName = 'processed';
  const storagePath = `firms/${user.firmId}/chart-of-accounts/${Date.now()}-${file.name}`;

  // Upload the original file to blob storage
  await uploadToInbox(storagePath, buffer, file.type);

  // Parse the spreadsheet to extract structured data
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

  // Expected columns: Account Code (or Code), Account Name (or Name), Category (or Category Type)
  const accounts: { accountCode: string; accountName: string; categoryType: string; sortOrder: number }[] = [];
  const validCategories = [
    'Fixed Asset', 'Investment', 'Current Asset', 'Current Liability',
    'Long-term Liability', 'Equity', 'Revenue', 'Direct Costs',
    'Overheads', 'Other Income', 'Tax Charge', 'Distribution',
  ];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const code = row['Account Code'] || row['Code'] || row['account_code'] || row['code'] || '';
    const name = row['Account Name'] || row['Name'] || row['Description'] || row['account_name'] || row['description'] || '';
    const cat = row['Category'] || row['Category Type'] || row['Type'] || row['category'] || row['category_type'] || '';

    if (!code || !name) continue;

    // Try to match category to valid list
    const matchedCat = validCategories.find(v => v.toLowerCase() === cat.toLowerCase()) || cat || 'Overheads';

    accounts.push({
      accountCode: String(code).trim(),
      accountName: String(name).trim(),
      categoryType: matchedCat,
      sortOrder: i,
    });
  }

  if (accounts.length === 0) {
    return NextResponse.json({
      error: 'No valid accounts found. Expected columns: Account Code, Account Name, Category',
    }, { status: 400 });
  }

  // Replace all existing chart of accounts for this firm
  await prisma.$transaction(async (tx) => {
    await tx.firmChartOfAccount.deleteMany({ where: { firmId: user.firmId } });
    await tx.firmChartOfAccount.createMany({
      data: accounts.map(a => ({
        firmId: user.firmId,
        ...a,
      })),
    });
    await tx.firm.update({
      where: { id: user.firmId },
      data: {
        chartOfAccountsBlobPath: storagePath,
        chartOfAccountsContainer: containerName,
        chartOfAccountsFileName: file.name,
        chartOfAccountsUpdatedAt: new Date(),
      },
    });
  });

  return NextResponse.json({
    success: true,
    count: accounts.length,
    accounts: accounts.map((a, i) => ({ id: `new-${i}`, ...a })),
  });
}

// DELETE - remove chart of accounts (firm admin only)
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  if (!session.user.isFirmAdmin && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Only firm admins can delete the chart of accounts' }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { firm: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Delete blob if exists
  if (user.firm.chartOfAccountsBlobPath && user.firm.chartOfAccountsContainer) {
    try {
      await deleteBlob(user.firm.chartOfAccountsBlobPath, user.firm.chartOfAccountsContainer);
    } catch {
      // Blob may already be deleted
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.firmChartOfAccount.deleteMany({ where: { firmId: user.firmId } });
    await tx.firm.update({
      where: { id: user.firmId },
      data: {
        chartOfAccountsBlobPath: null,
        chartOfAccountsContainer: null,
        chartOfAccountsFileName: null,
        chartOfAccountsUpdatedAt: null,
      },
    });
  });

  return NextResponse.json({ success: true });
}
