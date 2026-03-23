import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      // Import from accounting system
      const { sessionId, source, clientId, fromDate, toDate } = await req.json();
      if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

      const auditSession = await prisma.bankAuditSession.findUnique({ where: { id: sessionId } });
      if (!auditSession || auditSession.userId !== session.user.id) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }

      if (source === 'import') {
        // Fetch from accounting system (Xero etc.)
        const conn = await prisma.accountingConnection.findFirst({
          where: { clientId },
        });

        if (!conn) {
          return NextResponse.json({ error: 'No accounting connection found' }, { status: 400 });
        }

        // TODO: Implement actual Xero bank transaction fetch using conn.accessToken
        // For now return placeholder
        const transactions = [
          { date: fromDate, description: 'Placeholder - Xero import', debit: 0, credit: 0, bankName: '', sortCode: '', accountNumber: '' },
        ];

        await prisma.bankAuditSession.update({
          where: { id: sessionId },
          data: { dataSource: 'import', bankData: transactions as unknown as never },
        });

        return NextResponse.json({ transactions });
      }

      return NextResponse.json({ error: 'Unknown source' }, { status: 400 });
    }

    // File upload (FormData)
    const formData = await req.formData();
    const sessionId = formData.get('sessionId') as string;
    const source = formData.get('source') as string;

    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

    const auditSession = await prisma.bankAuditSession.findUnique({ where: { id: sessionId } });
    if (!auditSession || auditSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (source === 'upload') {
      const file = formData.get('file') as File | null;
      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

      // Read and parse spreadsheet/CSV
      const buffer = Buffer.from(await file.arrayBuffer());
      // TODO: Parse CSV/XLSX using a library like xlsx
      // For now, create placeholder data
      const transactions = [
        { date: '', description: `Uploaded: ${file.name}`, debit: 0, credit: 0 },
      ];

      await prisma.bankAuditSession.update({
        where: { id: sessionId },
        data: { dataSource: 'upload', bankData: transactions as unknown as never },
      });

      // Store file reference
      await prisma.bankAuditFile.create({
        data: {
          sessionId,
          fileName: file.name,
          blobPath: `bank-audit/${sessionId}/${file.name}`,
          container: 'bank-audit',
          fileType: file.name.endsWith('.csv') ? 'csv' : 'xlsx',
          status: 'completed',
          progress: 100,
        },
      });

      return NextResponse.json({ transactions });
    }

    if (source === 'extract') {
      const files = formData.getAll('files') as File[];
      if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

      // Store file references and begin extraction
      const fileRecords = [];
      for (const file of files) {
        const record = await prisma.bankAuditFile.create({
          data: {
            sessionId,
            fileName: file.name,
            blobPath: `bank-audit/${sessionId}/${file.name}`,
            container: 'bank-audit',
            fileType: file.type.includes('pdf') ? 'pdf' : 'image',
            status: 'extracting',
            progress: 50,
          },
        });
        fileRecords.push(record);
      }

      // TODO: Implement actual OCR extraction using Azure Document Intelligence
      // For now, create placeholder data
      const transactions = files.map(f => ({
        date: '',
        description: `Extracted: ${f.name}`,
        bankName: '',
        sortCode: '',
        accountNumber: '',
        statementDate: '',
        statementPage: '',
        debit: 0,
        credit: 0,
      }));

      // Mark files as completed
      for (const record of fileRecords) {
        await prisma.bankAuditFile.update({
          where: { id: record.id },
          data: { status: 'completed', progress: 100 },
        });
      }

      await prisma.bankAuditSession.update({
        where: { id: sessionId },
        data: { dataSource: 'extract', bankData: transactions as unknown as never },
      });

      return NextResponse.json({ transactions });
    }

    return NextResponse.json({ error: 'Unknown source' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[BankAudit Ingest]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
