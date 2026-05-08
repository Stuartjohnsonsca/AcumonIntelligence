"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadJsonFile = loadJsonFile;
exports.loadConfig = loadConfig;
const fs_1 = require("fs");
/**
 * Load and parse a JSON file, returning the parsed object typed as T.
 */
function loadJsonFile(filePath) {
    const raw = (0, fs_1.readFileSync)(filePath, 'utf-8');
    try {
        return JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`Failed to parse JSON file "${filePath}": ${err instanceof Error ? err.message : String(err)}`);
    }
}
/**
 * Load and parse a Config JSON file.
 * Performs basic structural validation before returning.
 */
function loadConfig(filePath) {
    const config = loadJsonFile(filePath);
    // Validate required top-level fields exist
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
    if (!config.businessHours ||
        typeof config.businessHours.start !== 'string' ||
        typeof config.businessHours.end !== 'string') {
        throw new Error('Config: "businessHours" must have "start" and "end" string fields');
    }
    if (typeof config.periodEndWindowDays !== 'number' || isNaN(config.periodEndWindowDays)) {
        throw new Error('Config: "periodEndWindowDays" must be a number');
    }
    if (!Array.isArray(config.seniorRoles)) {
        throw new Error('Config: "seniorRoles" must be an array of strings');
    }
    if (!Array.isArray(config.suspiciousKeywords)) {
        throw new Error('Config: "suspiciousKeywords" must be an array of strings');
    }
    if (!config.thresholds || typeof config.thresholds !== 'object') {
        throw new Error('Config: "thresholds" object is required');
    }
    const requiredThresholds = [
        'highRiskMinScore',
        'mandatorySelectMinScore',
        'mandatorySelectMinCriticalTags',
    ];
    for (const field of requiredThresholds) {
        if (typeof config.thresholds[field] !== 'number') {
            throw new Error(`Config: "thresholds.${field}" must be a number`);
        }
    }
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
    if (!config.weights || typeof config.weights !== 'object') {
        throw new Error('Config: "weights" must be an object mapping dimension names to numbers');
    }
    return config;
}
//# sourceMappingURL=loadJson.js.map