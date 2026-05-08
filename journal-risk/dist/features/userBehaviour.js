"use strict";
/**
 * User-level analytics for journal risk scoring.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeUserPostingFrequency = computeUserPostingFrequency;
exports.computeUserPercentiles = computeUserPercentiles;
exports.identifySeniorUsers = identifySeniorUsers;
const stats_1 = require("./stats");
/**
 * Counts how many journals each user has posted (by preparedByUserId).
 */
function computeUserPostingFrequency(journals) {
    const freq = new Map();
    for (const j of journals) {
        freq.set(j.preparedByUserId, (freq.get(j.preparedByUserId) ?? 0) + 1);
    }
    return freq;
}
/**
 * Computes the percentile rank for each user based on their posting count.
 * A user who posts very few journals will have a low percentile (near 0).
 * A user who posts the most will be near 100.
 */
function computeUserPercentiles(frequency) {
    const percentiles = new Map();
    const allCounts = Array.from(frequency.values());
    for (const [userId, count] of frequency) {
        percentiles.set(userId, (0, stats_1.computePercentile)(allCounts, count));
    }
    return percentiles;
}
/**
 * Identifies user IDs whose role title partially matches any of the senior roles
 * (case-insensitive). For example, if seniorRoles includes "director",
 * a user with roleTitle "Finance Director" would be matched.
 */
function identifySeniorUsers(users, seniorRoles) {
    const result = new Set();
    const lowerRoles = seniorRoles.map((r) => r.toLowerCase());
    for (const [userId, user] of users) {
        const lowerTitle = user.roleTitle.toLowerCase();
        const isSenior = lowerRoles.some((role) => lowerTitle.includes(role));
        if (isSenior) {
            result.add(userId);
        }
    }
    return result;
}
//# sourceMappingURL=userBehaviour.js.map