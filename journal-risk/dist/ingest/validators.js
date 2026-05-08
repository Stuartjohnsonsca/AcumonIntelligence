"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateJournals = validateJournals;
exports.validateUsers = validateUsers;
exports.validateAccounts = validateAccounts;
exports.validateConfig = validateConfig;
/**
 * Validate an array of JournalRecord objects.
 * Throws on the first invalid record with a descriptive message.
 */
function validateJournals(journals) {
    if (!Array.isArray(journals)) {
        throw new Error('Journals must be an array');
    }
    if (journals.length === 0) {
        throw new Error('Journals array is empty — at least one journal entry is required');
    }
    const seenIds = new Set();
    for (let i = 0; i < journals.length; i++) {
        const j = journals[i];
        const label = `Journal[${i}] (journalId="${j.journalId ?? ''}")`;
        // Required string fields
        if (!j.journalId || typeof j.journalId !== 'string') {
            throw new Error(`${label}: "journalId" is required and must be a non-empty string`);
        }
        if (seenIds.has(j.journalId)) {
            throw new Error(`${label}: duplicate journalId "${j.journalId}"`);
        }
        seenIds.add(j.journalId);
        if (!j.postedAt || typeof j.postedAt !== 'string') {
            throw new Error(`${label}: "postedAt" is required and must be a non-empty string`);
        }
        if (!j.period || typeof j.period !== 'string') {
            throw new Error(`${label}: "period" is required and must be a non-empty string`);
        }
        if (!j.source || typeof j.source !== 'string') {
            throw new Error(`${label}: "source" is required and must be a non-empty string`);
        }
        if (!j.preparedByUserId || typeof j.preparedByUserId !== 'string') {
            throw new Error(`${label}: "preparedByUserId" is required and must be a non-empty string`);
        }
        if (!j.debitAccountId || typeof j.debitAccountId !== 'string') {
            throw new Error(`${label}: "debitAccountId" is required and must be a non-empty string`);
        }
        if (!j.creditAccountId || typeof j.creditAccountId !== 'string') {
            throw new Error(`${label}: "creditAccountId" is required and must be a non-empty string`);
        }
        if (!j.entity || typeof j.entity !== 'string') {
            throw new Error(`${label}: "entity" is required and must be a non-empty string`);
        }
        if (!j.currency || typeof j.currency !== 'string') {
            throw new Error(`${label}: "currency" is required and must be a non-empty string`);
        }
        // Amount must be a finite number
        if (typeof j.amount !== 'number' || isNaN(j.amount) || !isFinite(j.amount)) {
            throw new Error(`${label}: "amount" must be a finite number`);
        }
        // Nullable fields must be string or null
        if (j.approvedByUserId !== null && typeof j.approvedByUserId !== 'string') {
            throw new Error(`${label}: "approvedByUserId" must be a string or null`);
        }
        if (j.description !== null && typeof j.description !== 'string') {
            throw new Error(`${label}: "description" must be a string or null`);
        }
        if (j.reversalJournalId !== null && typeof j.reversalJournalId !== 'string') {
            throw new Error(`${label}: "reversalJournalId" must be a string or null`);
        }
        // Optional accountIds array
        if (j.accountIds !== undefined) {
            if (!Array.isArray(j.accountIds) || j.accountIds.some((id) => typeof id !== 'string')) {
                throw new Error(`${label}: "accountIds" must be an array of strings if provided`);
            }
        }
    }
}
/**
 * Validate an array of UserRecord objects.
 */
function validateUsers(users) {
    if (!Array.isArray(users)) {
        throw new Error('Users must be an array');
    }
    if (users.length === 0) {
        throw new Error('Users array is empty — at least one user is required');
    }
    const seenIds = new Set();
    for (let i = 0; i < users.length; i++) {
        const u = users[i];
        const label = `User[${i}] (userId="${u.userId ?? ''}")`;
        if (!u.userId || typeof u.userId !== 'string') {
            throw new Error(`${label}: "userId" is required and must be a non-empty string`);
        }
        if (seenIds.has(u.userId)) {
            throw new Error(`${label}: duplicate userId "${u.userId}"`);
        }
        seenIds.add(u.userId);
        if (!u.displayName || typeof u.displayName !== 'string') {
            throw new Error(`${label}: "displayName" is required and must be a non-empty string`);
        }
        if (!u.roleTitle || typeof u.roleTitle !== 'string') {
            throw new Error(`${label}: "roleTitle" is required and must be a non-empty string`);
        }
        if (u.isSeniorMgmt !== undefined && typeof u.isSeniorMgmt !== 'boolean') {
            throw new Error(`${label}: "isSeniorMgmt" must be a boolean if provided`);
        }
    }
}
/**
 * Validate an array of AccountRecord objects.
 */
