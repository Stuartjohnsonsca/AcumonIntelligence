/**
 * Create two new system actions (MethodologyTestType) and update the
 * Large & Unusual Items test to use them.
 *
 * 1. "Fetch Evidence from Accounting System" — reusable action:
 *    Tries to download invoice/document from Xero, falls back to portal request
 *
 * 2. "Large & Unusual Items" — dedicated test action:
 *    Extract → Flag → Review → Evidence → Verify pattern
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/seed-system-actions.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const firms = await prisma.firm.findMany({ select: { id: true, name: true } });

  for (const firm of firms) {
    console.log(`=== ${firm.name} ===`);

    // 1. Fetch Evidence from Accounting System
    const fetchEvidenceCode = 'fetch_evidence_accounting';
    const existingFetch = await prisma.methodologyTestType.findFirst({
      where: { firmId: firm.id, code: fetchEvidenceCode },
    });
    if (!existingFetch) {
      await prisma.methodologyTestType.create({
        data: {
          firmId: firm.id,
          name: 'Fetch Evidence from Accounting System',
          code: fetchEvidenceCode,
          actionType: 'ai_action',
          codeSection: 'evidence_fetch',
          executionDef: {
            description: 'Attempts to retrieve the supporting invoice or document from the connected accounting system (e.g. Xero). If the accounting system is not connected or the document is not available, automatically creates a portal request asking the client to upload the evidence.',
            inputType: 'fetch_evidence_or_portal',
            inputs: [
              { key: 'reference', label: 'Transaction reference / invoice number', source: 'auto:loop_item' },
              { key: 'amount', label: 'Transaction amount', source: 'auto:loop_item' },
              { key: 'date', label: 'Transaction date', source: 'auto:loop_item' },
              { key: 'description', label: 'Transaction description', source: 'auto:loop_item' },
            ],
            outputFormat: 'evidence_document',
            evidenceTypes: ['invoice', 'credit_note', 'receipt', 'contract', 'delivery_note'],
            portalFallbackTemplate: {
              subject: 'Evidence Required: {{reference}}',
              message: 'Please provide the supporting document for:\n\nDate: {{date}}\nDescription: {{description}}\nAmount: £{{amount}}\nReference: {{reference}}',
            },
          },
        },
      });
      console.log('  Created: Fetch Evidence from Accounting System');
    } else {
      console.log('  Already exists: Fetch Evidence from Accounting System');
    }

    // 2. Large & Unusual Items
    const largeUnusualCode = 'large_unusual_items';
    const existingLU = await prisma.methodologyTestType.findFirst({
      where: { firmId: firm.id, code: largeUnusualCode },
    });
    if (!existingLU) {
      await prisma.methodologyTestType.create({
        data: {
          firmId: firm.id,
          name: 'Large & Unusual Items',
          code: largeUnusualCode,
          actionType: 'ai_action',
          codeSection: 'large_unusual',
          executionDef: {
            description: 'Automated test that extracts all transactions from the accounting system (or bank statements as fallback), flags items that are large (above PM) or unusual (related party, round numbers, reversals, etc.), presents the full dataset with flags highlighted, and enables the auditor to select items for evidence gathering and verification.',
            steps: [
              {
                step: 1,
                label: 'Load Transaction Data',
                inputType: 'accounting_extract_or_bank',
                description: 'Extract all transactions from Xero for the audit period. If no accounting connection, falls back to previously extracted bank statement data.',
              },
              {
                step: 2,
                label: 'Identify Anomalies',
                inputType: 'analyse_large_unusual',
                description: 'Programmatic analysis flags: items above PM, round numbers, weekend transactions, related party keywords, reversals, foreign transfers, legal/settlement, loans, distributions, consultancy fees, donations, insurance, property.',
              },
              {
                step: 3,
                label: 'Auditor Review',
                type: 'wait',
                waitFor: 'sampling',
                description: 'Full dataset shown with flags highlighted. Auditor reviews and selects items requiring investigation. This is judgemental selection, not statistical sampling.',
              },
              {
                step: 4,
                label: 'Gather Evidence',
                inputType: 'fetch_evidence_or_portal',
                description: 'For each selected item, attempts to retrieve the supporting document from the accounting system. Falls back to portal request if not available.',
                collection: 'sample_items',
              },
              {
                step: 5,
                label: 'Verify Evidence',
                assignee: 'ai',
                description: 'AI reviews each piece of evidence against the transaction. Assesses: business purpose, authorisation, fraud indicators, classification, correct period.',
                outputFormat: 'pass_fail',
              },
            ],
            flagCategories: [
              'Above Performance Materiality',
              'Above Clearly Trivial',
              'Round number',
              'Weekend transaction',
              'Related party — director/shareholder',
              'Loan/advance',
              'Intercompany/group',
              'Reversal/correction',
              'Distribution',
              'Legal/settlement',
              'Tax/penalty',
              'Cash withdrawal',
              'Foreign/FX transfer',
              'Consultancy/management fee',
              'Donation/gift',
              'Insurance/claim',
              'Property/deposit',
            ],
          },
        },
      });
      console.log('  Created: Large & Unusual Items');
    } else {
      console.log('  Already exists: Large & Unusual Items');
    }

    // 3. Update the Large & Unusual test to reference the new test type
    const luTest = await prisma.methodologyTest.findFirst({
      where: { firmId: firm.id, name: { contains: 'Large' } },
    });
    if (luTest) {
      await prisma.methodologyTest.update({
        where: { id: luTest.id },
        data: { testTypeCode: largeUnusualCode },
      });
      console.log(`  Updated test "${luTest.name}" → testTypeCode: ${largeUnusualCode}`);
    }
  }

  console.log('\nDone');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
