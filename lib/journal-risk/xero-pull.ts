/**
 * Xero → journal-risk engine adaptor.
 *
 * Two pull modes are supported:
 *   - `manual` (default): pulls ManualJournals only. Manual journals are
 *     the safest subset for ISA 240 management override testing: every line
 *     was intentionally entered by a user, the user's display name comes
 *     across on `CreatedByUserName`, and system-posted journals (from
 *     invoices, payments, etc.) are excluded by definition.
 *   - `full`: pulls the entire `/Journals` feed (every double-entry view,
 *     including system journals). Use when the client's accounting setup
 *     means significant override risk sits in non-manual entries — but
 *     accept that Xero does not expose the posting user on this endpoint,
 *     so the preparer falls back to a placeholder and the user-based rules
 *     lose signal.
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
  /** Which Xero endpoint was used — surfaced on the panel and persisted on
   *  populationEvidence so an auditor can tell at a glance whether system
   *  journals were included. */
  mode: 'manual' | 'full';
}

// ─── Full /Journals endpoint (system + manual entries) ─────────────────────

interface XeroFullJournalLine {
  JournalLineID?: string;
  AccountID?: string;
  AccountCode?: string;
  AccountType?: string;
  AccountName?: string;
  Description?: string;
  NetAmount?: number;
  GrossAmount?: number;
}

interface XeroFullJournal {
  JournalID?: string;
  JournalNumber?: number;
  JournalDate?: string;
  CreatedDateUTC?: string;
  Reference?: string;
  SourceID?: string;
  SourceType?: string;
  JournalLines?: XeroFullJournalLine[];
}

/**
 * Pull the full /Journals feed for the date range. Xero pages this endpoint
 * by `offset=<last JournalNumber>`, returning up to 100 records per call.
 * `JournalDate` filters need DateTime() syntax just like ManualJournals.
 */
