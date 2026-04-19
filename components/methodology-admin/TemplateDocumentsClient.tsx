'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Save, Loader2, Plus, X, Trash2, Copy, Eye, Code,
  FileText, Variable, Search, ToggleLeft, ToggleRight,
  List, ListOrdered, Table, Bold, Italic, MessageSquare, Hash,
  Layout, Link2,
} from 'lucide-react';
import { BackButton } from './BackButton';

// ─── Available merge fields from system data ─────────────────────
const MERGE_FIELD_CATEGORIES = [
  {
    category: 'Recipient',
    fields: [
      { key: 'recipient_name', label: 'Recipient Name', source: 'recipient', path: 'name' },
      { key: 'recipient_first_name', label: 'Recipient First Name', source: 'recipient', path: 'firstName' },
      { key: 'recipient_surname', label: 'Recipient Surname', source: 'recipient', path: 'surname' },
      { key: 'recipient_email', label: 'Recipient Email', source: 'recipient', path: 'email' },
      { key: 'recipient_role', label: 'Recipient Role', source: 'recipient', path: 'role' },
    ],
  },
  {
    category: 'Client',
    fields: [
      { key: 'client_name', label: 'Client Name', source: 'client', path: 'clientName' },
      { key: 'client_ref', label: 'Client Reference', source: 'client', path: 'clientRef' },
      { key: 'client_address', label: 'Client Address', source: 'client', path: 'address' },
      { key: 'client_reg_number', label: 'Registration Number', source: 'client', path: 'registrationNumber' },
      { key: 'client_industry', label: 'Industry', source: 'client', path: 'industry' },
      { key: 'client_contact_first_name', label: 'Contact First Name', source: 'client', path: 'contactFirstName' },
      { key: 'client_contact_surname', label: 'Contact Surname', source: 'client', path: 'contactSurname' },
      { key: 'client_contact_email', label: 'Contact Email', source: 'client', path: 'contactEmail' },
    ],
  },
  {
    category: 'Engagement',
    fields: [
      { key: 'engagement_type', label: 'Audit Type', source: 'engagement', path: 'auditType' },
      { key: 'period_end', label: 'Period End Date', source: 'engagement', path: 'periodEnd' },
      { key: 'target_completion', label: 'Target Completion', source: 'engagement', path: 'targetCompletion' },
      { key: 'compliance_deadline', label: 'Compliance Deadline', source: 'engagement', path: 'complianceDeadline' },
      { key: 'engagement_partner', label: 'Engagement Partner', source: 'engagement', path: 'partner' },
      { key: 'engagement_manager', label: 'Engagement Manager', source: 'engagement', path: 'manager' },
    ],
  },
  {
    category: 'Firm',
    fields: [
      { key: 'firm_name', label: 'Firm Name', source: 'firm', path: 'firmName' },
      { key: 'firm_address', label: 'Firm Address', source: 'firm', path: 'address' },
      { key: 'firm_registration', label: 'Firm Registration', source: 'firm', path: 'registration' },
      { key: 'firm_valuations_name', label: 'Valuations Name', source: 'firm', path: 'valuationsName' },
      { key: 'firm_valuations_email', label: 'Valuations Email', source: 'firm', path: 'valuationsEmail' },
      { key: 'firm_eqr_name', label: 'EQR Name', source: 'firm', path: 'eqrName' },
      { key: 'firm_eqr_email', label: 'EQR Email', source: 'firm', path: 'eqrEmail' },
      { key: 'firm_ethics_name', label: 'Ethics Name', source: 'firm', path: 'ethicsName' },
      { key: 'firm_ethics_email', label: 'Ethics Email', source: 'firm', path: 'ethicsEmail' },
      { key: 'firm_technical_name', label: 'Technical Name', source: 'firm', path: 'technicalName' },
      { key: 'firm_technical_email', label: 'Technical Email', source: 'firm', path: 'technicalEmail' },
    ],
  },
  {
    category: 'Dates',
    fields: [
      { key: 'current_date', label: 'Current Date', source: 'system', path: 'currentDate' },
      { key: 'current_year', label: 'Current Year', source: 'system', path: 'currentYear' },
      { key: 'prior_period_end', label: 'Prior Period End', source: 'engagement', path: 'priorPeriodEnd' },
    ],
  },
  {
    category: 'Team',
    fields: [
      { key: 'ri_name', label: 'RI Name', source: 'team', path: 'riName' },
      { key: 'reviewer_name', label: 'Reviewer Name', source: 'team', path: 'reviewerName' },
      { key: 'preparer_name', label: 'Preparer Name', source: 'team', path: 'preparerName' },
      { key: 'current_user', label: 'Current User', source: 'system', path: 'currentUser' },
    ],
  },
  {
    category: 'Links',
    fields: [
      { key: 'portal_link', label: 'Client Portal Link', source: 'portal', path: 'portalLink' },
      { key: 'custom_link', label: 'Custom Link', source: 'system', path: 'customLink' },
      { key: 'job_section_link', label: 'Job Section Link', source: 'engagement', path: 'jobSectionLink' },
    ],
  },
  {
    category: 'Planning — Materiality',
    fields: [
      { key: 'materiality_overall', label: 'Overall materiality', source: 'planning', path: 'materiality.overall' },
      { key: 'materiality_overall_prior', label: 'Overall materiality (prior year)', source: 'planning', path: 'materiality.overallPrior' },
      { key: 'materiality_method', label: 'Materiality method (e.g. "2% of Revenue")', source: 'planning', path: 'materiality.method' },
      { key: 'materiality_method_prior', label: 'Materiality method (prior year)', source: 'planning', path: 'materiality.methodPrior' },
      { key: 'materiality_performance', label: 'Performance materiality', source: 'planning', path: 'materiality.performance' },
      { key: 'materiality_performance_percent', label: 'Performance materiality %', source: 'planning', path: 'materiality.performancePercent' },
      { key: 'materiality_trivial', label: 'Clearly trivial / error reporting threshold', source: 'planning', path: 'materiality.trivial' },
      { key: 'materiality_benchmark_rationale', label: 'Benchmark rationale narrative', source: 'planning', path: 'materiality.rationale' },
    ],
  },
  {
    category: 'Planning — Other',
    fields: [
      { key: 'entity_activities_description', label: 'Principal activities description', source: 'planning', path: 'permFile.understandingEntity' },
      { key: 'engagement_letter_date', label: 'Engagement letter date', source: 'planning', path: 'continuance.engagementLetterDate' },
      { key: 'prior_auditor', label: 'Prior auditor firm name', source: 'planning', path: 'continuance.priorAuditor' },
      { key: 'prior_year_review_narrative', label: 'Prior year review narrative', source: 'planning', path: 'continuance.mgmtLetterNarrative' },
      { key: 'informed_management_names', label: 'Informed management names', source: 'planning', path: 'contacts.informedManagement' },
      { key: 'client_name_upper', label: 'Client name (UPPERCASE)', source: 'client', path: 'clientNameUpper' },
      { key: 'ri_email', label: 'RI email', source: 'team', path: 'riEmail' },
      { key: 'ri_role', label: 'RI role label', source: 'team', path: 'riRole' },
    ],
  },
  {
    category: 'Blocks (auto-generated tables)',
    fields: [
      { key: 'ethics_safeguards_table', label: 'Ethics — non-audit services safeguards table', source: 'block', path: 'ethics' },
      { key: 'significant_risks_table', label: 'Significant risks table (respects detail toggle)', source: 'block', path: 'significantRisks' },
      { key: 'areas_of_focus_table', label: 'Areas of focus table (respects detail toggle)', source: 'block', path: 'areasOfFocus' },
      { key: 'engagement_team_table', label: 'Engagement team table', source: 'block', path: 'team' },
      { key: 'timetable_table', label: 'Timetable table (from Agreed Dates)', source: 'block', path: 'timetable' },
    ],
  },
];

