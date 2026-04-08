'use client';

import { useState, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import type { InputFieldDef, OutputFieldDef } from '@/lib/action-registry';

interface Props {
  field: InputFieldDef;
  value: any;
  onChange: (code: string, value: any) => void;
  previousOutputs?: OutputFieldDef[];
  stepIndex: number;
}

// Available placeholders grouped by category
const PLACEHOLDER_GROUPS = [
  {
    label: 'Engagement',
    items: [
      { placeholder: '{{engagement.clientName}}', description: 'Client name' },
      { placeholder: '{{engagement.periodStart}}', description: 'Period start date' },
      { placeholder: '{{engagement.periodEnd}}', description: 'Period end date' },
      { placeholder: '{{engagement.materiality}}', description: 'Materiality amount' },
      { placeholder: '{{engagement.performanceMateriality}}', description: 'Performance materiality' },
      { placeholder: '{{engagement.clearlyTrivial}}', description: 'Clearly trivial threshold' },
      { placeholder: '{{engagement.framework}}', description: 'Accounting framework (IFRS, FRS102, etc.)' },
      { placeholder: '{{engagement.auditType}}', description: 'Audit type (SME, PIE, etc.)' },
    ],
  },
  {
    label: 'Test',
    items: [
      { placeholder: '{{test.description}}', description: 'Test description' },
      { placeholder: '{{test.fsLine}}', description: 'FS line being tested' },
      { placeholder: '{{test.assertion}}', description: 'Assertion being tested' },
    ],
  },
  {
    label: 'Trial Balance',
    items: [
      { placeholder: '{{tb.currentYear}}', description: 'Current year balance' },
      { placeholder: '{{tb.priorYear}}', description: 'Prior year balance' },
      { placeholder: '{{tb.variance}}', description: 'Variance amount' },
      { placeholder: '{{tb.variancePct}}', description: 'Variance percentage' },
      { placeholder: '{{tb.accountCode}}', description: 'Account code' },
      { placeholder: '{{tb.description}}', description: 'Account description' },
    ],
  },
  {
    label: 'Previous Step',
    items: [
      { placeholder: '{{input.data_table}}', description: 'Data table from previous step' },
      { placeholder: '{{input.documents}}', description: 'Documents from previous step' },
      { placeholder: '{{input.sample_items}}', description: 'Sample items from previous step' },
      { placeholder: '{{input.result}}', description: 'Result from previous step' },
    ],
  },
  {
    label: 'Dates & Formatting',
    items: [
      { placeholder: '{{today}}', description: 'Today\'s date' },
      { placeholder: '{{currentUser}}', description: 'Current user name' },
    ],
  },
];

function PlaceholderPicker({ onInsert }: { onInsert: (placeholder: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 font-medium"
      >
        {'{{ }}'} Insert Placeholder
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-lg shadow-xl border border-slate-200 z-50 max-h-64 overflow-y-auto">
          {PLACEHOLDER_GROUPS.map(group => (
            <div key={group.label}>
              <div className="px-3 py-1 text-[9px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50 sticky top-0">
                {group.label}
              </div>
              {group.items.map(item => (
                <button
                  key={item.placeholder}
                  type="button"
                  onClick={() => { onInsert(item.placeholder); setOpen(false); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-blue-50 transition-colors flex items-center justify-between gap-2"
                >
                  <span className="text-[10px] font-mono text-blue-600">{item.placeholder}</span>
                  <span className="text-[9px] text-slate-400 truncate">{item.description}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActionInputPanel({ field, value, onChange, previousOutputs, stepIndex }: Props) {
  const isAutoMapped = typeof value === 'string' && (value.startsWith('$prev.') || value.startsWith('$step.') || value.startsWith('$ctx.'));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const insertPlaceholder = (placeholder: string) => {
    const currentVal = (value || '') as string;
    // Insert at cursor position if possible
    const el = textareaRef.current || inputRef.current;
    if (el) {
      const start = el.selectionStart || currentVal.length;
      const end = el.selectionEnd || currentVal.length;
      const newVal = currentVal.slice(0, start) + placeholder + currentVal.slice(end);
      onChange(field.code, newVal);
      // Restore cursor after the inserted placeholder
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + placeholder.length, start + placeholder.length);
      }, 0);
    } else {
      onChange(field.code, currentVal + placeholder);
    }
  };

  const showPlaceholderPicker = (field.type === 'text' || field.type === 'textarea') && !isAutoMapped;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-600">{field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}</label>
        {isAutoMapped && <span className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium">auto-mapped</span>}
        {showPlaceholderPicker && (
          <PlaceholderPicker onInsert={insertPlaceholder} />
        )}
      </div>

      {field.description && <p className="text-[10px] text-slate-400 -mt-0.5">{field.description}</p>}

      {field.type === 'select' && (
        <select
          value={value || field.defaultValue || ''}
          onChange={e => onChange(field.code, e.target.value)}
          className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-300"
        >
          <option value="">Select...</option>
          {(field.options || []).map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {field.type === 'multiselect' && (
        <div className="flex flex-wrap gap-1">
          {(field.options || []).map(opt => {
            const selected = Array.isArray(value) && value.includes(opt.value);
            return (
              <label key={opt.value} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${selected ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  className="hidden"
                  onChange={e => {
                    const arr = Array.isArray(value) ? [...value] : [];
                    onChange(field.code, e.target.checked ? [...arr, opt.value] : arr.filter(v => v !== opt.value));
                  }}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      )}

      {field.type === 'textarea' && (
        <textarea
          ref={textareaRef}
          value={isAutoMapped ? value : (value || '')}
          onChange={e => onChange(field.code, e.target.value)}
          className={`w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs min-h-[60px] focus:outline-none focus:border-blue-300 ${isAutoMapped ? 'bg-blue-50/50 text-blue-600' : ''}`}
          rows={3}
          placeholder={field.description || `Enter ${field.label.toLowerCase()}...`}
        />
      )}

      {field.type === 'text' && (
        <input
          ref={inputRef}
          type="text"
          value={isAutoMapped ? value : (value || '')}
          onChange={e => onChange(field.code, e.target.value)}
          className={`w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-blue-300 ${isAutoMapped ? 'bg-blue-50/50 text-blue-600' : ''}`}
          placeholder={field.description || `Enter ${field.label.toLowerCase()}...`}
        />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          value={value ?? field.defaultValue ?? ''}
          onChange={e => onChange(field.code, e.target.value ? Number(e.target.value) : null)}
          className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-blue-300"
        />
      )}

      {field.type === 'boolean' && (
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value ?? field.defaultValue ?? false}
            onChange={e => onChange(field.code, e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-300"
          />
          <span className="text-xs text-slate-600">{value ? 'Yes' : 'No'}</span>
        </label>
      )}

      {field.type === 'date' && (
        <input
          type="date"
          value={isAutoMapped ? '' : (value || '')}
          onChange={e => onChange(field.code, e.target.value)}
          className={`w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-blue-300 ${isAutoMapped ? 'bg-blue-50/50' : ''}`}
          disabled={isAutoMapped}
        />
      )}

      {(field.type === 'json_table' || field.type === 'file') && isAutoMapped && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-blue-50 border border-blue-100 rounded-md">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          <span className="text-[10px] text-blue-600 font-medium">Mapped from: {value}</span>
        </div>
      )}

      {(field.type === 'json_table' || field.type === 'file') && !isAutoMapped && (
        <div className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md">
          <span className="text-[10px] text-slate-400">Will be populated at runtime</span>
        </div>
      )}

      {/* Binding override - allow user to switch between auto and manual */}
      {field.source === 'auto' && previousOutputs && previousOutputs.length > 0 && (
        <select
          value={isAutoMapped ? value : '_manual'}
          onChange={e => onChange(field.code, e.target.value === '_manual' ? '' : e.target.value)}
          className="w-full border border-slate-100 rounded px-2 py-1 text-[10px] text-slate-400 bg-slate-50"
        >
          <option value="_manual">Manual input</option>
          {previousOutputs.map(out => (
            <option key={out.code} value={`$prev.${out.code}`}>← Previous: {out.label}</option>
          ))}
          {stepIndex > 1 && <option value="_custom">Custom binding...</option>}
        </select>
      )}
    </div>
  );
}
