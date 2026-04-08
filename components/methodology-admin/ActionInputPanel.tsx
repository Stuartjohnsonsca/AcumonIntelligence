'use client';

import type { InputFieldDef, OutputFieldDef } from '@/lib/action-registry';

interface Props {
  field: InputFieldDef;
  value: any;
  onChange: (code: string, value: any) => void;
  previousOutputs?: OutputFieldDef[];
  stepIndex: number;
}

export function ActionInputPanel({ field, value, onChange, previousOutputs, stepIndex }: Props) {
  const isAutoMapped = typeof value === 'string' && (value.startsWith('$prev.') || value.startsWith('$step.') || value.startsWith('$ctx.'));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-600">{field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}</label>
        {isAutoMapped && <span className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium">auto-mapped</span>}
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
          value={isAutoMapped ? value : (value || '')}
          onChange={e => onChange(field.code, e.target.value)}
          className={`w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs min-h-[60px] focus:outline-none focus:border-blue-300 ${isAutoMapped ? 'bg-blue-50/50 text-blue-600' : ''}`}
          rows={3}
          placeholder={field.description || `Enter ${field.label.toLowerCase()}...`}
        />
      )}

      {field.type === 'text' && (
        <input
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
