"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadJournalsCsv = loadJournalsCsv;
exports.loadUsersCsv = loadUsersCsv;
exports.loadAccountsCsv = loadAccountsCsv;
const sync_1 = require("csv-parse/sync");
const fs_1 = require("fs");
/**
 * Read a file and parse its CSV content with headers.
 */
function parseCsvFile(filePath) {
    const raw = (0, fs_1.readFileSync)(filePath, 'utf-8');
    return (0, sync_1.parse)(raw, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
    });
}
/**
 * Convert a string to a number or return NaN.
 */
function toNumber(val) {
    if (val === undefined || val === null || val === '')
        return NaN;
    const n = Number(val);
    return n;
}
/**
 * Convert a string to a nullable string: empty/whitespace becomes null.
 */
function toNullableString(val) {
    if (val === undefined || val === null || val.trim() === '')
        return null;
    return val;
}
/**
 * Convert a string to a boolean. Accepts "true"/"1"/"yes" as true, everything else is false.
 */
function toBoolean(val) {
    if (!val)
        return false;
    return ['true', '1', 'yes'].includes(val.trim().toLowerCase());
}
/**
 * Load a journals CSV file into an array of JournalRecord.
 */
function loadJournalsCsv(filePath) {
    const rows = parseCsvFile(filePath);
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
                ? row.accountIds.split(';').map((s) => s.trim()).filter(Boolean)
                : undefined,
            reversalJournalId: toNullableString(row.reversalJournalId),
            entryCreatedAt: toNullableString(row.entryCreatedAt),
            entity: row.entity,
            currency: row.currency,
        };
    });
}
/**
 * Load a users CSV file into an array of UserRecord.
 */
function loadUsersCsv(filePath) {
    const rows = parseCsvFile(filePath);
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
 * Load an accounts CSV file into an array of AccountRecord.
 */
function loadAccountsCsv(filePath) {
    const rows = parseCsvFile(filePath);
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
            normalBalance: normalBalance ?? undefined,
        };
    });
}
//# sourceMappingURL=loadCsv.js.map