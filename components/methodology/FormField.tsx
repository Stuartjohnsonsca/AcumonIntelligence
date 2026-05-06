'use client';

import { useState } from 'react';
import type { QuestionInputType } from '@/types/methodology';

interface Props {
  questionId: string;
  inputType: QuestionInputType;
  value: string | number | boolean | null;
  onChange: (value: string | number | boolean | null) => void;
  dropdownOptions?: string[];
  computedValue?: string | number | boolean | null;
  isFormula?: boolean;
  placeholder?: string;
  validationMin?: number;
  validationMax?: number;
  disabled?: boolean;
  className?: string;
}

export function FormField({
  questionId,
  inputType,
  value,
  onChange,
  dropdownOptions,
  computedValue,
  isFormula,
  placeholder,
  validationMin,
  validationMax,
  disabled,
  className = '',
}: Props) {
  const baseClass = 'w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-slate-50 disabled:text-slate-400';

  // Ad-hoc formula: a text/textarea answer the user typed starting with '='.
  // Different from a template-configured formula question — the formula
  // expression lives on the VALUE, not on the question schema, so the user
  // needs a way to click in and edit it. Formula stays hidden by default;
  // click to reveal and edit, blur to hide again.
  const isAdHocFormula = Boolean(
    isFormula
    && inputType !== 'formula'
    && typeof value === 'string'
    && value.trim().startsWith('=')
  );
  const [editingAdHoc, setEditingAdHoc] = useState(false);

  // Formula fields show computed value as read-only
  if (isFormula && computedValue !== undefined && !(isAdHocFormula && editingAdHoc)) {
    return (
      <button
        type="button"
        onClick={() => { if (isAdHocFormula && !disabled) setEditingAdHoc(true); }}
        title={isAdHocFormula ? `Click to edit formula: ${value}` : 'Auto-calculated'}
        className={`${baseClass} bg-blue-50/30 text-slate-700 min-h-[36px] text-left ${isAdHocFormula && !disabled ? 'cursor-text hover:bg-blue-100/40' : 'cursor-default'} ${className}`}
      >
        {computedValue !== null && computedValue !== '' ? String(computedValue) : <span className="text-slate-300 italic">Auto-calculated</span>}
      </button>
    );
  }

  // Ad-hoc formula in edit mode — show the raw expression for editing, swap
  // back to the computed display on blur when it still starts with '='.
  if (isAdHocFormula && editingAdHoc) {
    return (
      <input
        type="text"
        autoFocus
        id={questionId}
        value={typeof value === 'string' ? value : ''}
        onChange={e => onChange(e.target.value)}
        onBlur={() => setEditingAdHoc(false)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.currentTarget.blur(); } }}
        disabled={disabled}
        placeholder="= formula (e.g. =audit_fee + non_audit_fee)"
        className={`${baseClass} font-mono bg-blue-50/20 ${className}`}
      />
    );
  }

  switch (inputType) {
    case 'text':
      return (
        <input
          type="text"
          id={questionId}
          value={typeof value === 'string' ? value : value?.toString() || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`${baseClass} ${className}`}
        />
      );

    case 'textarea':
      return (
        <textarea
          id={questionId}
          value={typeof value === 'string' ? value : value?.toString() || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={3}
          className={`${baseClass} min-h-[60px] resize-y ${className}`}
        />
      );

    case 'yesno':
      return (
        <select
          id={questionId}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={`${baseClass} ${className}`}
        >
          <option value="">Select...</option>
          <option value="Y">Y</option>
          <option value="N">N</option>
        </select>
      );

    case 'yes_only':
      return (
        <select
          id={questionId}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={`${baseClass} ${className}`}
        >
          <option value="">Select...</option>
          <option value="Y">Y</option>
        </select>
      );

    case 'yna':
      return (
        <select
          id={questionId}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={`${baseClass} ${className}`}
        >
          <option value="">Select...</option>
          <option value="Y">Y</option>
          <option value="N">N</option>
          <option value="N/A">N/A</option>
        </select>
      );

    case 'currency':
      return (
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">£</span>
          <input
            type="number"
            id={questionId}
            value={value !== null && value !== undefined && value !== '' ? Number(value) : ''}
            onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
            min={validationMin}
            max={validationMax}
            disabled={disabled}
            placeholder={placeholder}
            className={`${baseClass} pl-6 ${className}`}
          />
        </div>
      );

    case 'dropdown':
      return (
        <select
          id={questionId}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={`${baseClass} ${className}`}
        >
          <option value="">Select...</option>
          {(dropdownOptions || []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );

    case 'multiselect': {
      // Value is a JSON-encoded array of strings. Empty / non-JSON
      // legacy values fall back to []; this keeps formula/text consumers
      // that read it raw seeing a printable representation.
      const selected = (() => {
        if (!value || typeof value !== 'string') return [] as string[];
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string') : [];
        } catch {
          return [];
        }
      })();
      const toggle = (opt: string) => {
        const next = selected.includes(opt)
          ? selected.filter(s => s !== opt)
          : [...selected, opt];
        onChange(next.length === 0 ? '' : JSON.stringify(next));
      };
      return (
        <div id={questionId} className={`${baseClass} flex flex-wrap gap-x-3 gap-y-1 min-h-[36px] ${className}`}>
          {(dropdownOptions || []).length === 0 ? (
            <span className="text-slate-300 italic text-xs">No options configured</span>
          ) : (
            (dropdownOptions || []).map(opt => (
              <label key={opt} className={`inline-flex items-center gap-1.5 cursor-pointer text-sm ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => !disabled && toggle(opt)}
                  disabled={disabled}
                  className="w-3.5 h-3.5 rounded border-slate-300"
                />
                <span className="text-slate-700">{opt}</span>
              </label>
            ))
          )}
        </div>
      );
    }

    case 'number':
      return (
        <input
          type="number"
          id={questionId}
          value={value !== null && value !== undefined && value !== '' ? Number(value) : ''}
          onChange={e => {
            const v = e.target.value;
            onChange(v === '' ? null : Number(v));
          }}
          min={validationMin}
          max={validationMax}
          disabled={disabled}
          placeholder={placeholder}
          className={`${baseClass} ${className}`}
        />
      );

    case 'date':
      return (
        <input
          type="date"
          id={questionId}
          value={typeof value === 'string' ? value.split('T')[0] : ''}
          onChange={e => onChange(e.target.value || null)}
          disabled={disabled}
          className={`${baseClass} ${className}`}
        />
      );

    case 'checkbox':
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            id={questionId}
            checked={value === true || value === 'true' || value === 'Y'}
            onChange={e => onChange(e.target.checked)}
            disabled={disabled}
            className="w-4 h-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-600">Yes</span>
        </label>
      );

    default:
      return (
        <input
          type="text"
          id={questionId}
          value={typeof value === 'string' ? value : value?.toString() || ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={`${baseClass} ${className}`}
        />
      );
  }
}
