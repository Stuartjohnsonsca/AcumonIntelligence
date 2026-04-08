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
      { code: 'output_format', label: 'Format of Output', type: 'select', required: false, source: 'user', group: 'Request Details', defaultValue: 'individual', options: [
        { value: 'individual', label: 'Individual Files' },
        { value: 'zip', label: 'Zip Archive' },
      ]},
      { code: 'area_of_work', label: 'Area of Work', type: 'text', required: false, source: 'user', group: 'Request Details' },
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
    description: 'Extract transaction data from PDF/image bank statements using OCR. Processes FX conversion, period trimming, and stores extracted data.',
    category: 'evidence',
    handlerName: 'extractBankStatements',
    icon: 'Landmark',
    color: '#3b82f6',
    isSystem: true,
    inputSchema: [
      { code: 'source_files', label: 'Bank Statement Files', type: 'file', required: true, source: 'auto', autoMapFrom: '$prev.documents', group: 'Input', description: 'PDF or image files of bank statements.' },
      { code: 'currency', label: 'Currency', type: 'select', required: false, source: 'user', group: 'Processing', defaultValue: 'GBP', options: [
        { value: 'GBP', label: 'GBP' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' },
      ]},
      { code: 'period_start', label: 'Period Start', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodStart', group: 'Processing' },
      { code: 'period_end', label: 'Period End', type: 'date', required: false, source: 'auto', autoMapFrom: '$ctx.engagement.periodEnd', group: 'Processing' },
      { code: 'evidence_tag', label: 'Evidence Tag', type: 'text', required: false, source: 'user', group: 'Storage' },
    ],
    outputSchema: [
      { code: 'data_table', label: 'Extracted Transactions', type: 'data_table', description: 'All transactions extracted from the statements.' },
      { code: 'transaction_count', label: 'Transaction Count', type: 'number' },
      { code: 'statements', label: 'Statement Summaries', type: 'json' },
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
      { code: 'cut_off_days', label: 'Days Either Side', type: 'number', required: false, source: 'user', group: 'Config', defaultValue: 10, description: 'Number of days before and after period end to check.' },
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
