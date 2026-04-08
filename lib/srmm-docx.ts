import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak,
} from 'docx';

interface MemoInput {
  clientName: string;
  periodEnd: string;
  rmmRow: {
    lineItem: string;
    riskIdentified: string | null;
    assertions: string[];
    controlRisk: string | null;
    complexityText: string | null;
    subjectivityText: string | null;
    uncertaintyText: string | null;
  };
  memo: Record<string, unknown>;
  signOffs: Record<string, unknown>;
}

const FONT = 'Aptos';
const BLUE = '0070C0';
const BORDER = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const CELL_MARGINS = { top: 60, bottom: 60, left: 100, right: 100 };

function labelCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [new TextRun({ text, font: FONT, size: 20 })] })],
  });
}

function valueCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    margins: CELL_MARGINS,
    children: [new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text: text || '', font: FONT, size: 20 })] })],
  });
}

function twoColRow(label: string, value: string, labelWidth = 3402, valueWidth = 6237): TableRow {
  return new TableRow({ children: [labelCell(label, labelWidth), valueCell(value, valueWidth)] });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT, bold: true, size: 22 })],
  });
}

function instructionText(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    children: [new TextRun({ text, font: FONT, italics: true, color: BLUE, size: 20 })],
  });
}

function fullWidthTable(content: Paragraph[]): Table {
  return new Table({
    width: { size: 9628, type: WidthType.DXA },
    columnWidths: [9628],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: BORDERS,
            width: { size: 9628, type: WidthType.DXA },
            margins: CELL_MARGINS,
            children: content.length > 0 ? content : [new Paragraph({ children: [] })],
          }),
        ],
      }),
    ],
  });
}

