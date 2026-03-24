'use client';

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

  // Formula fields show computed value as read-only
  if (isFormula && computedValue !== undefined) {
    return (
      <div className={`${baseClass} bg-blue-50/30 text-slate-600 min-h-[36px] ${className}`}>
        {computedValue !== null && computedValue !== '' ? String(computedValue) : <span className="text-slate-300 italic">Auto-calculated</span>}
      </div>
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
