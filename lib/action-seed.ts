import type { ActionDefinitionData } from './action-registry';

/**
 * System Action definitions seeded for all firms.
 * Each wraps one or more existing flow-engine handlers.
 */
export const SYSTEM_ACTIONS: ActionDefinitionData[] = [
  // ─── Evidence Actions ──────────────────────────────────────────────────────

  {
    code: 'request_documents',
    name: 'Request Documents from Client',
    description: 'Request supporting documents from the client. Checks existing DB and accounting system first, then sends remaining requests via Client Portal. Validates received documents and loops until all resolved.',
    category: 'evidence',
    handlerName: 'requestDocuments',
    icon: 'FileSearch',
    color: '#3b82f6',
    isSystem: true,
    inputSchema: [
      { code: 'message_to_client', label: 'Message to Client', type: 'textarea', required: true, source: 'user', group: 'Request Details', description: 'Message sent to client via the portal. Supports {{placeholders}}.' },
      { code: 'document_type', label: 'Document Type', type: 'select', required: true, source: 'user', group: 'Request Details', options: [
        { value: 'invoice', label: 'Invoice' },
        { value: 'contract', label: 'Contract' },
        { value: 'bank_statement', label: 'Bank Statement' },
        { value: 'receipt', label: 'Receipt' },
        { value: 'purchase_order', label: 'Purchase Order' },
        { value: 'credit_note', label: 'Credit Note' },
        { value: 'payment_voucher', label: 'Payment Voucher' },
        { value: 'other', label: 'Other' },
      ]},
      { code: 'expected_document_match', label: 'Document Matching', type: 'select', required: false, source: 'user', group: 'Request Details', defaultValue: 'one_per_transaction', description: 'How received files should map to the requested items. The action auto-detects format (single file, multiple files, zip, chat) and processes accordingly — unzipping, splitting, or combining as needed.', options: [
        { value: 'one_per_transaction', label: 'One document per transaction' },
        { value: 'single_combined', label: 'Single document covers all transactions' },
        { value: 'any', label: 'Any — let me match manually' },
      ]},
      { code: 'area_of_work', label: 'Area of Work', type: 'text', required: false, source: 'auto', autoMapFrom: '$ctx.test.fsLine', group: 'Request Details', description: 'Auto-populated from the FS Line being tested (e.g. Revenue, Trade Debtors). Can be overridden.' },
      { code: 'transactions', label: 'Requested Transactions', type: 'json_table', required: false, source: 'auto', autoMapFrom: '$prev.data_table', group: 'Data', description: 'Table with Date, Ref Number, CounterParty, Gross Amount, Net Amount, Account Code columns.' },
      { code: 'request_id', label: 'Request ID', type: 'text', required: false, source: 'auto', autoMapFrom: '$prev.request_id' },
      { code: 'document_ids', label: 'Document IDs', type: 'json_table', required: false, source: 'auto', autoMapFrom: '$prev.document_ids' },
    ],
    outputSchema: [
      { code: 'documents', label: 'Retrieved Documents', type: 'file_array', description: 'Array of document files, each associated with a document ID.' },
      { code: 'portal_request_id', label: 'Portal Request ID', type: 'text' },
      { code: 'chat_response', label: 'Client Response', type: 'text' },
      { code: 'outstanding_count', label: 'Outstanding Documents', type: 'number' },
    ],
  },

  {
    code: 'extract_bank_statements',
    name: 'Extract Bank Statements',
    description: 'Processes bank statement files through a 7-step pipeline: (1) Confirms statements belong to the client entity, (2) Separates into distinct bank accounts, (3) Orders pages and flags missing pages, (4) Checks closing balance at period end and matches to TB account, (5) Confirms coverage of period start date, (6) Confirms coverage of period end date, (7) Extracts all transactions with header info (bank, account, sort code, statement date) repeated per row. Issues and gaps are flagged for review rather than blocking.',
    category: 'evidence',
    handlerName: 'extractBankStatements',
    icon: 'Landmark',
    color: '#3b82f6',
    isSystem: true,
    inputSchema: [
      { code: 'source_files', label: 'Bank Statement Files', type: 'file', required: true, source: 'auto', autoMapFrom: '$prev.documents', group: 'Input', description: 'PDF or image files of bank statements. Can be mixed accounts, multiple pages, or zipped — the action sorts everything out.' },
      { code: 'client_name', label: 'Client Name', type: 'text', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.clientName', group: 'Validation', description: 'Used to confirm bank statements belong to this client.' },
      { code: 'currency', label: 'Currency', type: 'select', required: false, source: 'user', group: 'Processing', defaultValue: 'GBP', options: [
        { value: 'GBP', label: 'GBP' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' },
      ]},
      { code: 'period_start', label: 'Period Start', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodStart', group: 'Processing' },
      { code: 'period_end', label: 'Period End', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Processing' },
      { code: 'evidence_tag_level', label: 'Evidence Tag Level', type: 'select', required: false, source: 'user', group: 'Storage', defaultValue: 'account', description: 'How to tag evidence in the document library.', options: [
        { value: 'account', label: 'Per TB Account (e.g. bank_1000, bank_1010)' },
        { value: 'fs_line', label: 'Per FS Line (e.g. Cash at Bank)' },
      ]},
    ],
    outputSchema: [
      { code: 'data_table', label: 'Extracted Transactions', type: 'data_table', description: 'All transactions with header info per row: bank name, account number, sort code, statement date, plus transaction date, description, debit, credit, balance.' },
      { code: 'data_by_account', label: 'Transactions by Account', type: 'json', description: 'Transactions grouped by detected bank account.' },
      { code: 'transaction_count', label: 'Transaction Count', type: 'number' },
      { code: 'account_count', label: 'Number of Accounts Detected', type: 'number' },
      { code: 'account_tb_mapping', label: 'Account to TB Mapping', type: 'json', description: 'Each bank account mapped to its TB account based on period-end closing balance.' },
      { code: 'validation_report', label: 'Validation Report', type: 'json', description: 'Results of all checks: client name match, page ordering, missing pages, period coverage (start/end), balance reconciliation to TB.' },
      { code: 'issues', label: 'Issues Flagged', type: 'data_table', description: 'List of issues found: wrong client, missing pages, period gaps, balance mismatches. Each with severity and recommendation.' },
      { code: 'statements', label: 'Statement Summaries', type: 'json', description: 'Per-account summaries: opening balance, closing balance, page count, date range, total debits/credits.' },
    ],
  },

  {
    code: 'accounting_extract',
    name: 'Extract from Accounting System',
    description: 'Extract data directly from the connected accounting system (e.g. Xero). Fetches invoices, payments, or transactions for the engagement period.',
    category: 'evidence',
    handlerName: 'accountingExtract',
    icon: 'Database',
    color: '#3b82f6',
    isSystem: true,
    inputSchema: [
      { code: 'data_type', label: 'Data Type', type: 'select', required: true, source: 'user', group: 'Extract', options: [
        { value: 'invoices', label: 'Sales Invoices' },
        { value: 'bills', label: 'Purchase Bills' },
        { value: 'payments', label: 'Payments' },
        { value: 'bank_transactions', label: 'Bank Transactions' },
        { value: 'journals', label: 'Journal Entries' },
        { value: 'contacts', label: 'Contacts' },
      ]},
      { code: 'period_start', label: 'Period Start', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodStart', group: 'Filters' },
      { code: 'period_end', label: 'Period End', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Filters' },
      { code: 'account_codes', label: 'Account Code Filter', type: 'text', required: false, source: 'user', group: 'Filters', description: 'Comma-separated account codes to filter.' },
    ],
    outputSchema: [
      { code: 'data_table', label: 'Extracted Data', type: 'data_table' },
      { code: 'record_count', label: 'Record Count', type: 'number' },
    ],
  },

  // ─── Sampling Actions ──────────────────────────────────────────────────────

  {
    code: 'select_sample',
    name: 'Select Sample',
    description: 'Select a representative sample from the population. Supports Standard (sample calculator), Scored & Ranked (large/uncertain), and Charted Outliers (frequency distribution) methods.',
    category: 'sampling',
    handlerName: 'selectSample',
    icon: 'Target',
    color: '#f59e0b',
    isSystem: true,
    inputSchema: [
      { code: 'sample_type', label: 'Sample Type', type: 'select', required: true, source: 'user', group: 'Method', options: [
        { value: 'standard', label: 'Standard (Sample Calculator)' },
        { value: 'scored_ranked', label: 'Scored & Ranked (Large & Uncertain)' },
        { value: 'charted_outliers', label: 'Charted Outliers (Frequency Distribution)' },
      ]},
      { code: 'population', label: 'Population Data', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$prev.data_table', group: 'Data' },
      { code: 'output_action', label: 'Output Action', type: 'select', required: false, source: 'user', group: 'Output', options: [
        { value: 'request_documents', label: 'Request Documents' },
        { value: 'verify_evidence', label: 'Verify Evidence' },
        { value: 'none', label: 'None (manual)' },
      ]},
    ],
    outputSchema: [
      { code: 'sample_items', label: 'Selected Sample Items', type: 'data_table' },
      { code: 'sample_size', label: 'Sample Size', type: 'number' },
      { code: 'data_table', label: 'Sample Data Table', type: 'data_table', description: 'Same as sample_items, for chaining compatibility.' },
      { code: 'document_ids', label: 'Document IDs', type: 'json', description: 'Array of document/transaction IDs for the selected sample.' },
    ],
  },

  // ─── Analysis Actions ──────────────────────────────────────────────────────

  {
    code: 'ai_analysis',
    name: 'AI Analysis',
    description: 'Use AI to analyse data, identify patterns or anomalies, extract information, or perform automated checks. Configurable prompt template.',
    category: 'analysis',
    handlerName: 'aiAnalysis',
    icon: 'Sparkles',
    color: '#8b5cf6',
    isSystem: true,
    inputSchema: [
      { code: 'prompt_template', label: 'Analysis Prompt', type: 'textarea', required: true, source: 'user', group: 'AI Config', description: 'Prompt template for the AI. Use {{placeholders}} for dynamic data.' },
      { code: 'system_instruction', label: 'System Instruction', type: 'textarea', required: false, source: 'user', group: 'AI Config', description: 'System-level instruction to guide the AI behaviour.' },
      { code: 'input_data', label: 'Input Data', type: 'json_table', required: false, source: 'auto', autoMapFrom: '$prev.data_table', group: 'Data' },
      { code: 'output_format', label: 'Output Format', type: 'select', required: true, source: 'user', group: 'Output', defaultValue: 'pass_fail', options: [
        { value: 'pass_fail', label: 'Pass / Fail' },
        { value: 'data_table', label: 'Data Table' },
        { value: 'text', label: 'Free Text' },
      ]},
      { code: 'requires_review', label: 'Requires Human Review', type: 'boolean', required: false, source: 'user', group: 'Output', defaultValue: true },
    ],
    outputSchema: [
      { code: 'result', label: 'AI Result', type: 'json' },
      { code: 'data_table', label: 'Result Table', type: 'data_table' },
      { code: 'pass_fail', label: 'Pass/Fail', type: 'pass_fail' },
      { code: 'summary', label: 'Summary Text', type: 'text' },
    ],
  },

  {
    code: 'analyse_large_unusual',
    name: 'Analyse Large & Unusual Items',
    description: 'AI analysis of large or unusual transactions identified from the population. Flags items requiring further investigation.',
    category: 'analysis',
    handlerName: 'analyseLargeUnusual',
    icon: 'AlertTriangle',
    color: '#8b5cf6',
    isSystem: true,
    inputSchema: [
      { code: 'data_table', label: 'Transaction Data', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$prev.data_table', group: 'Data' },
      { code: 'materiality', label: 'Materiality Threshold', type: 'number', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.materiality', group: 'Thresholds' },
      { code: 'performance_materiality', label: 'Performance Materiality', type: 'number', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.performanceMateriality', group: 'Thresholds' },
    ],
    outputSchema: [
      { code: 'findings', label: 'Flagged Items', type: 'data_table' },
      { code: 'flagged_count', label: 'Flagged Count', type: 'number' },
      { code: 'data_table', label: 'Full Results', type: 'data_table' },
    ],
  },

  {
    code: 'analyse_cut_off',
    name: 'Analyse Cut-Off Transactions',
    description: 'AI analysis of transactions near the period boundary to verify correct cut-off. Checks for items recorded in the wrong period.',
    category: 'analysis',
    handlerName: 'analyseCutOff',
    icon: 'Calendar',
    color: '#8b5cf6',
    isSystem: true,
    inputSchema: [
      { code: 'data_table', label: 'Transaction Data', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$prev.data_table', group: 'Data' },
      { code: 'period_end', label: 'Period End Date', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Config' },
      { code: 'cut_off_days', label: 'Days Either Side', type: 'number', required: false, source: 'user', group: 'Config', defaultValue: 7, description: 'Number of days before and after period end to check.' },
    ],
    outputSchema: [
      { code: 'findings', label: 'Cut-Off Findings', type: 'data_table' },
      { code: 'data_table', label: 'Full Results', type: 'data_table' },
      { code: 'pass_fail', label: 'Overall Result', type: 'pass_fail' },
    ],
  },

  // ─── Verification Actions ──────────────────────────────────────────────────

  {
    code: 'compare_bank_to_tb',
    name: 'Compare Bank to Trial Balance',
    description: 'Reconcile bank statement totals against the trial balance. Identifies unmatched items and calculates variances.',
    category: 'verification',
    handlerName: 'compareBankToTB',
    icon: 'Scale',
    color: '#22c55e',
    isSystem: true,
    inputSchema: [
      { code: 'bank_data', label: 'Bank Statement Data', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$prev.data_table', group: 'Data' },
      { code: 'tb_balance', label: 'TB Balance', type: 'number', required: false, source: 'auto', autoMapFrom: '$ctx.tb.currentYear', group: 'Data' },
      { code: 'account_code', label: 'Account Code', type: 'text', required: false, source: 'auto', autoMapFrom: '$ctx.tb.accountCode', group: 'Data' },
    ],
    outputSchema: [
      { code: 'bank_total', label: 'Bank Statement Total', type: 'number' },
      { code: 'tb_balance', label: 'TB Balance', type: 'number' },
      { code: 'variance', label: 'Variance', type: 'number' },
      { code: 'data_table', label: 'Reconciliation Detail', type: 'data_table' },
      { code: 'pass_fail', label: 'Reconciled', type: 'pass_fail' },
    ],
  },

  {
    code: 'verify_evidence',
    name: 'Verify Evidence',
    description: 'AI-driven verification of supporting evidence against audit assertions. Checks for match, period, disclosure, and other concerns.',
    category: 'verification',
    handlerName: 'verifyEvidence',
    icon: 'CheckCircle',
    color: '#22c55e',
    isSystem: true,
    inputSchema: [
      { code: 'evidence_documents', label: 'Evidence Documents', type: 'file', required: true, source: 'auto', autoMapFrom: '$prev.documents', group: 'Evidence' },
      { code: 'sample_items', label: 'Sample Items to Verify', type: 'json_table', required: false, source: 'auto', autoMapFrom: '$prev.sample_items', group: 'Evidence' },
      { code: 'assertions', label: 'Assertions to Test', type: 'multiselect', required: false, source: 'user', group: 'Config', options: [
        { value: 'existence', label: 'Existence' },
        { value: 'completeness', label: 'Completeness' },
        { value: 'accuracy', label: 'Accuracy' },
        { value: 'valuation', label: 'Valuation' },
        { value: 'rights_obligations', label: 'Rights & Obligations' },
        { value: 'presentation', label: 'Presentation & Disclosure' },
        { value: 'cut_off', label: 'Cut-Off' },
      ]},
    ],
    outputSchema: [
      { code: 'data_table', label: 'Verification Results', type: 'data_table', description: 'Table with Match, Period, Disclosure, Other Concerns columns.' },
      { code: 'pass_fail', label: 'Overall Result', type: 'pass_fail' },
      { code: 'exceptions', label: 'Exceptions Found', type: 'data_table' },
      { code: 'exception_count', label: 'Exception Count', type: 'number' },
    ],
  },

  {
    code: 'verify_property_assets',
    name: 'Verify UK Property Assets',
    description: 'Independently verifies UK property assets held by the client by pulling title data directly from HM Land Registry Business Gateway. Asks the client for a list of property addresses via the portal (typed response or uploaded file), parses the list, lets the auditor select a sample, then for each sampled property runs the full HMLR pipeline: Enquiry by Property Description (title lookup), Owner Verification, Official Copy Title Known, Register Extract (register, plan, conveyance, deed, lease), Restrictions, and Application Enquiry. Documents are stored against the engagement, AI-summarised per property, and presented as expandable per-property rows with Preparer / Reviewer / RI sign-off.',
    category: 'verification',
    handlerName: 'verifyPropertyAssets',
    icon: 'Home',
    color: '#059669',
    isSystem: true,
    inputSchema: [
      { code: 'message_to_client', label: 'Message to Client', type: 'textarea', required: true, source: 'user', defaultValue: 'Please provide a list of UK properties owned by the entity. For each property include the full postal address and postcode. You can type the list into the chat or upload a document (PDF, Word, Excel, CSV, or an image).', group: 'Request' },
      { code: 'period_end', label: 'Period End', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Context' },
      { code: 'client_name', label: 'Client Name', type: 'text', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.clientName', group: 'Context' },
      // Data groups — which categories of Land Registry data to fetch. The
      // runtime UI lets the auditor tick these per run and only fetches the
      // delta on re-runs, keeping costs down. This config value just sets
      // the initial state of the checkboxes in the runtime UI.
      { code: 'default_data_groups', label: 'Default Data Groups', type: 'multiselect', required: false, source: 'user', group: 'Data', defaultValue: ['ownership'], description: 'Which HMLR data groups to pre-tick on the runtime selector. Auditors can change the selection per run.', options: [
        { value: 'ownership', label: 'Ownership data (title, proprietor, register extract, plan, application enquiry)' },
        { value: 'purchase', label: 'Purchase data (price paid history, conveyance, deed of transfer)' },
        { value: 'restrictions', label: 'Restrictions data (charges, notices, cautions, restrictions)' },
      ]},
      { code: 'restriction_api', label: 'Restrictions Lookup Method', type: 'select', required: false, source: 'user', defaultValue: 'register_summary', group: 'Advanced', description: 'Only relevant when the Restrictions data group is selected. HMLR restrictions are recorded within the Register Extract by default. Only use the dedicated search if you have a contractual reason to pay the extra fee.', options: [
        { value: 'register_summary', label: 'Parse from Register Extract (no extra cost)' },
        { value: 'dedicated_search', label: 'Call dedicated Restrictions Search API (extra fee)' },
      ]},
    ],
    outputSchema: [
      { code: 'properties', label: 'Tested Properties', type: 'data_table', description: 'Per-property rows: address, title number, registered proprietor, AI summary, document count, flags.' },
      { code: 'documents', label: 'Retrieved Documents', type: 'file_array' },
      { code: 'total_cost_gbp', label: 'Total Land Registry Spend (GBP)', type: 'number' },
      { code: 'exception_count', label: 'Exceptions', type: 'number' },
      { code: 'pass_fail', label: 'Overall Result', type: 'pass_fail' },
    ],
  },

  // ─── Year-End Accruals Actions ─────────────────────────────────────────────

  {
    code: 'request_accruals_listing',
    name: 'Request Year-End Accruals Listing',
    description: 'Requests the year-end accruals/creditors listing from the client via the portal. When returned, extracts the total and reconciles it to the sum of the TB accrual account codes as at period end. If reconciled, passes the listing forward as the sampling population; if not, raises an outstanding follow-up to the client.',
    category: 'evidence',
    handlerName: 'requestAccrualsListing',
    icon: 'FileSearch',
    color: '#0ea5e9',
    isSystem: true,
    inputSchema: [
      { code: 'message_to_client', label: 'Message to Client', type: 'textarea', required: true, source: 'user', group: 'Request Details', defaultValue: 'Please provide the accruals / accrued-expenses listing as at period end. For each line please include: supplier/payee, description, what the accrual relates to, the service/goods period covered (start and end dates), the amount, the nominal code, the journal reference, and any supporting reference (PO / contract / GRN / service evidence).' },
      { code: 'period_end', label: 'Period End', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Context' },
      { code: 'tolerance_gbp', label: 'Reconciliation Tolerance (GBP)', type: 'number', required: false, source: 'user', group: 'Reconciliation', defaultValue: 1, description: 'Listing total vs TB accrual-account sum is treated as reconciled if the absolute variance is within this amount. Larger variances pause the step and raise an outstanding item for the client.' },
      { code: 'accrual_account_codes', label: 'Accrual Account Codes (optional)', type: 'text', required: false, source: 'user', group: 'Reconciliation', description: 'Comma-separated TB account codes to sum for the reconciliation. If left blank, all TB rows marked is_accrual_account for the engagement are summed.' },
    ],
    outputSchema: [
      { code: 'data_table', label: 'Accruals Population', type: 'data_table', description: 'Parsed accruals listing rows (supplier, description, period, amount, nominal, refs) ready for sampling.' },
      { code: 'listing_total', label: 'Listing Total', type: 'number' },
      { code: 'tb_total', label: 'TB Accruals Total', type: 'number' },
      { code: 'variance', label: 'Variance', type: 'number' },
      { code: 'tb_reconciled', label: 'Reconciled', type: 'pass_fail' },
      { code: 'portal_request_id', label: 'Portal Request ID', type: 'text' },
    ],
  },

  {
    code: 'extract_accruals_evidence',
    name: 'Extract Accruals Supporting Evidence',
    description: 'Server-side extraction of supporting evidence documents (post-YE invoices, supplier statements, POs, GRNs, etc.) returned by the client. For each document, AI extracts supplier/payee, amount, description, invoice date, service period (start/end), and any references, keyed back to the originating sample item so downstream verification can match against the accrual.',
    category: 'evidence',
    handlerName: 'extractAccrualsEvidence',
    icon: 'FileText',
    color: '#0ea5e9',
    isSystem: true,
    inputSchema: [
      { code: 'source_documents', label: 'Source Documents', type: 'file', required: true, source: 'auto', autoMapFrom: '$prev.documents', group: 'Input', description: 'Documents returned by the client (individual files or batch / zip). Auto-detects format and splits.' },
      { code: 'sample_items', label: 'Sample Items', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$step.1.sample_items', group: 'Context', description: 'The sampled accruals each document should be matched against.' },
      { code: 'period_end', label: 'Period End', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Context' },
    ],
    outputSchema: [
      { code: 'extracted_evidence', label: 'Extracted Evidence', type: 'data_table', description: 'One row per document: supplier, amount, invoice_date, service_period_start/end, description, refs, matched_sample_ref.' },
      { code: 'data_table', label: 'Extracted Evidence (alias)', type: 'data_table' },
      { code: 'document_ids', label: 'Document IDs', type: 'json' },
      { code: 'extraction_issues', label: 'Extraction Issues', type: 'data_table', description: 'Documents that could not be parsed or could not be matched to a sample item.' },
    ],
  },

  {
    code: 'verify_accruals_sample',
    name: 'Verify Accruals Sample (R/O/G)',
    description: 'Core Year-End Accruals verification. For each sample item: (a) AI-matches extracted evidence to the accrual (supplier, amount, description, service period, refs); (b) classifies obligation as ≤ or > period end; (c) searches within X days post-YE for supporting invoices/payments; (d) detects continuous periods spanning YE; (e) time-apportions Orange items and re-tests the ≤-YE portion against the recorded accrual. Outputs one Red/Orange/Green marker per sample item (persisted to sample_item_markers), which the Findings section renders for review and Error/In-TB resolution.',
    category: 'verification',
    handlerName: 'verifyAccrualsSample',
    icon: 'CheckCircle',
    color: '#059669',
    isSystem: true,
    inputSchema: [
      { code: 'sample_items', label: 'Sample Items', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$step.1.sample_items', group: 'Data', description: 'Accruals sample (supplier, description, service period, amount, etc.).' },
      { code: 'extracted_evidence', label: 'Extracted Evidence', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$prev.extracted_evidence', group: 'Data', description: 'Parsed supporting documents (post-YE invoices, statements, etc.).' },
      { code: 'period_end', label: 'Period End', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Context' },
      { code: 'x_days_post_ye', label: 'Post-YE Evidence Window (days)', type: 'number', required: false, source: 'auto', autoMapFrom: '$ctx.execution.config.x_days_post_ye', group: 'Context', defaultValue: 60, description: 'How many days after period end to look at for supporting invoices/payments. Set by the pipeline kick-off modal.' },
      { code: 'amount_tolerance_gbp', label: 'Amount Tolerance (GBP)', type: 'number', required: false, source: 'user', group: 'Thresholds', defaultValue: 1, description: 'Absolute variance allowed between subsequent-invoice amount and recorded accrual before it is treated as a material mismatch.' },
      { code: 'document_type', label: 'Evidence Document Type', type: 'select', required: false, source: 'user', group: 'Evidence', defaultValue: 'post_ye_invoice', description: 'Primary type of evidence being verified. Drives the AI matching prompt.', options: [
        { value: 'accrual_calculation', label: 'Accrual calculation / schedule support' },
        { value: 'post_ye_invoice', label: 'Supplier invoice (post-year end)' },
        { value: 'supplier_statement', label: 'Supplier statement' },
        { value: 'purchase_order', label: 'Purchase order / contract' },
        { value: 'grn', label: 'GRN / delivery note' },
        { value: 'service_evidence', label: 'Service completion evidence (timesheets / milestones)' },
        { value: 'remittance_advice', label: 'Remittance advice' },
      ]},
    ],
    outputSchema: [
      { code: 'markers', label: 'R/O/G Markers', type: 'data_table', description: 'One row per sample item: colour, reason, marker_type, calc (matching refs, apportionment). Persisted to sample_item_markers.' },
      { code: 'data_table', label: 'Markers (alias)', type: 'data_table' },
      { code: 'red_count', label: 'Red Items', type: 'number' },
      { code: 'orange_count', label: 'Orange Items', type: 'number' },
      { code: 'green_count', label: 'Green Items', type: 'number' },
      { code: 'findings', label: 'Findings (Red Items)', type: 'data_table', description: 'Subset of markers where colour=red, formatted for the Findings & Conclusions section.' },
      { code: 'pass_fail', label: 'Overall Result', type: 'pass_fail' },
    ],
  },

  // ─── Unrecorded Liabilities Actions ────────────────────────────────────────

  {
    code: 'extract_post_ye_bank_payments',
    name: 'Extract Post-YE Bank Payments',
    description: 'Parses post-year-end bank statements / transaction exports returned by the client and extracts every payment (debit) dated between Period.End+1 and Period.End+X as the unrecorded-liabilities population. Each row includes date, payee, amount, reference/narrative, and bank account.',
    category: 'evidence',
    handlerName: 'extractPostYeBankPayments',
    icon: 'Landmark',
    color: '#7c3aed',
    isSystem: true,
    inputSchema: [
      { code: 'source_documents', label: 'Source Documents', type: 'file', required: true, source: 'auto', autoMapFrom: '$prev.documents', group: 'Input', description: 'Bank statements or transaction exports (PDF / XLSX / CSV).' },
      { code: 'period_end', label: 'Period End', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Window' },
      { code: 'x_days_post_ye', label: 'Post-YE Window (days)', type: 'number', required: false, source: 'auto', autoMapFrom: '$ctx.execution.config.x_days_post_ye', group: 'Window', defaultValue: 60, description: 'Capture payments up to and including Period.End+X.' },
    ],
    outputSchema: [
      { code: 'data_table', label: 'Post-YE Payments', type: 'data_table', description: 'Row per payment: date, payee, amount, reference, narrative, bank account.' },
      { code: 'population_size', label: 'Population Size', type: 'number' },
      { code: 'total_value', label: 'Total Value', type: 'number' },
      { code: 'extraction_issues', label: 'Extraction Issues', type: 'data_table' },
    ],
  },

  {
    code: 'select_unrecorded_liabilities_sample',
    name: 'Select Unrecorded Liabilities Sample',
    description: 'Three-layer sampling for the unrecorded-liabilities population: (1) auto-select all payments above performance materiality (or a user threshold); (2) AI-risk-rank the remainder and take the top-N most likely to represent prior-year obligations; (3) apply stratified / haphazard / MUS sampling on what is left. Any mode can be disabled per run.',
    category: 'sampling',
    handlerName: 'selectUnrecordedLiabilitiesSample',
    icon: 'Target',
    color: '#7c3aed',
    isSystem: true,
    inputSchema: [
      { code: 'population', label: 'Population', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$prev.data_table', group: 'Data' },
      { code: 'threshold_gbp', label: 'Above-Threshold Cut-off (GBP)', type: 'number', required: false, source: 'user', group: 'Thresholds', description: 'All payments at or above this value are automatically selected. If left blank, performance materiality from the engagement is used.' },
      { code: 'enable_above_threshold', label: 'Enable Above-Threshold Selection', type: 'boolean', required: false, source: 'user', group: 'Thresholds', defaultValue: true },
      { code: 'enable_ai_risk_rank', label: 'Enable AI Risk Ranking', type: 'boolean', required: false, source: 'user', group: 'Risk Ranking', defaultValue: true, description: 'AI scores each remaining payment on likelihood of being a prior-period obligation.' },
      { code: 'ai_top_n', label: 'AI Top-N to Select', type: 'number', required: false, source: 'user', group: 'Risk Ranking', defaultValue: 10 },
      { code: 'residual_method', label: 'Residual Sampling Method', type: 'select', required: false, source: 'user', group: 'Residual Sampling', defaultValue: 'none', options: [
        { value: 'none', label: 'None (skip residual sampling)' },
        { value: 'mus', label: 'MUS (monetary unit)' },
        { value: 'stratified', label: 'Stratified' },
        { value: 'haphazard', label: 'Haphazard' },
      ]},
      { code: 'residual_sample_size', label: 'Residual Sample Size', type: 'number', required: false, source: 'user', group: 'Residual Sampling', defaultValue: 10 },
    ],
    outputSchema: [
      { code: 'sample_items', label: 'Selected Sample', type: 'data_table', description: 'Payments selected across all three layers, tagged with select_reason.' },
      { code: 'data_table', label: 'Sample (alias)', type: 'data_table' },
      { code: 'sample_size', label: 'Sample Size', type: 'number' },
      { code: 'above_threshold_count', label: 'Above-Threshold Count', type: 'number' },
      { code: 'ai_selected_count', label: 'AI-Selected Count', type: 'number' },
      { code: 'residual_selected_count', label: 'Residual-Selected Count', type: 'number' },
      { code: 'risk_scores', label: 'AI Risk Scores', type: 'data_table', description: 'Full AI ranking of the residual population for transparency.' },
    ],
  },

  {
    code: 'verify_unrecorded_liabilities_sample',
    name: 'Verify Unrecorded Liabilities Sample (R/O/G)',
    description: 'Verifies each sampled post-YE payment. (a) Matches extracted evidence to the bank payment (payee, amount, reference, date). (b) Classifies obligation ≤ or > period end. If > YE the payment correctly relates to the post-YE period → Green. If ≤ YE, searches the creditors/accruals listing for a matching creditor — found → Green (In TB); missing → Red (Unrecorded Liability). (c) Detects continuous periods spanning YE → Orange (Spread), then time-apportions the ≤-YE portion and re-tests it against any recorded creditor.',
    category: 'verification',
    handlerName: 'verifyUnrecordedLiabilitiesSample',
    icon: 'CheckCircle',
    color: '#7c3aed',
    isSystem: true,
    inputSchema: [
      { code: 'sample_items', label: 'Sample Items', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$step.3.sample_items', group: 'Data', description: 'Sampled post-YE payments (payee, amount, date, reference).' },
      { code: 'extracted_evidence', label: 'Extracted Evidence', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$prev.extracted_evidence', group: 'Data' },
      { code: 'creditors_portal_request_id', label: 'Creditors Listing Portal Ref', type: 'text', required: false, source: 'auto', autoMapFrom: '$step.2.portal_request_id', group: 'Creditors', description: 'Parses the creditors & accruals listing the client returned in step 3 for per-supplier match lookup.' },
      { code: 'period_end', label: 'Period End', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Context' },
      { code: 'amount_tolerance_gbp', label: 'Amount Tolerance (GBP)', type: 'number', required: false, source: 'user', group: 'Thresholds', defaultValue: 1 },
    ],
    outputSchema: [
      { code: 'markers', label: 'R/O/G Markers', type: 'data_table' },
      { code: 'data_table', label: 'Markers (alias)', type: 'data_table' },
      { code: 'red_count', label: 'Red (Unrecorded Liability)', type: 'number' },
      { code: 'orange_count', label: 'Orange (Spread / Support Missing)', type: 'number' },
      { code: 'green_count', label: 'Green (OK / In TB / Post-YE)', type: 'number' },
      { code: 'findings', label: 'Findings (Red)', type: 'data_table' },
      { code: 'pass_fail', label: 'Overall Result', type: 'pass_fail' },
    ],
  },

  // ─── Analytical Review — Gross Margin % Actions ────────────────────────────

  {
    code: 'request_gm_data',
    name: 'Request GM Analytical Data',
    description: 'Requests the data needed for a gross-margin analytical review: revenue and cost of sales breakdowns for the current year and the selected comparison periods (prior year actual, multiple prior periods, budget/forecast), plus any explanations management has already prepared for material movements. Parses the returned listing, calculates GM % per period, and (where feasible) reconciles CY revenue + CY COS to the TB totals. Pauses with a follow-up outstanding item if the returned data is internally inconsistent.',
    category: 'evidence',
    handlerName: 'requestGmData',
    icon: 'FileSearch',
    color: '#14b8a6',
    isSystem: true,
    inputSchema: [
      { code: 'message_to_client', label: 'Message to Client', type: 'textarea', required: true, source: 'user', group: 'Request Details', defaultValue: 'For the gross-margin analytical review please provide: (1) revenue and cost of sales breakdowns by category for the current year and prior period(s); (2) the budget/forecast figures used by management for the current year; (3) any analysis or explanations already prepared for significant movements in gross margin. An Excel or CSV with one row per P&L category is ideal.' },
      { code: 'comparison_periods', label: 'Comparison Periods', type: 'multiselect', required: false, source: 'auto', autoMapFrom: '$ctx.execution.config.comparison_periods', group: 'Scope', options: [
        { value: 'prior_year', label: 'Prior year actual' },
        { value: 'multiple_py', label: 'Multiple prior periods (trend)' },
        { value: 'budget', label: 'Budget / forecast' },
        { value: 'industry_benchmark', label: 'Industry benchmark' },
      ]},
      { code: 'tolerance_pct', label: 'Tolerance (% point)', type: 'number', required: false, source: 'auto', autoMapFrom: '$ctx.execution.config.tolerance_pct', group: 'Thresholds', description: 'Investigate any GM% movement greater than this number of percentage points.' },
      { code: 'tolerance_pm_multiple', label: 'Tolerance (× PM)', type: 'number', required: false, source: 'auto', autoMapFrom: '$ctx.execution.config.tolerance_pm_multiple', group: 'Thresholds', description: 'Investigate variance whose £ impact exceeds this multiple of performance materiality.' },
      { code: 'period_end', label: 'Period End', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Context' },
    ],
    outputSchema: [
      { code: 'data_table', label: 'P&L Summary', type: 'data_table', description: 'Row per period: period_label, revenue, cost_of_sales, gross_profit, gm_pct, source (client | tb | benchmark).' },
      { code: 'management_commentary', label: 'Management Commentary', type: 'text', description: 'Any explanation text the client supplied alongside the figures.' },
      { code: 'tb_reconciled', label: 'CY Revenue / COS agrees to TB', type: 'pass_fail' },
      { code: 'portal_request_id', label: 'Portal Request ID', type: 'text' },
    ],
  },

  {
    code: 'compute_gm_analysis',
    name: 'Compute Gross Margin Analysis',
    description: 'Server-side computation of the gross-margin analytical review: GM% per period; absolute and percentage movements; variance vs budget; variance vs the expectation derived from the selected model (consistency_py / consistency_avg / budget / reasonableness); and auto-flagging of variances that breach either the percentage-point tolerance or the PM-linked tolerance. Flagged variances are emitted with an initial Amber status for the user to investigate.',
    category: 'analysis',
    handlerName: 'computeGmAnalysis',
    icon: 'Sparkles',
    color: '#14b8a6',
    isSystem: true,
    inputSchema: [
      { code: 'data_table', label: 'P&L Summary', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$prev.data_table', group: 'Data' },
      { code: 'expectation_model', label: 'Expectation Model', type: 'select', required: true, source: 'auto', autoMapFrom: '$ctx.execution.config.expectation_model', group: 'Expectation', options: [
        { value: 'consistency_py', label: 'Consistency with prior year %' },
        { value: 'consistency_avg', label: 'Consistency with average of prior periods' },
        { value: 'budget', label: 'Comparison to budgeted margin %' },
        { value: 'reasonableness', label: 'Reasonableness — PY margin applied to CY revenue + cost movements' },
      ]},
      { code: 'tolerance_pct', label: 'Tolerance (% point)', type: 'number', required: false, source: 'auto', autoMapFrom: '$ctx.execution.config.tolerance_pct', group: 'Thresholds', defaultValue: 2 },
      { code: 'tolerance_pm_multiple', label: 'Tolerance (× PM)', type: 'number', required: false, source: 'auto', autoMapFrom: '$ctx.execution.config.tolerance_pm_multiple', group: 'Thresholds', defaultValue: 1 },
      { code: 'period_end', label: 'Period End', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Context' },
    ],
    outputSchema: [
      { code: 'calculations', label: 'GM Calculations', type: 'data_table', description: 'Row per period with revenue, COS, GM, GM%.' },
      { code: 'variances', label: 'Variance Table', type: 'data_table', description: 'Row per comparison: comparison_label, expected_gm_pct, actual_gm_pct, variance_pct, variance_amount, flagged, flag_reason.' },
      { code: 'data_table', label: 'Variance Table (alias)', type: 'data_table' },
      { code: 'expected_gm_pct', label: 'Expected GM %', type: 'number' },
      { code: 'actual_gm_pct', label: 'Actual GM %', type: 'number' },
      { code: 'flagged_count', label: 'Flagged Count', type: 'number' },
      { code: 'performance_materiality', label: 'Performance Materiality Used', type: 'number' },
    ],
  },

  {
    code: 'request_gm_explanations',
    name: 'Request Management Explanations',
    description: 'For each flagged GM variance, asks the client via the portal for a business explanation (pricing, mix, volume, input costs, FX, one-off items) and any supporting evidence (management reports, pricing analyses, cost breakdowns). Responses are tracked on the Outstanding tab. When the auditor commits the reply, the explanation text and attachments are forwarded to the next step for AI plausibility assessment.',
    category: 'evidence',
    handlerName: 'requestGmExplanations',
    icon: 'FileSearch',
    color: '#14b8a6',
    isSystem: true,
    inputSchema: [
      { code: 'variances', label: 'Flagged Variances', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$prev.variances', group: 'Context' },
      { code: 'message_to_client', label: 'Message to Client', type: 'textarea', required: false, source: 'user', group: 'Request Details', defaultValue: 'Our gross-margin analytical review has flagged the following variances for investigation. For each, please provide a business explanation (pricing, mix, volume, input cost changes, FX, one-off items) and any supporting evidence (management reports, pricing analyses, cost breakdowns).' },
    ],
    outputSchema: [
      { code: 'portal_request_id', label: 'Portal Request ID', type: 'text' },
      { code: 'explanations', label: 'Received Explanations', type: 'data_table', description: 'Row per flagged variance: variance_ref, explanation_text, attachments.' },
    ],
  },

  {
    code: 'assess_gm_explanations',
    name: 'AI Plausibility Assessment (GM Variances)',
    description: 'AI-driven plausibility check for each flagged GM variance. Checks whether the explanation is consistent with known business activities, budgets, and prior patterns; whether the quantitative impacts described reconcile to the identified GM movement; and whether any contradictory evidence exists in the financial data already extracted. Produces a Red / Orange / Green marker per flagged variance (persisted to sample_item_markers so the generic override + Error/In-TB resolution flow works identically to the accruals pipeline).',
    category: 'verification',
    handlerName: 'assessGmExplanations',
    icon: 'CheckCircle',
    color: '#14b8a6',
    isSystem: true,
    inputSchema: [
      { code: 'variances', label: 'Flagged Variances', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$step.1.variances', group: 'Data' },
      { code: 'explanations', label: 'Management Explanations', type: 'json_table', required: true, source: 'auto', autoMapFrom: '$prev.explanations', group: 'Data' },
      { code: 'calculations', label: 'GM Calculations', type: 'json_table', required: false, source: 'auto', autoMapFrom: '$step.1.calculations', group: 'Context' },
      { code: 'analysis_type', label: 'Analysis Type', type: 'select', required: false, source: 'auto', autoMapFrom: '$ctx.execution.config.analysis_type', group: 'Context', description: 'Drives the wording of the final conclusion.', options: [
        { value: 'trend', label: 'Trend analysis' },
        { value: 'ratio', label: 'Ratio analysis (gross margin %)' },
        { value: 'reasonableness', label: 'Reasonableness test' },
        { value: 'combination', label: 'Combination' },
      ]},
    ],
    outputSchema: [
      { code: 'markers', label: 'R/O/G Markers', type: 'data_table' },
      { code: 'data_table', label: 'Markers (alias)', type: 'data_table' },
      { code: 'red_count', label: 'Red Count', type: 'number' },
      { code: 'orange_count', label: 'Orange Count', type: 'number' },
      { code: 'green_count', label: 'Green Count', type: 'number' },
      { code: 'findings', label: 'Findings (Red)', type: 'data_table' },
      { code: 'additional_procedures_prompt', label: 'Additional Procedures Prompt', type: 'text', description: 'Banner text warning that substantive test-of-details may be required.' },
      { code: 'pass_fail', label: 'Overall Result', type: 'pass_fail' },
    ],
  },

  // ─── Reporting Actions ─────────────────────────────────────────────────────

  {
    code: 'team_review',
    name: 'Team Review / Conclude',
    description: 'Assign a team review task. The reviewer evaluates outputs from previous steps and records their conclusion and sign-off.',
    category: 'reporting',
    handlerName: 'teamReview',
    icon: 'UserCheck',
    color: '#64748b',
    isSystem: true,
    inputSchema: [
      { code: 'instructions', label: 'Review Instructions', type: 'textarea', required: true, source: 'user', group: 'Review', description: 'Instructions for the reviewer on what to evaluate.' },
      { code: 'reviewer_role', label: 'Reviewer Role', type: 'select', required: false, source: 'user', group: 'Review', defaultValue: 'preparer', options: [
        { value: 'preparer', label: 'Preparer' },
        { value: 'reviewer', label: 'Reviewer (RI)' },
        { value: 'partner', label: 'Engagement Partner' },
      ]},
      { code: 'sign_off_required', label: 'Sign-Off Required', type: 'boolean', required: false, source: 'user', group: 'Review', defaultValue: true },
    ],
    outputSchema: [
      { code: 'conclusion', label: 'Conclusion', type: 'text' },
      { code: 'pass_fail', label: 'Review Result', type: 'pass_fail' },
      { code: 'review_notes', label: 'Review Notes', type: 'text' },
    ],
  },
];
