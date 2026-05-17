/**
 * Xero → journal-risk engine adaptor.
 *
 * Pulls the client's Manual Journals + Accounts directly from Xero and maps
 * them into the JournalRecord / UserRecord / AccountRecord shapes the engine
 * expects. Manual journals are the right subset for ISA 240 management
 * override testing: system-posted journals (from invoices, payments, etc.)
 * cannot be management override by definition.
 *
 * Users are synthesised from each journal's `CreatedByUserName`, since the
 * `accounting.journals.read` scope we hold does not include the org's user
 * directory.
 */

import type { JournalRecord, UserRecord, AccountRecord } from './types';
import { getValidAccessToken, getAccounts } from '@/lib/xero';

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';

interface XeroManualJournalLine {
  AccountID?: string;
  AccountCode?: string;
  LineAmount?: number;
  Description?: string;
}

interface XeroManualJournal {
  ManualJournalID?: string;
  Number?: string;
  Date?: string; // /Date(epochMs+TZ)/
  Status?: string;
  LineAmountTypes?: string;
  Narration?: string;
  UpdatedDateUTC?: string;
  JournalLines?: XeroManualJournalLine[];
  ShowOnCashBasis?: boolean;
  CreatedByUserName?: string;
}

/** Xero serialises dates as `/Date(1700000000000+0000)/`. Returns ISO. */
function xeroDateToIso(raw: string | undefined | null): string {
  if (!raw) return new Date().toISOString();
  const m = /\/Date\((-?\d+)/.exec(raw);
  if (!m) {
    // Fall back to native parse for ISO inputs
    const d = new Date(raw);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  return new Date(parseInt(m[1], 10)).toISOString();
}

/** Pulls manual journals between `dateFrom` and `dateTo` (YYYY-MM-DD). */
async function fetchManualJournals(
  clientId: string,
  dateFrom: string,
  dateTo: string,
): Promise<XeroManualJournal[]> {
  const { accessToken, tenantId } = await getValidAccessToken(clientId);
  const where = [
    `Date >= DateTime(${dateFrom.replace(/-/g, ',')})`,
    `Date <= DateTime(${dateTo.replace(/-/g, ',')})`,
  ].join(' AND ');

  // Xero pages ManualJournals 100 at a time via ?page=N
  const all: XeroManualJournal[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ where, page: String(page) });
    const res = await fetch(`${XERO_API_BASE}/ManualJournals?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Xero ManualJournals fetch failed (${res.status})`);
    }
    const data = await res.json();
    const batch: XeroManualJournal[] = data.ManualJournals ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
    if (page > 100) break; // hard stop — 10k journals is well past sensible
  }
  return all;
}

export interface XeroPullResult {
  journals: JournalRecord[];
  users: UserRecord[];
  accounts: AccountRecord[];
  /** Diagnostic — number of Xero journals skipped because no clear debit /
   *  credit pair could be derived (e.g. zero-sum corrections). */
  skipped: number;
  orgName: string | null;
}

/**
 * Pull the full extract from Xero and map into the engine's input shapes.
 * For multi-line journals, the largest debit and largest credit line are
 * used as the single representative pair so the engine's simple two-account
 * model stays valid; `accountIds` retains the full set for richer rules
 * later.
 */
