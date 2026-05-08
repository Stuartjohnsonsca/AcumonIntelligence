import type { Config } from '../types';
/**
 * Load and parse a JSON file, returning the parsed object typed as T.
 */
export declare function loadJsonFile<T>(filePath: string): T;
/**
 * Load and parse a Config JSON file.
 * Performs basic structural validation before returning.
 */
export declare function loadConfig(filePath: string): Config;
//# sourceMappingURL=loadJson.d.ts.map