// Flat lookup for field key → label
const FIELD_LOOKUP: Record<string, { label: string; source: string; path: string }> = {};
for (const cat of MERGE_FIELD_CATEGORIES) {
  for (const f of cat.fields) {
    FIELD_LOOKUP[f.key] = { label: f.label, source: f.source, path: f.path };
  }
}

const DEFAULT_CATEGORIES = [
  // Specific workflow categories at the top — these gate the
  // email-template dropdowns in tab actions (e.g. RMM's Send Planning
  // Letter popup filters email templates by `audit_planning_letter`
  // so only planning-letter covering emails appear).
  { value: 'audit_planning_letter', label: 'Audit Planning Letter' },
  { value: 'engagement_letter',     label: 'Engagement Letter' },
  { value: 'management_letter',     label: 'Management Letter' },
  // Generic buckets.
  { value: 'general', label: 'General' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'reporting', label: 'Reporting' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'compliance', label: 'Compliance' },
];

const AUDIT_TYPES = [
  { value: 'ALL', label: 'All Types' },
  { value: 'SME', label: 'Statutory' },
  { value: 'PIE', label: 'PIE' },
  { value: 'SME_CONTROLS', label: 'Statutory Controls' },
  { value: 'PIE_CONTROLS', label: 'PIE Controls' },
];

const RECIPIENT_CATEGORIES = [
  { key: 'client', label: 'Client' },
  { key: 'technical_team', label: 'Technical Team' },
  { key: 'ethics_team', label: 'Ethics Team' },
  { key: 'eqr', label: 'EQR' },
  { key: 'ri', label: 'RI' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'preparer', label: 'Preparer' },
  { key: 'regulator', label: 'Regulator' },
];

const RESPONSE_OPTIONS = [
  { key: 'yes_no', label: 'Yes / No', options: ['Yes', 'No'] },
  { key: 'yes_no_na', label: 'Yes / No / N/A', options: ['Yes', 'No', 'N/A'] },
];

const JOB_SECTIONS = [
  { key: 'opening', label: 'Opening' },
  { key: 'prior-period', label: 'Prior Period' },
  { key: 'permanent-file', label: 'Permanent File' },
  { key: 'ethics', label: 'Ethics' },
  { key: 'continuance', label: 'Continuance' },
  { key: 'tb', label: 'Trial Balance CY v PY' },
  { key: 'materiality', label: 'Materiality' },
  { key: 'par', label: 'Preliminary Analytical Review' },
  { key: 'rmm', label: 'Identifying & Assessing RMM' },
  { key: 'documents', label: 'Documents' },
  { key: 'portal', label: 'Client Portal' },
];

interface MergeField {
  key: string;
  label: string;
  source: string;
  path: string;
}

interface DocumentTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  auditType: string;
  subject: string | null;
  content: string;
  mergeFields: MergeField[];
  recipients: string[];
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface CategoryOption {
  value: string;
  label: string;
}

interface Props {
  initialTemplates: DocumentTemplate[];
  initialCategories?: CategoryOption[];
}

// ─── Helpers: convert between stored HTML content and editor pill HTML ───
const PILL_CLASS = 'inline-flex items-center gap-0.5 px-2 py-0.5 mx-0.5 rounded-full text-[11px] font-medium bg-teal-100 text-teal-800 border border-teal-300 cursor-pointer select-none hover:bg-red-100 hover:text-red-700 hover:border-red-300 transition-colors';

/** Convert stored HTML (with {{key}} placeholders) into editor HTML (with pill spans) */
function contentToHtml(content: string): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const info = FIELD_LOOKUP[key];
    const label = info?.label || key;
    return `<span contenteditable="false" data-field="${key}" class="${PILL_CLASS}" title="Click to remove">${label}<span class="text-[9px] ml-0.5 opacity-60">\u00d7</span></span>`;
  });
}

/** Convert editor HTML (with pill spans) back to stored HTML (with {{key}} placeholders).
 *  Preserves all formatting — bold, italic, lists, tables, etc. */
function htmlToContent(el: HTMLElement): string {
  // Clone the DOM so we don't mutate the live editor
  const clone = el.cloneNode(true) as HTMLElement;
  // Replace all pill spans with their {{key}} placeholder text
  for (const pill of Array.from(clone.querySelectorAll('[data-field]'))) {
    const key = (pill as HTMLElement).dataset.field;
    pill.replaceWith(`{{${key}}}`);
  }
  // Return the HTML with pills replaced
  return clone.innerHTML;
}

function getUsedFields(content: string): MergeField[] {
  const fields: MergeField[] = [];
  const regex = /\{\{(\w+)\}\}/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const key = match[1];
    const info = FIELD_LOOKUP[key];
    if (info && !fields.find(f => f.key === key)) {
      fields.push({ key, label: info.label, source: info.source, path: info.path });
    }
  }
  return fields;
}

// ─── Sample data for preview ─────────────────────────────────────
const SAMPLE_DATA: Record<string, string> = {
  recipient_name: 'John Smith',
  recipient_first_name: 'John',
  recipient_surname: 'Smith',
  recipient_email: 'john.smith@acme.com',
  recipient_role: 'Finance Director',
  client_name: 'Acme Corporation Ltd',
  client_ref: 'ACM001',
  client_address: '123 Business Street, London EC1A 1BB',
  client_reg_number: '12345678',
  client_industry: 'Technology',
  client_contact_first_name: 'John',
  client_contact_surname: 'Smith',
  client_contact_email: 'john@acme.com',
  engagement_type: 'Statutory Audit',
  period_end: '31 March 2026',
  target_completion: '30 June 2026',
  compliance_deadline: '31 December 2026',
  engagement_partner: 'Stuart Thomson',
  engagement_manager: 'Edmund Cartwright',
  firm_name: 'Johnsons Chartered Accountants',
  firm_address: '456 Audit Lane, London SW1A 1AA',
  firm_registration: 'C123456',
  firm_valuations_name: 'Jane Appraiser',
  firm_valuations_email: 'valuations@johnsons.co.uk',
  firm_eqr_name: 'Robert Quality',
  firm_eqr_email: 'eqr@johnsons.co.uk',
  firm_ethics_name: 'Emma Ethics',
  firm_ethics_email: 'ethics@johnsons.co.uk',
  firm_technical_name: 'David Technical',
  firm_technical_email: 'technical@johnsons.co.uk',
  current_date: new Date().toLocaleDateString('en-GB'),
  current_year: new Date().getFullYear().toString(),
  prior_period_end: '31 March 2025',
  ri_name: 'Stuart Thomson',
  reviewer_name: 'Mandhu Chennupati',
  preparer_name: 'Sarah Williams',
  current_user: 'Stuart Thomson',
  portal_link: 'https://app.acumon.co.uk/portal?token=abc123&client=acme&engagement=fy2026',
  custom_link: 'https://example.com/custom-resource',
  job_section_link: 'https://app.acumon.co.uk/methodology/StatAudit?tab=ethics',
};

