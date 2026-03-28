import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function escapeCell(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function toCsvRow(cells: string[]): string {
  return cells.map(escapeCell).join(',');
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuote = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ',') { cols.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

// ─── GET: export existing data as CSV ────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isResourceAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  const type = new URL(request.url).searchParams.get('type') ?? 'jobs';

  if (type === 'jobs') {
    const jobs = await prisma.resourceJob.findMany({
      where: { firmId },
      include: { client: { select: { clientName: true } } },
      orderBy: [{ periodEnd: 'asc' }],
    });

    const headers = [
      'Client Name', 'Audit Type', 'Period End', 'Target Completion',
      'Budget Hours Specialist', 'Budget Hours RI', 'Budget Hours Reviewer',
      'Budget Hours Preparer', 'Scheduling Status',
    ];

    const dataRows = jobs.map((j) =>
      toCsvRow([
        j.client.clientName,
        j.auditType,
        fmtDate(j.periodEnd),
        fmtDate(j.targetCompletion),
        String(j.budgetHoursSpecialist),
        String(j.budgetHoursRI),
        String(j.budgetHoursReviewer),
        String(j.budgetHoursPreparer),
        j.schedulingStatus,
      ])
    );

    const csv = [headers.join(','), ...dataRows].join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="resource-seed-jobs.csv"',
      },
    });
  }

  if (type === 'allocations') {
    const allocations = await prisma.resourceAllocation.findMany({
      where: { firmId },
      include: { user: { select: { name: true } } },
      orderBy: { startDate: 'asc' },
    });

    // Map engagementId → ResourceJob
    const jobIds = [...new Set(allocations.map((a) => a.engagementId))];
    const jobs = await prisma.resourceJob.findMany({
      where: { firmId, id: { in: jobIds } },
      include: { client: { select: { clientName: true } } },
    });
    const jobMap = new Map(jobs.map((j) => [j.id, j]));

    const headers = [
      'Client Name', 'Audit Type', 'Period End', 'Staff Name',
      'Role', 'Start Date', 'End Date', 'Hours Per Day', 'Notes',
    ];

    const dataRows = allocations.map((a) => {
      const job = jobMap.get(a.engagementId);
      return toCsvRow([
        job?.client?.clientName ?? '',
        job?.auditType ?? '',
        job ? fmtDate(job.periodEnd) : '',
        a.user.name ?? '',
        a.role,
        fmtDate(a.startDate),
        fmtDate(a.endDate),
        String(a.hoursPerDay),
        a.notes ?? '',
      ]);
    });

    const csv = [headers.join(','), ...dataRows].join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="resource-seed-allocations.csv"',
      },
    });
  }

  return Response.json({ error: 'Invalid type — must be jobs or allocations' }, { status: 400 });
}