async function fetchAllJournals(
  clientId: string,
  dateFrom: string,
  dateTo: string,
): Promise<XeroFullJournal[]> {
  const all: XeroFullJournal[] = [];
  let offset = 0;
  const headersBase = async () => {
    const { accessToken, tenantId } = await getValidAccessToken(clientId);
    return {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      Accept: 'application/json',
    };
  };

  while (true) {
    const params = new URLSearchParams({ offset: String(offset) });
    // /Journals supports If-Modified-Since but not arbitrary `where`. We
    // filter by date client-side, but we still ask Xero to skip ahead via
    // offset so multi-year orgs page properly.
    const res = await fetch(`${XERO_API_BASE}/Journals?${params.toString()}`, {
      headers: await headersBase(),
    });
    if (!res.ok) {
      throw new Error(`Xero Journals fetch failed (${res.status})`);
    }
    const data = await res.json();
    const batch: XeroFullJournal[] = data.Journals ?? [];
    if (batch.length === 0) break;

    // Filter by date here — anything wholly before `dateFrom` is ignored;
    // anything after `dateTo` is the last batch we care about.
    let stopAfterFilter = false;
    let maxJournalNumber = offset;
    for (const j of batch) {
      const iso = xeroDateToIso(j.JournalDate);
      const dateOnly = iso.slice(0, 10);
      if (j.JournalNumber && j.JournalNumber > maxJournalNumber) maxJournalNumber = j.JournalNumber;
      if (dateOnly < dateFrom) continue;
      if (dateOnly > dateTo) { stopAfterFilter = true; continue; }
      all.push(j);
    }

    if (batch.length < 100) break;
    if (stopAfterFilter) break;
    offset = maxJournalNumber;
    if (offset === 0) break; // defensive — shouldn't happen but avoids infinite loop
    if (all.length > 100_000) break; // hard cap — 100k journals is well past sensible
  }
  return all;
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
  /** Which Xero endpoint to use. Defaults to `manual` (safer, includes
   *  posting user names); `full` pulls the entire system journal feed. */
  mode?: 'manual' | 'full';
}): Promise<XeroPullResult> {
  const postClose = opts.postCloseDays ?? 90;
  const endDate = new Date(opts.periodEnd);
  endDate.setDate(endDate.getDate() + postClose);
  const dateTo = endDate.toISOString().slice(0, 10);
  const mode = opts.mode ?? 'manual';

  const rawAccountsPromise = getAccounts(opts.clientId);

  const journals: JournalRecord[] = [];
  const userIds = new Map<string, string>(); // displayName → synthesised userId
  let skipped = 0;

  if (mode === 'manual') {
    const rawJournals = await fetchManualJournals(opts.clientId, opts.periodStart, dateTo);
    for (const mj of rawJournals) {
      const lines = mj.JournalLines ?? [];
      if (lines.length === 0) {
        skipped++;
        continue;
      }
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
      if (!userIds.has(creator)) userIds.set(creator, `user_${userIds.size + 1}`);
      const userId = userIds.get(creator)!;

      journals.push({
        journalId: mj.ManualJournalID || `mj_${journals.length + 1}`,
        postedAt: xeroDateToIso(mj.Date),
        period: opts.periodEnd.slice(0, 7),
        source: 'manual_journal',
        preparedByUserId: userId,
        approvedByUserId: null,
        description: mj.Narration || topDebit.Description || null,
        amount: debitTotal,
        debitAccountId: topDebit.AccountID || topDebit.AccountCode || 'unknown',
        creditAccountId: topCredit.AccountID || topCredit.AccountCode || 'unknown',
        accountIds,
        reversalJournalId: null,
        entryCreatedAt: xeroDateToIso(mj.UpdatedDateUTC),
        entity: opts.entity,
        currency: opts.baseCurrency || 'GBP',
      });
    }
  } else {
    // Full /Journals feed. No CreatedByUserName comes through — every
    // entry is attributed to a synthetic "Xero (system)" user, so the
    // user-based rules (U01/U02/U03) lose signal. We still flag this on
    // populationEvidence so a reviewer can see how the data was sourced.
    const systemUser = 'Xero (system)';
    userIds.set(systemUser, 'user_system');

    const rawJournals = await fetchAllJournals(opts.clientId, opts.periodStart, dateTo);
    for (const fj of rawJournals) {
      const lines = fj.JournalLines ?? [];
      if (lines.length === 0) { skipped++; continue; }
      let topDebit: XeroFullJournalLine | null = null;
      let topCredit: XeroFullJournalLine | null = null;
      let debitTotal = 0;
      const accountIds: string[] = [];
      for (const l of lines) {
        const amt = Number(l.NetAmount ?? 0);
        const acctId = l.AccountID || l.AccountCode || '';
        if (acctId) accountIds.push(acctId);
        if (amt > 0) {
          debitTotal += amt;
          if (!topDebit || amt > Number(topDebit.NetAmount)) topDebit = l;
        } else if (amt < 0) {
          if (!topCredit || amt < Number(topCredit.NetAmount)) topCredit = l;
        }
      }
      if (!topDebit || !topCredit) { skipped++; continue; }

      // SourceType from /Journals — e.g. ACCREC (sales invoice), ACCPAY
      // (purchase invoice), JOURNAL (manual), CASHREC, etc. Mapped to
      // the engine's `source` field so downstream rules can differentiate.
      const sourceTag = (fj.SourceType || 'system').toLowerCase();

      journals.push({
        journalId: fj.JournalID || `j_${journals.length + 1}`,
        postedAt: xeroDateToIso(fj.JournalDate),
        period: opts.periodEnd.slice(0, 7),
        source: sourceTag,
        preparedByUserId: 'user_system',
        approvedByUserId: null,
        description: fj.Reference || topDebit.Description || null,
        amount: debitTotal,
        debitAccountId: topDebit.AccountID || topDebit.AccountCode || 'unknown',
        creditAccountId: topCredit.AccountID || topCredit.AccountCode || 'unknown',
        accountIds,
        reversalJournalId: null,
        entryCreatedAt: xeroDateToIso(fj.CreatedDateUTC),
        entity: opts.entity,
        currency: opts.baseCurrency || 'GBP',
      });
    }
  }

  const rawAccounts = await rawAccountsPromise;

  const users: UserRecord[] = Array.from(userIds.entries()).map(([name, id]) => ({
    userId: id,
    displayName: name,
    roleTitle: name === 'Xero (system)' ? 'System' : 'Xero User',
    isSeniorMgmt: false,
  }));

  if (users.length === 0) {
    users.push({ userId: 'user_unknown', displayName: 'Xero User', roleTitle: 'Xero User', isSeniorMgmt: false });
  }

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
    mode,
  };
}