// ─── Component ───────────────────────────────────────────────────
export function TemplateDocumentsClient({ initialTemplates, initialCategories }: Props) {
  const [templates, setTemplates] = useState<DocumentTemplate[]>(initialTemplates);
  const [selected, setSelected] = useState<DocumentTemplate | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Admin-managed categories
  const [categories, setCategories] = useState<CategoryOption[]>(initialCategories || DEFAULT_CATEGORIES);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [savingCategories, setSavingCategories] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('general');
  const [editAuditType, setEditAuditType] = useState('ALL');
  const [editSubject, setEditSubject] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editMergeFields, setEditMergeFields] = useState<MergeField[]>([]);
  const [editRecipients, setEditRecipients] = useState<string[]>([]);
  const [editCustomLinkLabel, setEditCustomLinkLabel] = useState('');
  const [editCustomLinkUrl, setEditCustomLinkUrl] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');

  const editorRef = useRef<HTMLDivElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  // Track which editor area was last focused so palette inserts go to the right place
  const lastFocusRef = useRef<'body' | 'subject'>('body');
  // Track whether we should skip the next useEffect innerHTML reset
  const editorInitRef = useRef(0);

  // Table context menu (right-click)
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number; cell: HTMLTableCellElement } | null>(null);
  // Floating table toolbar (shows when cursor is in a table)
  const [activeTableCell, setActiveTableCell] = useState<HTMLTableCellElement | null>(null);
  const tableToolbarRef = useRef<HTMLDivElement>(null);

  // Close table menu on outside click
  useEffect(() => {
    if (!tableMenu) return;
    const handler = () => setTableMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [tableMenu]);

  // Track cursor position in editor to show/hide table toolbar
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !isEditing) return;
    function handleSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) { setActiveTableCell(null); return; }
      const node = sel.anchorNode;
      if (!node || !editor!.contains(node)) { setActiveTableCell(null); return; }
      const cell = (node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement)?.closest('td, th') as HTMLTableCellElement | null;
      setActiveTableCell(cell && editor!.contains(cell) ? cell : null);
    }
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [isEditing]);

  const filteredTemplates = templates.filter((t) => {
    if (filterCategory !== 'all' && t.category !== filterCategory) return false;
    if (searchQuery && !t.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  // Only set editor innerHTML when entering edit mode (not on every keystroke)
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = contentToHtml(editContent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInitRef.current]);

  /** Read the current DOM content back into raw {{key}} format */
  function readEditorContent(): string {
    if (!editorRef.current) return editContent;
    return htmlToContent(editorRef.current);
  }

  /** Sync merge-field pill badges — debounced to avoid cursor reset from React re-render */
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function syncMergeFieldsFromEditor() {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      const raw = readEditorContent();
      setEditMergeFields(getUsedFields(raw));
    }, 300);
  }

  function handleEditorClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const pill = target.closest('[data-field]') as HTMLElement | null;
    if (pill && editorRef.current?.contains(pill)) {
      pill.remove();
      syncMergeFieldsFromEditor();
    }
  }

  /** Tab key navigates between table cells */
  function handleEditorKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const node = sel.anchorNode;
    const cell = (node?.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node?.parentElement)?.closest('td, th') as HTMLTableCellElement | null;
    if (!cell || !editorRef.current?.contains(cell)) return;

    e.preventDefault();
    const row = cell.closest('tr');
    const table = cell.closest('table');
    if (!row || !table) return;

    let nextCell: HTMLTableCellElement | null = null;
    if (e.shiftKey) {
      // Move to previous cell
      if (cell.cellIndex > 0) {
        nextCell = row.cells[cell.cellIndex - 1];
      } else {
        const prevRow = row.previousElementSibling as HTMLTableRowElement | null;
        if (prevRow) nextCell = prevRow.cells[prevRow.cells.length - 1];
      }
    } else {
      // Move to next cell, add row if at end
      if (cell.cellIndex < row.cells.length - 1) {
        nextCell = row.cells[cell.cellIndex + 1];
      } else {
        const nextRow = row.nextElementSibling as HTMLTableRowElement | null;
        if (nextRow) {
          nextCell = nextRow.cells[0];
        } else {
          // Add a new row at the end
          const colCount = row.cells.length;
          const newRow = table.ownerDocument.createElement('tr');
          for (let i = 0; i < colCount; i++) {
            const td = table.ownerDocument.createElement('td');
            td.setAttribute('style', cellStyle);
            td.innerHTML = '&nbsp;';
            newRow.appendChild(td);
          }
          (table.querySelector('tbody') || table).appendChild(newRow);
          nextCell = newRow.cells[0];
        }
      }
    }
    if (nextCell) {
      const range = document.createRange();
      range.selectNodeContents(nextCell);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function startCreate() {
    setIsCreating(true);
    setIsEditing(true);
    setSelected(null);
    setEditName('');
    setEditDescription('');
    setEditCategory('general');
    setEditAuditType('ALL');
    setEditSubject('');
    setEditContent('');
    setEditMergeFields([]);
    setEditRecipients([]);
    setEditCustomLinkLabel('');
    setEditCustomLinkUrl('');
    setShowPreview(false);
    editorInitRef.current++;
  }

  function startEdit(template: DocumentTemplate) {
    setSelected(template);
    setIsEditing(true);
    setIsCreating(false);
    setEditName(template.name);
    setEditDescription(template.description || '');
    setEditCategory(template.category);
    setEditAuditType(template.auditType);
    setEditSubject(template.subject || '');
    setEditContent(template.content);
    setEditMergeFields(template.mergeFields || []);
    setEditRecipients(template.recipients || []);
    const meta = (template as any).customLinkConfig;
    setEditCustomLinkLabel(meta?.label || '');
    setEditCustomLinkUrl(meta?.url || '');
    setShowPreview(false);
    editorInitRef.current++;
  }

  function toggleRecipient(key: string) {
    setEditRecipients(prev =>
      prev.includes(key) ? prev.filter(r => r !== key) : [...prev, key]
    );
  }

  function execFormat(command: string, value?: string) {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    syncMergeFieldsFromEditor();
  }

  function insertTable() {
    const editor = editorRef.current;
    if (!editor) return;
    const html = '<table style="border-collapse:collapse;width:100%;margin:8px 0"><tbody>' +
      '<tr><td style="border:1px solid #cbd5e1;padding:4px 8px;min-width:80px">&nbsp;</td><td style="border:1px solid #cbd5e1;padding:4px 8px;min-width:80px">&nbsp;</td><td style="border:1px solid #cbd5e1;padding:4px 8px;min-width:80px">&nbsp;</td></tr>' +
      '<tr><td style="border:1px solid #cbd5e1;padding:4px 8px">&nbsp;</td><td style="border:1px solid #cbd5e1;padding:4px 8px">&nbsp;</td><td style="border:1px solid #cbd5e1;padding:4px 8px">&nbsp;</td></tr>' +
      '</tbody></table><p>&nbsp;</p>';
    document.execCommand('insertHTML', false, html);
    editor.focus();
  }

  function handleEditorContextMenu(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const cell = target.closest('td, th') as HTMLTableCellElement | null;
    if (cell && editorRef.current?.contains(cell)) {
      e.preventDefault();
      setTableMenu({ x: e.clientX, y: e.clientY, cell });
    }
  }

  const cellStyle = 'border:1px solid #cbd5e1;padding:4px 8px;min-width:80px';

  function tableAddRowBelow() {
    if (!tableMenu) return;
    const row = tableMenu.cell.closest('tr');
    if (!row) return;
    const colCount = row.cells.length;
    const newRow = row.ownerDocument.createElement('tr');
    for (let i = 0; i < colCount; i++) {
      const td = row.ownerDocument.createElement('td');
      td.setAttribute('style', cellStyle);
      td.innerHTML = '&nbsp;';
      newRow.appendChild(td);
    }
    row.after(newRow);
    setTableMenu(null);
  }

  function tableAddRowAbove() {
    if (!tableMenu) return;
    const row = tableMenu.cell.closest('tr');
    if (!row) return;
    const colCount = row.cells.length;
    const newRow = row.ownerDocument.createElement('tr');
    for (let i = 0; i < colCount; i++) {
      const td = row.ownerDocument.createElement('td');
      td.setAttribute('style', cellStyle);
      td.innerHTML = '&nbsp;';
      newRow.appendChild(td);
    }
    row.before(newRow);
    setTableMenu(null);
  }

  function tableAddColRight() {
    if (!tableMenu) return;
    const table = tableMenu.cell.closest('table');
    if (!table) return;
    const colIdx = tableMenu.cell.cellIndex;
    for (const row of Array.from(table.rows)) {
      const td = table.ownerDocument.createElement('td');
      td.setAttribute('style', cellStyle);
      td.innerHTML = '&nbsp;';
      if (colIdx + 1 < row.cells.length) {
        row.cells[colIdx + 1].before(td);
      } else {
        row.appendChild(td);
      }
    }
    setTableMenu(null);
  }

  function tableAddColLeft() {
    if (!tableMenu) return;
    const table = tableMenu.cell.closest('table');
    if (!table) return;
    const colIdx = tableMenu.cell.cellIndex;
    for (const row of Array.from(table.rows)) {
      const td = table.ownerDocument.createElement('td');
      td.setAttribute('style', cellStyle);
      td.innerHTML = '&nbsp;';
      row.cells[colIdx].before(td);
    }
    setTableMenu(null);
  }

  function tableDeleteRow() {
    if (!tableMenu) return;
    const row = tableMenu.cell.closest('tr');
    const table = tableMenu.cell.closest('table');
    if (!row || !table) return;
    if (table.rows.length <= 1) {
      table.remove(); // Remove entire table if last row
    } else {
      row.remove();
    }
    setTableMenu(null);
  }

  function tableDeleteCol() {
    if (!tableMenu) return;
    const table = tableMenu.cell.closest('table');
    if (!table) return;
    const colIdx = tableMenu.cell.cellIndex;
    if (table.rows[0].cells.length <= 1) {
      table.remove(); // Remove entire table if last column
    } else {
      for (const row of Array.from(table.rows)) {
        if (row.cells[colIdx]) row.cells[colIdx].remove();
      }
    }
    setTableMenu(null);
  }

  // ─── Direct cell-based table operations (for floating toolbar) ───
  function tableAddRowAboveFor(cell: HTMLTableCellElement) {
    const row = cell.closest('tr');
    if (!row) return;
    const newRow = row.ownerDocument.createElement('tr');
    for (let i = 0; i < row.cells.length; i++) {
      const td = row.ownerDocument.createElement('td');
      td.setAttribute('style', cellStyle);
      td.innerHTML = '&nbsp;';
      newRow.appendChild(td);
    }
    row.before(newRow);
  }

  function tableAddRowBelowFor(cell: HTMLTableCellElement) {
    const row = cell.closest('tr');
    if (!row) return;
    const newRow = row.ownerDocument.createElement('tr');
    for (let i = 0; i < row.cells.length; i++) {
      const td = row.ownerDocument.createElement('td');
      td.setAttribute('style', cellStyle);
      td.innerHTML = '&nbsp;';
      newRow.appendChild(td);
    }
    row.after(newRow);
  }

  function tableAddColLeftFor(cell: HTMLTableCellElement) {
    const table = cell.closest('table');
    if (!table) return;
    const colIdx = cell.cellIndex;
    for (const row of Array.from(table.rows)) {
      const td = table.ownerDocument.createElement('td');
      td.setAttribute('style', cellStyle);
      td.innerHTML = '&nbsp;';
      row.cells[colIdx].before(td);
    }
  }

  function tableAddColRightFor(cell: HTMLTableCellElement) {
    const table = cell.closest('table');
    if (!table) return;
    const colIdx = cell.cellIndex;
    for (const row of Array.from(table.rows)) {
      const td = table.ownerDocument.createElement('td');
      td.setAttribute('style', cellStyle);
      td.innerHTML = '&nbsp;';
      if (colIdx + 1 < row.cells.length) {
        row.cells[colIdx + 1].before(td);
      } else {
        row.appendChild(td);
      }
    }
  }

  function tableDeleteRowFor(cell: HTMLTableCellElement) {
    const row = cell.closest('tr');
    const table = cell.closest('table');
    if (!row || !table) return;
    if (table.rows.length <= 1) { table.remove(); } else { row.remove(); }
    setActiveTableCell(null);
  }

  function tableDeleteColFor(cell: HTMLTableCellElement) {
    const table = cell.closest('table');
    if (!table) return;
    const colIdx = cell.cellIndex;
    if (table.rows[0].cells.length <= 1) { table.remove(); } else {
      for (const row of Array.from(table.rows)) {
        if (row.cells[colIdx]) row.cells[colIdx].remove();
      }
    }
    setActiveTableCell(null);
  }

  /** Renumber all <ol> elements inside a table so numbering flows across rows in the same column */
  function renumberTableLists(table?: HTMLTableElement | null) {
    const editor = editorRef.current;
    if (!editor) return;
    const tables = table ? [table] : Array.from(editor.querySelectorAll('table'));
    for (const tbl of tables) {
      const rows = Array.from(tbl.rows);
      if (rows.length === 0) continue;
      const colCount = rows[0].cells.length;
      // For each column, find all <ol> elements across rows and set sequential start values
      for (let col = 0; col < colCount; col++) {
        let counter = 1;
        for (const row of rows) {
          const cell = row.cells[col];
          if (!cell) continue;
          const lists = cell.querySelectorAll('ol');
          for (const ol of Array.from(lists)) {
            ol.setAttribute('start', String(counter));
            counter += ol.querySelectorAll('li').length;
          }
        }
      }
    }
    setTableMenu(null);
  }

  /** Insert plain text into the subject input at the cursor position */
  function insertIntoSubject(text: string) {
    const input = subjectRef.current;
    if (!input) return;
    const start = input.selectionStart ?? editSubject.length;
    const end = input.selectionEnd ?? start;
    const newVal = editSubject.slice(0, start) + text + editSubject.slice(end);
    setEditSubject(newVal);
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + text.length, start + text.length);
    }, 0);
  }

  function insertJobSectionLink(section: typeof JOB_SECTIONS[number]) {
    if (lastFocusRef.current === 'subject') {
      insertIntoSubject(`[${section.label}]`);
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const html = `<a contenteditable="false" data-job-section="${section.key}" href="#" class="inline-flex items-center px-2 py-0.5 mx-0.5 rounded text-[11px] font-medium bg-indigo-100 text-indigo-800 border border-indigo-300 no-underline select-none">${section.label}</a>`;
    document.execCommand('insertHTML', false, html);
    editor.focus();
  }

  function insertResponseOption(opt: typeof RESPONSE_OPTIONS[number]) {
    if (lastFocusRef.current === 'subject') {
      insertIntoSubject(`[${opt.options.join('/')}]`);
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const buttons = opt.options.map(o =>
      `<span contenteditable="false" data-response="${opt.key}" class="inline-flex items-center px-3 py-1 mx-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-300 select-none">${o}</span>`
    ).join(' ');
    const html = `<div class="my-1">${buttons}</div>`;
    document.execCommand('insertHTML', false, html);
    editor.focus();
    syncMergeFieldsFromEditor();
  }

  function cancelEdit() {
    setIsEditing(false);
    setIsCreating(false);
  }

  const insertMergeField = useCallback((key: string, label: string, source: string, path: string) => {
    // If subject was last focused, insert as {{key}} text
    if (lastFocusRef.current === 'subject') {
      insertIntoSubject(`{{${key}}}`);
      return;
    }

    // Otherwise insert pill into body editor
    const editor = editorRef.current;
    if (!editor) return;

    // Build pill element
    const pill = document.createElement('span');
    pill.contentEditable = 'false';
    pill.dataset.field = key;
    pill.className = 'inline-flex items-center gap-0.5 px-2 py-0.5 mx-0.5 rounded-full text-[11px] font-medium bg-teal-100 text-teal-800 border border-teal-300 cursor-pointer select-none hover:bg-red-100 hover:text-red-700 hover:border-red-300 transition-colors';
    pill.title = 'Click to remove';
    pill.innerHTML = `${label}<span class="text-[9px] ml-0.5 opacity-60">\u00d7</span>`;

    // Insert at current cursor or append
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(pill);
      // Move cursor after pill
      range.setStartAfter(pill);
      range.setEndAfter(pill);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.appendChild(pill);
    }

    syncMergeFieldsFromEditor();
    editor.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (!editName.trim()) return;
    // Sync from editor one final time
    if (editorRef.current) {
      const raw = htmlToContent(editorRef.current);
      const fields = getUsedFields(raw);

      setSaving(true);
      try {
        const payload = {
          name: editName,
          description: editDescription,
          category: editCategory,
          auditType: editAuditType,
          subject: editSubject || null,
          content: raw,
          mergeFields: fields,
          recipients: editRecipients,
          customLinkConfig: (editCustomLinkLabel || editCustomLinkUrl) ? { label: editCustomLinkLabel, url: editCustomLinkUrl } : null,
        };

        if (isCreating) {
          const res = await fetch('/api/methodology-admin/template-documents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            const newTemplate = await res.json();
            setTemplates([...templates, newTemplate]);
            setSelected(newTemplate);
            setIsCreating(false);
            setIsEditing(false);
          }
        } else if (selected) {
          const res = await fetch(`/api/methodology-admin/template-documents/${selected.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            const updated = await res.json();
            setTemplates(templates.map((t) => (t.id === updated.id ? updated : t)));
            setSelected(updated);
            setIsEditing(false);
          }
        }
      } finally {
        setSaving(false);
      }
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    const res = await fetch(`/api/methodology-admin/template-documents/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setTemplates(templates.filter((t) => t.id !== id));
      if (selected?.id === id) {
        setSelected(null);
        setIsEditing(false);
      }
    }
  }

  async function handleDuplicate(template: DocumentTemplate) {
    const res = await fetch('/api/methodology-admin/template-documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${template.name} (Copy)`,
        description: template.description,
        category: template.category,
        auditType: template.auditType,
        content: template.content,
        mergeFields: template.mergeFields,
      }),
    });
    if (res.ok) {
      const newTemplate = await res.json();
      setTemplates([...templates, newTemplate]);
    }
  }

  async function handleToggleActive(template: DocumentTemplate) {
    const res = await fetch(`/api/methodology-admin/template-documents/${template.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !template.isActive }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTemplates(templates.map((t) => (t.id === updated.id ? updated : t)));
      if (selected?.id === updated.id) setSelected(updated);
    }
  }

  // ─── Category management ─────────────────────────────────────
  async function handleAddCategory() {
    if (!newCategoryLabel.trim()) return;
    const value = newCategoryLabel.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (categories.find(c => c.value === value)) return;
    const updated = [...categories, { value, label: newCategoryLabel.trim() }];
    setSavingCategories(true);
    try {
      const res = await fetch('/api/methodology-admin/template-categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: updated }),
      });
      if (res.ok) {
        setCategories(updated);
        setNewCategoryLabel('');
      }
    } finally {
      setSavingCategories(false);
    }
  }

  async function handleRemoveCategory(value: string) {
    const inUse = templates.some(t => t.category === value);
    if (inUse) {
      alert('Cannot remove a category that is in use by existing templates.');
      return;
    }
    const updated = categories.filter(c => c.value !== value);
    setSavingCategories(true);
    try {
      const res = await fetch('/api/methodology-admin/template-categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: updated }),
      });
      if (res.ok) {
        setCategories(updated);
      }
    } finally {
      setSavingCategories(false);
    }
  }

  // Preview: replace merge fields with sample data
  function getPreviewContent() {
    let preview = readEditorContent();
    for (const [key, value] of Object.entries(SAMPLE_DATA)) {
      preview = preview.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), `<span class="bg-teal-100 text-teal-800 px-1 rounded font-medium">${value}</span>`);
    }
    // Highlight any unmatched fields
    preview = preview.replace(/\{\{(\w+)\}\}/g, '<span class="bg-red-100 text-red-700 px-1 rounded">{{$1}}</span>');
    return preview;
  }

  // View-mode: show pills for fields in read-only view
  function getViewHtml(content: string) {
    return content.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      const info = FIELD_LOOKUP[key];
      const label = info?.label || key;
      return `<span class="inline-flex items-center px-2 py-0.5 mx-0.5 rounded-full text-[11px] font-medium bg-teal-50 text-teal-700 border border-teal-200">${label}</span>`;
    });
  }

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto">
      <BackButton href="/methodology-admin/template-documents" label="Back to Templates" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Email Templates</h1>
          <p className="text-sm text-slate-500 mt-1">
            Create email templates with merge fields populated from system data
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={async () => {
              try {
                const res = await fetch('/api/methodology-admin/template-documents/seed-defaults', { method: 'POST' });
                if (res.ok) {
                  const data = await res.json();
                  const created = (data.results || []).filter((r: any) => r.created).map((r: any) => r.name);
                  if (created.length) {
                    alert(`Loaded standard templates: ${created.join(', ')}. Reload the page to see them.`);
                    window.location.reload();
                  } else {
                    alert('Standard templates already exist — nothing to do.');
                  }
                } else {
                  alert('Failed to seed standard templates.');
                }
              } catch (err: any) {
                alert(`Error: ${err.message}`);
              }
            }}
            size="sm"
            variant="outline"
            title="Load the standard Planning Letter (and future default templates) for this firm"
          >
            Load standard templates
          </Button>
          <Button onClick={() => setShowCategoryManager(!showCategoryManager)} size="sm" variant="outline">
            {showCategoryManager ? 'Hide Categories' : 'Manage Categories'}
          </Button>
          <Button onClick={startCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> New Template
          </Button>
        </div>
      </div>

      {/* Category Manager */}
      {showCategoryManager && (
        <div className="mb-6 bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Template Categories</h3>
          <p className="text-xs text-slate-500 mb-3">Add or remove categories available for email templates.</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {categories.map((c) => {
              const inUse = templates.some(t => t.category === c.value);
              return (
                <span key={c.value} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  {c.label}
                  <button
                    onClick={() => handleRemoveCategory(c.value)}
                    disabled={savingCategories}
                    className={`ml-0.5 ${inUse ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-red-500 cursor-pointer'}`}
                    title={inUse ? 'In use — cannot remove' : 'Remove category'}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newCategoryLabel}
              onChange={(e) => setNewCategoryLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
              placeholder="New category name..."
              className="px-2 py-1.5 text-sm border rounded-md w-48"
            />
            <Button onClick={handleAddCategory} size="sm" disabled={savingCategories || !newCategoryLabel.trim()}>
              {savingCategories ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Add
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-6">
        {/* Left sidebar: template list */}
        <div className="w-72 flex-shrink-0">
          <div className="mb-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 text-sm border rounded-md"
              />
            </div>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border rounded-md"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="border rounded-lg divide-y max-h-[600px] overflow-y-auto">
            {filteredTemplates.length === 0 && (
              <div className="p-4 text-center text-sm text-slate-400">
                {templates.length === 0 ? 'No templates yet' : 'No matching templates'}
              </div>
            )}
            {filteredTemplates.map((t) => (
              <div
                key={t.id}
                onClick={() => { setSelected(t); setIsEditing(false); setIsCreating(false); }}
                className={`p-3 cursor-pointer hover:bg-slate-50 transition-colors group ${
                  selected?.id === t.id ? 'bg-teal-50 border-l-2 border-l-teal-500' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-800 truncate">{t.name}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); handleDuplicate(t); }} title="Duplicate" className="p-0.5 hover:bg-slate-200 rounded">
                      <Copy className="h-3 w-3 text-slate-500" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleToggleActive(t); }} title={t.isActive ? 'Deactivate' : 'Activate'} className="p-0.5 hover:bg-slate-200 rounded">
                      {t.isActive ? <ToggleRight className="h-3 w-3 text-green-600" /> : <ToggleLeft className="h-3 w-3 text-slate-400" />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }} title="Delete" className="p-0.5 hover:bg-red-100 rounded">
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{t.category}</span>
                  {t.auditType !== 'ALL' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{t.auditType}</span>
                  )}
                  {!t.isActive && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">Inactive</span>
                  )}
                  <span className="text-[10px] text-slate-400 ml-auto">v{t.version}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: editor / viewer */}
        <div className="flex-1 min-w-0">
          {!isEditing && !selected && (
            <div className="border rounded-lg p-12 text-center text-slate-400">
              <FileText className="h-12 w-12 mx-auto mb-3 text-slate-300" />
              <p className="text-sm">Select a template from the list or create a new one</p>
            </div>
          )}

          {!isEditing && selected && (
            <div className="border rounded-lg">
              <div className="flex items-center justify-between p-4 border-b bg-slate-50 rounded-t-lg">
                <div>
                  <h2 className="font-semibold text-slate-900">{selected.name}</h2>
                  {selected.description && <p className="text-xs text-slate-500 mt-0.5">{selected.description}</p>}
                </div>
                <Button onClick={() => startEdit(selected)} size="sm" variant="outline">
                  Edit Template
                </Button>
              </div>
              <div className="p-4">
                <div className="flex gap-2 mb-3">
                  <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600">
                    {categories.find((c) => c.value === selected.category)?.label || selected.category}
                  </span>
                  <span className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600">{selected.auditType}</span>
                  <span className="text-xs px-2 py-1 rounded bg-teal-50 text-teal-600">
                    {selected.mergeFields?.length || 0} merge fields
                  </span>
                </div>
                {selected.subject && (
                  <div className="mb-3 p-2 bg-slate-50 rounded-md">
                    <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Subject</span>
                    <p className="text-sm text-slate-800 mt-0.5" dangerouslySetInnerHTML={{ __html: getViewHtml(selected.subject) }} />
                  </div>
                )}
                {selected.recipients && selected.recipients.length > 0 && (
                  <div className="mb-3">
                    <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Recipients</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selected.recipients.map((r: string) => {
                        const rc = RECIPIENT_CATEGORIES.find(c => c.key === r);
                        return (
                          <span key={r} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                            {rc?.label || r}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div
                  className="prose prose-sm max-w-none border rounded-md p-4 bg-white min-h-[300px] [&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:p-1 [&_th]:border [&_th]:border-slate-300 [&_th]:p-1 [&_th]:bg-slate-50"
                  dangerouslySetInnerHTML={{ __html: getViewHtml(selected.content) }}
                />
              </div>
            </div>
          )}

          {isEditing && (
            <div className="border rounded-lg">
              <div className="flex items-center justify-between p-4 border-b bg-slate-50 rounded-t-lg">
                <h2 className="font-semibold text-slate-900">
                  {isCreating ? 'New Template' : `Edit: ${editName}`}
                </h2>
                <div className="flex items-center gap-2">
                  <Button onClick={() => setShowPreview(!showPreview)} size="sm" variant="outline">
                    {showPreview ? <Code className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                    {showPreview ? 'Editor' : 'Preview'}
                  </Button>
                  <Button onClick={cancelEdit} size="sm" variant="outline">Cancel</Button>
                  <Button onClick={handleSave} size="sm" disabled={saving || !editName.trim()}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                    Save
                  </Button>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Metadata fields */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Template Name *</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g. Engagement Letter"
                      className="w-full px-2 py-1.5 text-sm border rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Brief description"
                      className="w-full px-2 py-1.5 text-sm border rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border rounded-md"
                    >
                      {categories.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Audit Type</label>
                    <select
                      value={editAuditType}
                      onChange={(e) => setEditAuditType(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border rounded-md"
                    >
                      {AUDIT_TYPES.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Subject line */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Subject Line
                    <span className="text-slate-400 font-normal ml-1">Click here then use the palette to insert merge fields</span>
                  </label>
                  <input
                    ref={subjectRef}
                    type="text"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    onFocus={() => { lastFocusRef.current = 'subject'; }}
                    placeholder="e.g. Audit of {{client_name}} — {{period_end}}"
                    className="w-full px-2 py-1.5 text-sm border rounded-md"
                  />
                </div>

                {/* Recipient categories */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Allowed Recipients
                    <span className="text-slate-400 font-normal ml-1">Template can only be sent to selected recipient types</span>
                  </label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {RECIPIENT_CATEGORIES.map((rc) => {
                      const checked = editRecipients.includes(rc.key);
                      return (
                        <label
                          key={rc.key}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border cursor-pointer transition-colors select-none ${
                            checked
                              ? 'bg-blue-50 text-blue-700 border-blue-300'
                              : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRecipient(rc.key)}
                            className="sr-only"
                          />
                          <span className={`w-3 h-3 rounded flex items-center justify-center text-[8px] ${
                            checked ? 'bg-blue-500 text-white' : 'bg-slate-200 text-transparent'
                          }`}>
                            {checked ? '✓' : ''}
                          </span>
                          {rc.label}
                        </label>
                      );
                    })}
                  </div>
                  {editRecipients.length === 0 && (
                    <p className="text-[10px] text-amber-600 mt-1">No recipients selected — template cannot be sent until at least one is chosen.</p>
                  )}
                </div>

                {/* Editor + Merge fields sidebar */}
                <div className="flex gap-4">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Template Content
                      <span className="text-slate-400 font-normal ml-1">
                        Click fields from the palette to insert &middot; Click a pill to remove it
                      </span>
                    </label>
                    {showPreview ? (
                      <div
                        className="border rounded-md p-4 bg-white min-h-[400px] prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:p-1 [&_th]:border [&_th]:border-slate-300 [&_th]:p-1 [&_th]:bg-slate-50"
                        dangerouslySetInnerHTML={{ __html: getPreviewContent() }}
                      />
                    ) : (
                      <>
                        {/* Formatting toolbar */}
                        <div className="flex items-center gap-0.5 px-1 py-1 border border-b-0 rounded-t-md bg-slate-50">
                          <button
                            type="button"
                            onClick={() => execFormat('bold')}
                            title="Bold"
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-600 transition-colors"
                          >
                            <Bold className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => execFormat('italic')}
                            title="Italic"
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-600 transition-colors"
                          >
                            <Italic className="h-3.5 w-3.5" />
                          </button>
                          <div className="w-px h-4 bg-slate-300 mx-1" />
                          <button
                            type="button"
                            onClick={() => execFormat('insertUnorderedList')}
                            title="Bullet List"
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-600 transition-colors"
                          >
                            <List className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => execFormat('insertOrderedList')}
                            title="Numbered List"
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-600 transition-colors"
                          >
                            <ListOrdered className="h-3.5 w-3.5" />
                          </button>
                          <div className="w-px h-4 bg-slate-300 mx-1" />
                          <button
                            type="button"
                            onClick={insertTable}
                            title="Insert Table"
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-600 transition-colors"
                          >
                            <Table className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => renumberTableLists()}
                            title="Renumber lists across table rows (1, 2, 3...)"
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-600 transition-colors"
                          >
                            <Hash className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div
                          ref={editorRef}
                          contentEditable
                          suppressContentEditableWarning
                          onClick={handleEditorClick}
                          onContextMenu={handleEditorContextMenu}
                          onKeyDown={handleEditorKeyDown}
                          onFocus={() => { lastFocusRef.current = 'body'; }}
                          onInput={syncMergeFieldsFromEditor}
                          className="w-full px-3 py-2 text-sm border rounded-b-md min-h-[400px] bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 overflow-y-auto [&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:p-1 [&_th]:border [&_th]:border-slate-300 [&_th]:p-1 [&_th]:bg-slate-50"
                          style={{ lineHeight: '1.8' }}
                        />
                        {/* Floating table toolbar — appears when cursor is in a table */}
                        {activeTableCell && (
                          <div
                            ref={tableToolbarRef}
                            className="flex items-center gap-0.5 px-2 py-1 mt-1 bg-slate-100 border border-slate-200 rounded-md text-[10px] text-slate-600"
                          >
                            <span className="font-semibold text-slate-500 mr-1">Table:</span>
                            <button
                              type="button"
                              onClick={() => { if (activeTableCell) tableAddRowAboveFor(activeTableCell); }}
                              onMouseDown={e => e.preventDefault()}
                              className="px-1.5 py-0.5 rounded hover:bg-slate-200 transition-colors"
                            >+ Row Above</button>
                            <button
                              type="button"
                              onClick={() => { if (activeTableCell) tableAddRowBelowFor(activeTableCell); }}
                              onMouseDown={e => e.preventDefault()}
                              className="px-1.5 py-0.5 rounded hover:bg-slate-200 transition-colors"
                            >+ Row Below</button>
                            <button
                              type="button"
                              onClick={() => { if (activeTableCell) tableAddColLeftFor(activeTableCell); }}
                              onMouseDown={e => e.preventDefault()}
                              className="px-1.5 py-0.5 rounded hover:bg-slate-200 transition-colors"
                            >+ Col Left</button>
                            <button
                              type="button"
                              onClick={() => { if (activeTableCell) tableAddColRightFor(activeTableCell); }}
                              onMouseDown={e => e.preventDefault()}
                              className="px-1.5 py-0.5 rounded hover:bg-slate-200 transition-colors"
                            >+ Col Right</button>
                            <div className="w-px h-3 bg-slate-300 mx-0.5" />
                            <button
                              type="button"
                              onClick={() => { if (activeTableCell) tableDeleteRowFor(activeTableCell); }}
                              onMouseDown={e => e.preventDefault()}
                              className="px-1.5 py-0.5 rounded hover:bg-red-100 text-red-600 transition-colors"
                            >- Row</button>
                            <button
                              type="button"
                              onClick={() => { if (activeTableCell) tableDeleteColFor(activeTableCell); }}
                              onMouseDown={e => e.preventDefault()}
                              className="px-1.5 py-0.5 rounded hover:bg-red-100 text-red-600 transition-colors"
                            >- Col</button>
                            <div className="w-px h-3 bg-slate-300 mx-0.5" />
                            <button
                              type="button"
                              onClick={() => renumberTableLists(activeTableCell?.closest('table') as HTMLTableElement | null)}
                              onMouseDown={e => e.preventDefault()}
                              className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-600 transition-colors"
                            ># Renumber</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Merge fields palette */}
                  {!showPreview && (
                    <div className="w-56 flex-shrink-0">
                      <div className="border rounded-lg bg-slate-50 p-2">
                        <div className="flex items-center gap-1 mb-2">
                          <Variable className="h-3.5 w-3.5 text-teal-600" />
                          <span className="text-xs font-semibold text-slate-700">Merge Fields</span>
                        </div>
                        <input
                          type="text"
                          placeholder="Search fields..."
                          value={fieldSearch}
                          onChange={(e) => setFieldSearch(e.target.value)}
                          className="w-full px-2 py-1 text-[11px] border rounded mb-2"
                        />
                        <div className="max-h-[350px] overflow-y-auto space-y-2">
                          {MERGE_FIELD_CATEGORIES.map((cat) => {
                            const filtered = cat.fields.filter((f) =>
                              !fieldSearch || f.label.toLowerCase().includes(fieldSearch.toLowerCase())
                            );
                            if (filtered.length === 0) return null;
                            return (
                              <div key={cat.category}>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                  {cat.category}
                                </div>
                                {filtered.map((field) => {
                                  const isUsed = editMergeFields.some((f) => f.key === field.key);
                                  return (
                                    <button
                                      key={field.key}
                                      onClick={() => insertMergeField(field.key, field.label, field.source, field.path)}
                                      className={`w-full text-left px-1.5 py-1 rounded text-[11px] hover:bg-teal-100 transition-colors flex items-center gap-1.5 ${
                                        isUsed ? 'bg-teal-50 text-teal-700' : 'text-slate-600'
                                      }`}
                                    >
                                      <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: isUsed ? '#0d9488' : '#cbd5e1' }} />
                                      <span className="truncate">{field.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Response Options */}
                      <div className="border rounded-lg bg-amber-50/50 p-2 mt-2">
                        <div className="flex items-center gap-1 mb-2">
                          <MessageSquare className="h-3.5 w-3.5 text-amber-600" />
                          <span className="text-xs font-semibold text-slate-700">Response Options</span>
                        </div>
                        <div className="space-y-1">
                          {RESPONSE_OPTIONS.map((opt) => (
                            <button
                              key={opt.key}
                              onClick={() => insertResponseOption(opt)}
                              className="w-full text-left px-1.5 py-1.5 rounded text-[11px] text-slate-600 hover:bg-amber-100 transition-colors flex items-center gap-1.5"
                            >
                              <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 bg-amber-400" />
                              <span>{opt.label}</span>
                              <span className="ml-auto flex gap-0.5">
                                {opt.options.map(o => (
                                  <span key={o} className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">{o}</span>
                                ))}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Job Sections */}
                      <div className="border rounded-lg bg-indigo-50/50 p-2 mt-2">
                        <div className="flex items-center gap-1 mb-2">
                          <Layout className="h-3.5 w-3.5 text-indigo-600" />
                          <span className="text-xs font-semibold text-slate-700">Job Sections</span>
                        </div>
                        <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                          {JOB_SECTIONS.map((section) => (
                            <button
                              key={section.key}
                              onClick={() => insertJobSectionLink(section)}
                              className="w-full text-left px-1.5 py-1 rounded text-[11px] text-slate-600 hover:bg-indigo-100 transition-colors flex items-center gap-1.5"
                            >
                              <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 bg-indigo-400" />
                              <span className="truncate">{section.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Custom Link */}
                      <div className="border rounded-lg bg-violet-50/50 p-2 mt-2">
                        <div className="flex items-center gap-1 mb-2">
                          <Link2 className="h-3.5 w-3.5 text-violet-600" />
                          <span className="text-xs font-semibold text-slate-700">Custom Link</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mb-2">Set when sending — the user provides the URL at send time.</p>
                        <div className="space-y-1.5">
                          <div>
                            <label className="block text-[10px] font-medium text-slate-500 mb-0.5">Link Label (display text)</label>
                            <input
                              type="text"
                              value={editCustomLinkLabel}
                              onChange={(e) => setEditCustomLinkLabel(e.target.value)}
                              placeholder="e.g. View Document"
                              className="w-full px-1.5 py-1 text-[11px] border rounded"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-slate-500 mb-0.5">Default URL (optional)</label>
                            <input
                              type="text"
                              value={editCustomLinkUrl}
                              onChange={(e) => setEditCustomLinkUrl(e.target.value)}
                              placeholder="e.g. https://..."
                              className="w-full px-1.5 py-1 text-[11px] border rounded"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => insertMergeField('custom_link', editCustomLinkLabel || 'Custom Link', 'system', 'customLink')}
                            className="w-full text-left px-1.5 py-1.5 rounded text-[11px] text-violet-700 bg-violet-100 hover:bg-violet-200 transition-colors flex items-center gap-1.5 font-medium"
                          >
                            <Link2 className="h-3 w-3" />
                            Insert Custom Link
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Active merge fields in this template */}
                {editMergeFields.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Fields used ({editMergeFields.length})
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {editMergeFields.map((f) => (
                        <span key={f.key} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                          {f.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table context menu */}
      {tableMenu && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[180px] text-xs"
          style={{ left: tableMenu.x, top: tableMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Rows</div>
          <button onClick={tableAddRowAbove} className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700">Insert Row Above</button>
          <button onClick={tableAddRowBelow} className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700">Insert Row Below</button>
          <button onClick={tableDeleteRow} className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600">Delete Row</button>
          <div className="border-t border-slate-100 my-1" />
          <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Columns</div>
          <button onClick={tableAddColLeft} className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700">Insert Column Left</button>
          <button onClick={tableAddColRight} className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700">Insert Column Right</button>
          <button onClick={tableDeleteCol} className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600">Delete Column</button>
          <div className="border-t border-slate-100 my-1" />
          <button onClick={() => renumberTableLists(tableMenu.cell.closest('table'))} className="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-blue-600">Renumber Lists in Table</button>
        </div>
      )}
    </div>
  );
}
