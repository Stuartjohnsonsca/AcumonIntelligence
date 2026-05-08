"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportJournalsCsv = exportJournalsCsv;
const fs_1 = __importDefault(require("fs"));
const sync_1 = require("csv-stringify/sync");
/**
 * Export scored journal risk results as a CSV file.
 */
function exportJournalsCsv(results, outputPath) {
    const columns = [
        'journalId',
        'postedAt',
        'period',
        'isManual',
        'preparedByUserId',
        'approvedByUserId',
        'riskScore',
        'riskBand',
        'riskTags',
        'selected',
        'selectionLayer',
        'mandatory',
        'rationale',
    ];
    const rows = results.map((r) => ({
        journalId: r.journalId,
        postedAt: r.postedAt,
        period: r.period,
        isManual: r.isManual,
        preparedByUserId: r.preparedByUserId,
        approvedByUserId: r.approvedByUserId ?? '',
        riskScore: r.riskScore,
        riskBand: r.riskBand,
        riskTags: r.riskTags.join(';'),
        selected: r.selection.selected,
        selectionLayer: r.selection.selectionLayer,
        mandatory: r.selection.mandatory,
        rationale: r.selection.rationale,
    }));
    const csv = (0, sync_1.stringify)(rows, { header: true, columns });
    fs_1.default.writeFileSync(outputPath, csv, 'utf-8');
}
//# sourceMappingURL=exportCsv.js.map