// ─── POST: upload CSV to seed data ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isResourceAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const type = formData.get('type') as string;
  const file = formData.get('file') as File | null;
  if (!file) return Response.json({ error: 'No file provided' }, { status: 400 });
  if (!['jobs', 'allocations'].includes(type)) {
    return Response.json({ error: 'Invalid type' }, { status: 400 });
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return Response.json({ error: 'CSV has no data rows' }, { status: 400 });

  const headers = rows[0].map((h) => h.toLowerCase().trim());
  const dataRows = rows.slice(1);

  let created = 0;
  let skipped = 0;
  const errors: { row: number; message: string }[] = [];

  // ── Jobs ────────────────────────────────────────────────────────────────────
  if (type === 'jobs') {
    const REQUIRED = ['client name', 'audit type', 'period end', 'target completion', 'scheduling status'];
    for (const h of REQUIRED) {
      if (!headers.includes(h)) {
        return Response.json({ error: `Missing required column: "${h}"` }, { status: 400 });
      }
    }

    const col = (name: string) => headers.indexOf(name);

    const clients = await prisma.client.findMany({
      where: { firmId },
      select: { id: true, clientName: true },
    });
    const clientMap = new Map(clients.map((c) => [c.clientName.toLowerCase().trim(), c.id]));

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;
      try {
        const clientName = row[col('client name')]?.trim();
        const auditType = row[col('audit type')]?.trim();
        const periodEndStr = row[col('period end')]?.trim();
        const targetCompStr = row[col('target completion')]?.trim();
        const status = row[col('scheduling status')]?.trim() || 'unscheduled';

        if (!clientName) { errors.push({ row: rowNum, message: 'Client Name is required' }); continue; }
        if (!auditType) { errors.push({ row: rowNum, message: 'Audit Type is required' }); continue; }
        if (!periodEndStr) { errors.push({ row: rowNum, message: 'Period End is required' }); continue; }
        if (!targetCompStr) { errors.push({ row: rowNum, message: 'Target Completion is required' }); continue; }

        const clientId = clientMap.get(clientName.toLowerCase());
        if (!clientId) { errors.push({ row: rowNum, message: `Client not found: "${clientName}"` }); continue; }

        const periodEnd = new Date(periodEndStr);
        const targetCompletion = new Date(targetCompStr);
        if (isNaN(periodEnd.getTime())) { errors.push({ row: rowNum, message: `Invalid Period End date: "${periodEndStr}"` }); continue; }
        if (isNaN(targetCompletion.getTime())) { errors.push({ row: rowNum, message: `Invalid Target Completion date: "${targetCompStr}"` }); continue; }

        const existing = await prisma.resourceJob.findFirst({
          where: { firmId, clientId, auditType, periodEnd },
        });
        if (existing) { skipped++; continue; }

        const bhSpec = parseFloat(row[col('budget hours specialist')] || '0') || 0;
        const bhRI = parseFloat(row[col('budget hours ri')] || '0') || 0;
        const bhRev = parseFloat(row[col('budget hours reviewer')] || '0') || 0;
        const bhPrep = parseFloat(row[col('budget hours preparer')] || '0') || 0;

        await prisma.resourceJob.create({
          data: {
            firmId,
            clientId,
            auditType,
            periodEnd,
            targetCompletion,
            budgetHoursSpecialist: bhSpec,
            budgetHoursRI: bhRI,
            budgetHoursReviewer: bhRev,
            budgetHoursPreparer: bhPrep,
            schedulingStatus: status,
          },
        });
        created++;
      } catch (e: any) {
        errors.push({ row: rowNum, message: e?.message ?? 'Unexpected error' });
      }
    }
  }

  // ── Allocations ─────────────────────────────────────────────────────────────
  if (type === 'allocations') {
    const REQUIRED = ['client name', 'audit type', 'period end', 'staff name', 'role', 'start date', 'end date'];
    for (const h of REQUIRED) {
      if (!headers.includes(h)) {
        return Response.json({ error: `Missing required column: "${h}"` }, { status: 400 });
      }
    }

    const col = (name: string) => headers.indexOf(name);

    const clients = await prisma.client.findMany({
      where: { firmId },
      select: { id: true, clientName: true },
    });
    const clientMap = new Map(clients.map((c) => [c.clientName.toLowerCase().trim(), c.id]));

    const staff = await prisma.user.findMany({
      where: { firmId, isActive: true },
      select: { id: true, name: true },
    });
    const staffMap = new Map(staff.map((s) => [(s.name ?? '').toLowerCase().trim(), s.id]));

    const jobs = await prisma.resourceJob.findMany({
      where: { firmId },
      select: { id: true, clientId: true, auditType: true, periodEnd: true },
    });

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;
      try {
        const clientName = row[col('client name')]?.trim();
        const auditType = row[col('audit type')]?.trim();
        const periodEndStr = row[col('period end')]?.trim();
        const staffName = row[col('staff name')]?.trim();
        const role = row[col('role')]?.trim();
        const startDateStr = row[col('start date')]?.trim();
        const endDateStr = row[col('end date')]?.trim();
        const hoursPerDay = parseFloat(row[col('hours per day')] || '7.5') || 7.5;
        const notes = headers.includes('notes') ? (row[col('notes')]?.trim() || null) : null;

        if (!clientName) { errors.push({ row: rowNum, message: 'Client Name is required' }); continue; }
        if (!auditType) { errors.push({ row: rowNum, message: 'Audit Type is required' }); continue; }
        if (!periodEndStr) { errors.push({ row: rowNum, message: 'Period End is required' }); continue; }
        if (!staffName) { errors.push({ row: rowNum, message: 'Staff Name is required' }); continue; }
        if (!role) { errors.push({ row: rowNum, message: 'Role is required' }); continue; }
        if (!startDateStr) { errors.push({ row: rowNum, message: 'Start Date is required' }); continue; }
        if (!endDateStr) { errors.push({ row: rowNum, message: 'End Date is required' }); continue; }

        const clientId = clientMap.get(clientName.toLowerCase());
        if (!clientId) { errors.push({ row: rowNum, message: `Client not found: "${clientName}"` }); continue; }

        const userId = staffMap.get(staffName.toLowerCase());
        if (!userId) { errors.push({ row: rowNum, message: `Staff member not found: "${staffName}"` }); continue; }

        const periodEnd = new Date(periodEndStr);
        const startDate = new Date(startDateStr);
        const endDate = new Date(endDateStr);
        if (isNaN(periodEnd.getTime())) { errors.push({ row: rowNum, message: `Invalid Period End: "${periodEndStr}"` }); continue; }
        if (isNaN(startDate.getTime())) { errors.push({ row: rowNum, message: `Invalid Start Date: "${startDateStr}"` }); continue; }
        if (isNaN(endDate.getTime())) { errors.push({ row: rowNum, message: `Invalid End Date: "${endDateStr}"` }); continue; }

        // Find the matching ResourceJob
        const job = jobs.find(
          (j) =>
            j.clientId === clientId &&
            j.auditType.toLowerCase() === auditType.toLowerCase() &&
            Math.abs(new Date(j.periodEnd).getTime() - periodEnd.getTime()) < 86_400_000
        );
        if (!job) {
          errors.push({ row: rowNum, message: `Job not found for "${clientName}" / ${auditType} / ${periodEndStr}` });
          continue;
        }

        // Skip duplicates (same job + user + role + dates)
        const existing = await prisma.resourceAllocation.findFirst({
          where: { firmId, engagementId: job.id, userId, role, startDate, endDate },
        });
        if (existing) { skipped++; continue; }

        await prisma.resourceAllocation.create({
          data: { firmId, engagementId: job.id, userId, role, startDate, endDate, hoursPerDay, notes },
        });
        created++;
      } catch (e: any) {
        errors.push({ row: rowNum, message: e?.message ?? 'Unexpected error' });
      }
    }
  }

  return Response.json({ created, skipped, errors });
}