export async function generateSRMMMemo(input: MemoInput): Promise<Buffer> {
  const { clientName, periodEnd, rmmRow, memo, signOffs } = input;
  const m = memo as Record<string, string>;

  const assertionsStr = Array.isArray(rmmRow.assertions) ? rmmRow.assertions.join(', ') : '';
  const estimatesStr = [rmmRow.complexityText, rmmRow.subjectivityText, rmmRow.uncertaintyText].filter(Boolean).join('; ');

  // Sign-off info
  const preparer = (signOffs as any)?.operator || (signOffs as any)?.preparer;
  const reviewer = (signOffs as any)?.reviewer;
  const ri = (signOffs as any)?.partner || (signOffs as any)?.ri;

  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 20 } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: `${clientName} — Period ending ${periodEnd}`, font: FONT, size: 16, color: '888888' }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Page ', font: FONT, size: 16, color: '888888' }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '888888' }),
              ],
            }),
          ],
        }),
      },
      children: [
        // Title / instruction
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.JUSTIFIED,
          children: [
            new TextRun({
              text: 'This memo summarises the procedures planned, performed and conclusions drawn by audit team for identified significant risks (SRMM) in an audit of financial statements. The use of this is ',
              font: FONT, bold: true, color: BLUE, size: 22,
            }),
            new TextRun({ text: 'MANDATORY', font: FONT, bold: true, color: 'FF0000', size: 22 }),
            new TextRun({ text: ' on all audits and should be signed off by audit partner.', font: FONT, bold: true, color: BLUE, size: 22 }),
          ],
        }),

        new Paragraph({ children: [] }),

        // ── Significant Risk table ──
        sectionHeading('Significant risk'),

        new Table({
          width: { size: 9639, type: WidthType.DXA },
          columnWidths: [3402, 6237],
          rows: [
            twoColRow('Significant risk', rmmRow.lineItem),
            twoColRow('Risk description', rmmRow.riskIdentified || m.riskDescription || ''),
            twoColRow('Impacted assertions', assertionsStr),
            twoColRow('Significant estimates and Judgements (if any)', estimatesStr || m.estimatesJudgements || ''),
            twoColRow(
              'Confirm whether the audit team performed walkthroughs to identify and evaluate the design and test the implementation of controls for the identified significant risk?',
              m.walkthroughConfirmation || ''
            ),
            twoColRow(
              'Confirm whether the audit team has identified any significant deficiencies in the design and implementation of controls addressing the significant risk',
              m.controlDeficiencies || ''
            ),
            twoColRow('Results of test of operating effectiveness of controls (if relevant)', m.controlEffectiveness || ''),
            twoColRow('Testing approach', m.testingApproach || rmmRow.controlRisk || '[Control/Substantive]'),
          ],
        }),

        new Paragraph({ children: [] }),

        // ── Planned Procedures ──
        sectionHeading('Planned procedures'),
        fullWidthTable([
          instructionText('Outline planned audit procedures to address the identified significant risk. The procedures performed should be in line with that of planned procedures agreed in the audit plan and planning letter communicated to management.'),
          new Paragraph({ children: [] }),
          new Paragraph({ children: [new TextRun({ text: m.plannedProcedures || '', font: FONT, size: 20 })] }),
        ]),

        new Paragraph({ children: [new PageBreak()] }),

        // ── Changes to Assessed Risk ──
        sectionHeading('Changes to assessed risk'),
        new Table({
          width: { size: 9639, type: WidthType.DXA },
          columnWidths: [6663, 2976],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: BORDERS, width: { size: 6663, type: WidthType.DXA }, margins: CELL_MARGINS,
                  children: [
                    new Paragraph({ children: [new TextRun({ text: 'During audit, did audit team note any additional information that require reassessment of the identified significant risk?', font: FONT, size: 20 })] }),
                    new Paragraph({ children: [new TextRun({ text: '(When such new information is identified, document how audit team dealt with such information)', font: FONT, italics: true, size: 18 })] }),
                  ],
                }),
                valueCell(m.changesAssessedRisk || '', 2976),
              ],
            }),
          ],
        }),

        new Paragraph({ children: [] }),

        // ── Results of Procedures ──
        sectionHeading('Results of procedures performed'),
        fullWidthTable([
          instructionText('Audit team to provide detailed list of procedures performed in response to significant risk. The procedures performed should be in line with that of planned procedures agreed in the audit plan and planning letter communicated to management.'),
          new Paragraph({ children: [] }),
          instructionText('For every procedure listed in this section, please provide reference to the workpaper where such work is carried out.'),
          new Paragraph({ children: [] }),
          new Paragraph({ children: [new TextRun({ text: m.resultsOfProcedures || '', font: FONT, size: 20 })] }),
        ]),

        new Paragraph({ children: [] }),

        // ── Audit Experts & Specialists ──
        sectionHeading('Audit experts and specialists'),
        new Table({
          width: { size: 9639, type: WidthType.DXA },
          columnWidths: [4820, 4819],
          rows: [
            twoColRow('Did the engagement team involve audit experts / specialists in addressing the significant risk?', m.expertInvolved || '', 4820, 4819),
            twoColRow('Did audit team obtain confirmation from expert with regard to compliance with FRC Ethical Standard 2024?', m.expertFrcCompliance || '', 4820, 4819),
            twoColRow('Has the audit team issued instructions to expert/specialist setting the scope of work?', m.expertScopeIssued || '', 4820, 4819),
            twoColRow('Is there any change in scope during the engagement?', m.expertScopeChanged || '', 4820, 4819),
            twoColRow('Has the audit team evaluated adequacy of auditor\'s expert/specialist work as required under ISA (UK) 620?', m.expertAdequacy || '', 4820, 4819),
            twoColRow('Has the audit team tested the source data used by experts in his work?', m.expertSourceData || '', 4820, 4819),
            twoColRow('Did the audit team identify any caveats included in the report provided by auditor\'s expert/specialist?', m.expertCaveats || '', 4820, 4819),
            twoColRow('Provide list of those caveats and explain how audit team has concluded that the audit team can place reliance on the report irrespective of those conclusions?', m.expertCaveatsList || '', 4820, 4819),
            twoColRow('Provide MWP reference to the signed report received from auditor\'s expert/specialist.', m.expertReportRef || '', 4820, 4819),
          ],
        }),

        new Paragraph({ children: [] }),

        // ── Management Expert ──
        sectionHeading('Management Expert'),
        new Table({
          width: { size: 9639, type: WidthType.DXA },
          columnWidths: [4820, 4819],
          rows: [
            twoColRow('With respect to the identified significant risk, did management use management expert?', m.mgmtExpertUsed || '', 4820, 4819),
            twoColRow('Has audit team assessed the competence and objectivity of management\'s expert?', m.mgmtExpertCompetence || '', 4820, 4819),
            twoColRow('Has the audit team tested the source data used by management\'s expert?', m.mgmtExpertSourceData || '', 4820, 4819),
            twoColRow('Did the audit team identify any caveats in the management expert\'s report?', m.mgmtExpertCaveats || '', 4820, 4819),
          ],
        }),

        new Paragraph({ children: [] }),

        // ── Conclusion ──
        sectionHeading('Conclusion'),
        fullWidthTable([
          instructionText('Provide the overall conclusion of the audit team on the significant risk based on the work performed.'),
          new Paragraph({ children: [] }),
          new Paragraph({ children: [new TextRun({ text: m.conclusion || '', font: FONT, size: 20 })] }),
        ]),

        new Paragraph({ children: [] }),

        // ── Sign-off ──
        sectionHeading('Sign-off'),
        new Table({
          width: { size: 9639, type: WidthType.DXA },
          columnWidths: [3213, 3213, 3213],
          rows: [
            new TableRow({
              children: ['Preparer', 'Reviewer', 'RI / Partner'].map(label =>
                new TableCell({
                  borders: BORDERS,
                  width: { size: 3213, type: WidthType.DXA },
                  margins: CELL_MARGINS,
                  shading: { fill: 'E8E8E8', type: ShadingType.CLEAR },
                  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: label, font: FONT, bold: true, size: 20 })] })],
                })
              ),
            }),
            new TableRow({
              children: [preparer, reviewer, ri].map(so => {
                const info = so as any;
                return new TableCell({
                  borders: BORDERS,
                  width: { size: 3213, type: WidthType.DXA },
                  margins: CELL_MARGINS,
                  children: [
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: info?.userName || '', font: FONT, size: 20 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: info?.timestamp ? new Date(info.timestamp).toLocaleDateString('en-GB') : '', font: FONT, size: 16, color: '888888' })] }),
                  ],
                });
              }),
            }),
          ],
        }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}
