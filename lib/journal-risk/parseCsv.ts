import { parse } from 'csv-parse/sync';
import type { JournalRecord, UserRecord, AccountRecord } from './types';

/**
 * Parse raw CSV content string with headers.
 */
function parseCsvContent(content: string): Record<string, string>[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
}

function toNumber(val: string | undefined): number {
  if (val === undefined || val === null || val === '') return NaN;
  return Number(val);
}

function toNullableString(val: string | undefined): string | null {
  if (val === undefined || val === null || val.trim() === '') return null;
  return val;
}

function toBoolean(val: string | undefined): boolean {
  if (!val) return false;
  return ['true', '1', 'yes'].includes(val.trim().toLowerCase());
}

/**
 * Parse raw CSV content into JournalRecord[].
 */
export function parseJournalsCsv(content: string): JournalRecord[] {
  const rows = parseCsvContent(content);

  return rows.map((row, idx) => {
    const amount = toNumber(row.amount);
    if (isNaN(amount)) {
      throw new Error(`Journal row ${idx + 1}: "amount" must be a valid number, got "${row.amount}"`);
    }
    if (!row.journalId || row.journalId.trim() === '') {
      throw new Error(`Journal row ${idx + 1}: "journalId" is required`);
    }

    return {
      journalId: row.journalId,
      postedAt: row.postedAt,
      period: row.period,
      source: row.source,
      preparedByUserId: row.preparedByUserId,
      approvedByUserId: toNullableString(row.approvedByUserId),
      description: toNullableString(row.description),
      amount,
      debitAccountId: row.debitAccountId,
      creditAccountId: row.creditAccountId,
      accountIds: row.accountIds
        ? row.accountIds.split(';').map((s: string) => s.trim()).filter(Boolean)
        : undefined,
      reversalJournalId: toNullableString(row.reversalJournalId),
      entryCreatedAt: toNullableString(row.entryCreatedAt),
      entity: row.entity,
      currency: row.currency,
    };
  });
}

/**
 * Parse raw CSV content into UserRecord[].
 */
export function parseUsersCsv(content: string): UserRecord[] {
  const rows = parseCsvContent(content);

  return rows.map((row, idx) => {
    if (!row.userId || row.userId.trim() === '') {
      throw new Error(`User row ${idx + 1}: "userId" is required`);
    }
    return {
      userId: row.userId,
      displayName: row.displayName,
      roleTitle: row.roleTitle,
      isSeniorMgmt: row.isSeniorMgmt !== undefined && row.isSeniorMgmt !== ''
        ? toBoolean(row.isSeniorMgmt)
        : undefined,
    };
  });
}

/**
 * Parse raw CSV content into AccountRecord[].
 */
export function parseAccountsCsv(content: string): AccountRecord[] {
  const rows = parseCsvContent(content);

  return rows.map((row, idx) => {
    if (!row.accountId || row.accountId.trim() === '') {
      throw new Error(`Account row ${idx + 1}: "accountId" is required`);
    }
    const normalBalance = toNullableString(row.normalBalance);
    if (normalBalance !== null && normalBalance !== 'debit' && normalBalance !== 'credit') {
      throw new Error(`Account row ${idx + 1}: "normalBalance" must be "debit", "credit", or empty, got "${normalBalance}"`);
    }
    return {
      accountId: row.accountId,
      accountName: row.accountName,
      category: row.category,
      isJudgmental: toBoolean(row.isJudgmental),
      materialityGroup: row.materialityGroup,
      normalBalance: normalBalance as 'debit' | 'credit' | undefined ?? undefined,
    };
  });
}