export async function pullFromXero(opts: {
  clientId: string;
  periodStart: string;
  periodEnd: string;
  /** Pull this many days past period end as well so post-close journals are
   *  included for rule T01. */
  postCloseDays?: number;
  entity: string;
  baseCurrency?: string;
}): Promise<XeroPullResult> {
  const postClose = opts.postCloseDays ?? 90;
  const endDate = new Date(opts.periodEnd);
  endDate.setDate(endDate.getDate() + postClose);
  const dateTo = endDate.toISOString().slice(0, 10);

  const [rawJournals, rawAccounts] = await Promise.all([
    fetchManualJournals(opts.clientId, opts.periodStart, dateTo),
    getAccounts(opts.clientId),
  ]);

  const accountByCode = new Map<string, { id: string; name: string; type: string }>();
  const accountById = new Map<string, { code: string; name: string; type: string }>();
  for (const a of rawAccounts) {
    if (a.Code) accountByCode.set(a.Code, { id: a.AccountID, name: a.Name, type: a.Type });
    if (a.AccountID) accountById.set(a.AccountID, { code: a.Code, name: a.Name, type: a.Type });
  }

  const journals: JournalRecord[] = [];
  const userIds = new Map<string, string>(); // displayName → synthesised userId
  let skipped = 0;

  for (const mj of rawJournals) {
    const lines = mj.JournalLines ?? [];
    if (lines.length === 0) {
      skipped++;
      continue;
    }
    // Largest debit (positive LineAmount) and largest credit (negative).
    let topDebit: XeroManualJournalLine | null = null;
    let topCredit: XeroManualJournalLine | null = null;
    let debitTotal = 0;
    const accountIds: string[] = [];
    for (const l of lines) {
      const amt = Number(l.LineAmount ?? 0);
      const acctId = l.AccountID || l.AccountCode || '';
      if (acctId) accountIds.push(acctId);
      if (amt > 0) {
        debitTotal += amt;
        if (!topDebit || amt > Number(topDebit.LineAmount)) topDebit = l;
      } else if (amt < 0) {
        if (!topCredit || amt < Number(topCredit.LineAmount)) topCredit = l;
      }
    }
    if (!topDebit || !topCredit) {
      skipped++;
      continue;
    }

    const creator = (mj.CreatedByUserName || 'Xero User').trim();
    if (!userIds.has(creator)) {
      userIds.set(creator, `user_${userIds.size + 1}`);
    }
    const userId = userIds.get(creator)!;

    const debitAccountId = topDebit.AccountID || topDebit.AccountCode || 'unknown';
    const creditAccountId = topCredit.AccountID || topCredit.AccountCode || 'unknown';

    journals.push({
      journalId: mj.ManualJournalID || `mj_${journals.length + 1}`,
      postedAt: xeroDateToIso(mj.Date),
      period: opts.periodEnd.slice(0, 7),
      source: 'manual_journal',
      preparedByUserId: userId,
      approvedByUserId: null, // Xero doesn't expose a separate approver
      description: mj.Narration || topDebit.Description || null,
      amount: debitTotal,
      debitAccountId,
      creditAccountId,
      accountIds,
      reversalJournalId: null,
      entryCreatedAt: xeroDateToIso(mj.UpdatedDateUTC),
      entity: opts.entity,
      currency: opts.baseCurrency || 'GBP',
    });
  }

  const users: UserRecord[] = Array.from(userIds.entries()).map(([name, id]) => ({
    userId: id,
    displayName: name,
    roleTitle: 'Xero User',
    isSeniorMgmt: false,
  }));

  // If no journals at all, still emit at least one user record so engine
  // validation doesn't reject the run (it requires a non-empty users array).
  if (users.length === 0) {
    users.push({ userId: 'user_unknown', displayName: 'Xero User', roleTitle: 'Xero User', isSeniorMgmt: false });
  }

  // Xero gives ~30 standard account types — map to the engine's
  // simpler category + judgmental flag. Anything that looks like a
  // provision, accrual, impairment, or reserve is flagged as
  // judgmental so rule A01 picks it up.
  const accounts: AccountRecord[] = rawAccounts.map(a => {
    const haystack = `${a.Name || ''} ${a.Type || ''}`.toLowerCase();
    const isJudgmental =
      /(provision|accrual|impairment|writedown|write\s*down|reserve|deferred|allowance|estimate)/.test(haystack);
    const id = a.AccountID || a.Code;
    return {
      accountId: id,
      accountName: a.Name || a.Code || id,
      category: a.Type || 'OTHER',
      isJudgmental,
      materialityGroup: (a.Class || a.Type || 'OTHER').toLowerCase(),
    };
  });

  return {
    journals,
    users,
    accounts,
    skipped,
    orgName: null,
  };
}
