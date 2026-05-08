import type { JournalRecord, UserRecord, AccountRecord, Config } from '../types';
/**
 * Validate an array of JournalRecord objects.
 * Throws on the first invalid record with a descriptive message.
 */
export declare function validateJournals(journals: JournalRecord[]): void;
/**
 * Validate an array of UserRecord objects.
 */
export declare function validateUsers(users: UserRecord[]): void;
/**
 * Validate an array of AccountRecord objects.
 */
export declare function validateAccounts(accounts: AccountRecord[]): void;
/**
 * Validate a Config object and cross-reference structural requirements.
 */
export declare function validateConfig(config: Config): void;
//# sourceMappingURL=validators.d.ts.map