function validateAccounts(accounts) {
    if (!Array.isArray(accounts)) {
        throw new Error('Accounts must be an array');
    }
    if (accounts.length === 0) {
        throw new Error('Accounts array is empty — at least one account is required');
    }
    const seenIds = new Set();
    for (let i = 0; i < accounts.length; i++) {
        const a = accounts[i];
        const label = `Account[${i}] (accountId="${a.accountId ?? ''}")`;
        if (!a.accountId || typeof a.accountId !== 'string') {
            throw new Error(`${label}: "accountId" is required and must be a non-empty string`);
        }
        if (seenIds.has(a.accountId)) {
            throw new Error(`${label}: duplicate accountId "${a.accountId}"`);
        }
        seenIds.add(a.accountId);
        if (!a.accountName || typeof a.accountName !== 'string') {
            throw new Error(`${label}: "accountName" is required and must be a non-empty string`);
        }
        if (!a.category || typeof a.category !== 'string') {
            throw new Error(`${label}: "category" is required and must be a non-empty string`);
        }
        if (typeof a.isJudgmental !== 'boolean') {
            throw new Error(`${label}: "isJudgmental" must be a boolean`);
        }
        if (!a.materialityGroup || typeof a.materialityGroup !== 'string') {
            throw new Error(`${label}: "materialityGroup" is required and must be a non-empty string`);
        }
        if (a.normalBalance !== undefined &&
            a.normalBalance !== 'debit' &&
            a.normalBalance !== 'credit') {
            throw new Error(`${label}: "normalBalance" must be "debit", "credit", or undefined`);
        }
    }
}
/**
 * Validate a Config object and cross-reference structural requirements.
 */
function validateConfig(config) {
    if (!config || typeof config !== 'object') {
        throw new Error('Config must be a non-null object');
    }
    // Required string fields
    const requiredStrings = [
        'version',
        'timezone',
        'periodStartDate',
        'periodEndDate',
        'postCloseCutoffDate',
    ];
    for (const field of requiredStrings) {
        if (typeof config[field] !== 'string' || config[field].trim() === '') {
            throw new Error(`Config: "${field}" is required and must be a non-empty string`);
        }
    }
    // Validate date ordering
    const start = new Date(config.periodStartDate);
    const end = new Date(config.periodEndDate);
    const cutoff = new Date(config.postCloseCutoffDate);
    if (isNaN(start.getTime())) {
        throw new Error(`Config: "periodStartDate" is not a valid date: "${config.periodStartDate}"`);
    }
    if (isNaN(end.getTime())) {
        throw new Error(`Config: "periodEndDate" is not a valid date: "${config.periodEndDate}"`);
    }
    if (isNaN(cutoff.getTime())) {
        throw new Error(`Config: "postCloseCutoffDate" is not a valid date: "${config.postCloseCutoffDate}"`);
    }
    if (start >= end) {
        throw new Error('Config: "periodStartDate" must be before "periodEndDate"');
    }
    if (end > cutoff) {
        throw new Error('Config: "postCloseCutoffDate" must be on or after "periodEndDate"');
    }
    // businessHours
    if (!config.businessHours ||
        typeof config.businessHours.start !== 'string' ||
        typeof config.businessHours.end !== 'string') {
        throw new Error('Config: "businessHours" must have "start" and "end" string fields');
    }
    // periodEndWindowDays
    if (typeof config.periodEndWindowDays !== 'number' || config.periodEndWindowDays < 0) {
        throw new Error('Config: "periodEndWindowDays" must be a non-negative number');
    }
    // Arrays
    if (!Array.isArray(config.seniorRoles) || config.seniorRoles.length === 0) {
        throw new Error('Config: "seniorRoles" must be a non-empty array of strings');
    }
    if (!Array.isArray(config.suspiciousKeywords)) {
        throw new Error('Config: "suspiciousKeywords" must be an array of strings');
    }
    // Thresholds
    if (!config.thresholds || typeof config.thresholds !== 'object') {
        throw new Error('Config: "thresholds" object is required');
    }
    if (typeof config.thresholds.highRiskMinScore !== 'number') {
        throw new Error('Config: "thresholds.highRiskMinScore" must be a number');
    }
    if (typeof config.thresholds.mandatorySelectMinScore !== 'number') {
        throw new Error('Config: "thresholds.mandatorySelectMinScore" must be a number');
    }
    if (typeof config.thresholds.mandatorySelectMinCriticalTags !== 'number') {
        throw new Error('Config: "thresholds.mandatorySelectMinCriticalTags" must be a number');
    }
    // Selection
    if (!config.selection || typeof config.selection !== 'object') {
        throw new Error('Config: "selection" object is required');
    }
    if (typeof config.selection.layer3UnpredictableCount !== 'number') {
        throw new Error('Config: "selection.layer3UnpredictableCount" must be a number');
    }
    if (typeof config.selection.maxSampleSize !== 'number') {
        throw new Error('Config: "selection.maxSampleSize" must be a number');
    }
    if (!config.selection.layer2CoverageTargets ||
        typeof config.selection.layer2CoverageTargets !== 'object') {
        throw new Error('Config: "selection.layer2CoverageTargets" must be an object');
    }
    // Weights
    if (!config.weights || typeof config.weights !== 'object') {
        throw new Error('Config: "weights" must be an object');
    }
    for (const [key, val] of Object.entries(config.weights)) {
        if (typeof val !== 'number') {
            throw new Error(`Config: "weights.${key}" must be a number, got ${typeof val}`);
        }
    }
}
//# sourceMappingURL=validators.js.map