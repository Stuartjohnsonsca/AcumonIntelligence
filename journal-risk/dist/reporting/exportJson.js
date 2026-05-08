"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportResultJson = exportResultJson;
const fs_1 = __importDefault(require("fs"));
/**
 * Export the full run result as a pretty-printed JSON file.
 */
function exportResultJson(runResult, outputPath) {
    const json = JSON.stringify(runResult, null, 2);
    fs_1.default.writeFileSync(outputPath, json, 'utf-8');
}
//# sourceMappingURL=exportJson.js.map