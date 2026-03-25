'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface ShortcutInfo {
  keys: string;
  label: string;
  scope: 'Spreadsheet' | 'Everywhere' | 'Text';
  status: 'active' | 'placeholder';
  notes?: string;
}

const COMBO_SHORTCUTS: ShortcutInfo[] = [
  { keys: 'Ctrl + C', label: 'Copy', scope: 'Everywhere', status: 'active', notes: 'Copies selected cells or text to clipboard' },
  { keys: 'Ctrl + V', label: 'Paste', scope: 'Everywhere', status: 'active', notes: 'Pastes clipboard content into selected cells or text fields' },
  { keys: 'Alt + =', label: 'Sum', scope: 'Spreadsheet', status: 'active', notes: 'Calculates sum of selected numeric cells' },
  { keys: 'Ctrl + -', label: 'Delete Row', scope: 'Spreadsheet', status: 'active', notes: 'Deletes selected row(s). Must have full row selected.' },
  { keys: 'Ctrl + -', label: 'Delete Column', scope: 'Spreadsheet', status: 'active', notes: 'Deletes selected column(s). Must have full column selected.' },
];

const SEQUENCE_SHORTCUTS: ShortcutInfo[] = [
  { keys: 'Ctrl → E → S → V', label: 'Paste Special: Values', scope: 'Spreadsheet', status: 'placeholder', notes: 'Pastes values only without formatting' },
  { keys: 'Ctrl → E → S → F', label: 'Paste Special: Formatting', scope: 'Spreadsheet', status: 'placeholder', notes: 'Pastes formatting only without values' },
  { keys: 'Ctrl → H → P', label: 'Percentage Format', scope: 'Spreadsheet', status: 'placeholder', notes: 'Formats selected cells as percentage' },
  { keys: 'Alt → H → K', label: 'Number Format', scope: 'Spreadsheet', status: 'placeholder', notes: 'Opens number format options' },
  { keys: 'Alt → H → 9', label: 'Reduce Decimals', scope: 'Spreadsheet', status: 'placeholder', notes: 'Reduces decimal places by one' },
  { keys: 'Alt → W → F → F', label: 'Freeze Panes', scope: 'Spreadsheet', status: 'placeholder', notes: 'Freezes rows/columns above and left of selection' },
  { keys: 'Alt → H → F → F', label: 'Font Selection', scope: 'Spreadsheet', status: 'placeholder', notes: 'Opens font picker' },
  { keys: 'Alt → H → F → S', label: 'Font Size', scope: 'Spreadsheet', status: 'placeholder', notes: 'Opens font size picker' },
  { keys: 'Alt → H → W', label: 'Wrap Text', scope: 'Spreadsheet', status: 'placeholder', notes: 'Toggles text wrapping in cells' },
  { keys: 'Alt → H → M → C', label: 'Merge & Centre', scope: 'Spreadsheet', status: 'placeholder', notes: 'Merges selected cells and centres text' },
  { keys: 'Alt → H → A → L', label: 'Left Alignment', scope: 'Spreadsheet', status: 'placeholder', notes: 'Aligns cell content to the left' },
  { keys: 'Alt → H → A → R', label: 'Right Alignment', scope: 'Spreadsheet', status: 'placeholder', notes: 'Aligns cell content to the right' },
  { keys: 'Alt → H → A → C', label: 'Centre Alignment', scope: 'Spreadsheet', status: 'placeholder', notes: 'Centres cell content' },
  { keys: 'Alt → H → B → O', label: 'Bottom Border', scope: 'Spreadsheet', status: 'placeholder', notes: 'Adds a bottom border to selected cells' },
  { keys: 'Alt → H → B → P', label: 'Top Border', scope: 'Spreadsheet', status: 'placeholder', notes: 'Adds a top border to selected cells' },
  { keys: 'Alt → H → H', label: 'Fill Colour', scope: 'Spreadsheet', status: 'placeholder', notes: 'Opens cell background colour picker' },
  { keys: 'Alt → H → F → C', label: 'Font Colour', scope: 'Spreadsheet', status: 'placeholder', notes: 'Opens font colour picker' },
];

function KeyBadge({ text }: { text: string }) {
  return (
    <kbd className="inline-flex items-center px-2 py-0.5 bg-slate-100 border border-slate-300 rounded text-xs font-mono text-slate-700 shadow-sm">
      {text}
    </kbd>
  );
}

function KeySequence({ keys }: { keys: string }) {
  const isSequence = keys.includes('→');
  const parts = isSequence ? keys.split(' → ') : keys.split(' + ');

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-400 text-[10px]">{isSequence ? 'then' : '+'}</span>}
          <KeyBadge text={part.trim()} />
        </span>
      ))}
    </div>
  );
}

function ScopeBadge({ scope }: { scope: string }) {
  const colors = {
    Spreadsheet: 'bg-blue-50 text-blue-700 border-blue-200',
    Everywhere: 'bg-green-50 text-green-700 border-green-200',
    Text: 'bg-purple-50 text-purple-700 border-purple-200',
  }[scope] || 'bg-slate-50 text-slate-600 border-slate-200';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${colors}`}>
      {scope}
    </span>
  );
}

function StatusBadge({ status }: { status: 'active' | 'placeholder' }) {
  return status === 'active' ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-50 text-green-700 border border-green-200">
      Active
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
      Coming Soon
    </span>
  );
}

function ShortcutTable({ shortcuts, title, description }: { shortcuts: ShortcutInfo[]; title: string; description: string }) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50/50 border-b border-slate-100">
            <th className="text-left px-4 py-2 text-xs text-slate-500 font-medium w-56">Shortcut</th>
            <th className="text-left px-4 py-2 text-xs text-slate-500 font-medium w-44">Action</th>
            <th className="text-left px-4 py-2 text-xs text-slate-500 font-medium w-28">Works In</th>
            <th className="text-left px-4 py-2 text-xs text-slate-500 font-medium w-24">Status</th>
            <th className="text-left px-4 py-2 text-xs text-slate-500 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {shortcuts.map((s, i) => (
            <tr key={`${s.keys}-${i}`} className={`border-b border-slate-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} ${s.status === 'placeholder' ? 'opacity-70' : ''}`}>
              <td className="px-4 py-2.5"><KeySequence keys={s.keys} /></td>
              <td className="px-4 py-2.5 text-slate-800 font-medium">{s.label}</td>
              <td className="px-4 py-2.5"><ScopeBadge scope={s.scope} /></td>
              <td className="px-4 py-2.5"><StatusBadge status={s.status} /></td>
              <td className="px-4 py-2.5 text-xs text-slate-500">{s.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyboardShortcutsClient() {
  return (
    <div className="space-y-8">
      <div>
        <Link href="/my-account" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mb-4">
          <ArrowLeft className="h-3 w-3" /> Back to My Account
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Keyboard Shortcuts</h1>
        <p className="text-slate-600 mt-1">Reference guide for all keyboard shortcuts across Acumon Intelligence</p>
      </div>

      {/* When shortcuts work */}
      <div className="border border-blue-200 bg-blue-50/30 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-800 mb-2">When do shortcuts work?</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-white rounded-lg p-3 border border-blue-100">
            <div className="flex items-center gap-2 mb-1.5">
              <ScopeBadge scope="Spreadsheet" />
              <span className="font-semibold text-slate-700">Spreadsheet Mode</span>
            </div>
            <p className="text-slate-500">Active when you click into a spreadsheet grid (Bank to TB, Trial Balance, PAR, RMM). You&apos;ll see a faint blue outline around the grid.</p>
            <p className="text-slate-500 mt-1"><strong>Won&apos;t work</strong> when typing in a text input, search box, or dropdown.</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-green-100">
            <div className="flex items-center gap-2 mb-1.5">
              <ScopeBadge scope="Everywhere" />
              <span className="font-semibold text-slate-700">Everywhere</span>
            </div>
            <p className="text-slate-500">Works in any context — spreadsheets, text fields, and form inputs. Standard browser shortcuts.</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-amber-100">
            <div className="flex items-center gap-2 mb-1.5">
              <StatusBadge status="placeholder" />
              <span className="font-semibold text-slate-700">Coming Soon</span>
            </div>
            <p className="text-slate-500">These shortcuts are registered and will show a notification when pressed, but the full functionality is not yet implemented. They are planned for future releases.</p>
          </div>
        </div>
      </div>

      {/* Sequence indicator */}
      <div className="border border-slate-200 bg-slate-50/30 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Sequence shortcuts</h3>
        <p className="text-xs text-slate-500">
          Sequence shortcuts are pressed one key at a time (not held together). When you start a sequence, a dark indicator appears in the bottom-right corner showing the keys pressed so far.
          For example, for <KeyBadge text="Alt" /> then <KeyBadge text="H" /> then <KeyBadge text="K" />, press and release Alt, then press H, then press K.
          These mirror the Excel ribbon shortcut pattern.
        </p>
      </div>

      {/* Combo shortcuts */}
      <ShortcutTable
        shortcuts={COMBO_SHORTCUTS}
        title="Combination Shortcuts"
        description="Hold these keys together simultaneously"
      />

      {/* Sequence shortcuts */}
      <ShortcutTable
        shortcuts={SEQUENCE_SHORTCUTS}
        title="Sequence Shortcuts (Excel Ribbon Style)"
        description="Press these keys one after another — do not hold them together"
      />

      {/* Pages where shortcuts are active */}
      <div className="border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Pages with keyboard shortcuts</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {[
            { page: 'Bank to TB', path: '/tools/bank-to-tb', desc: 'Bank transactions and trial balance spreadsheets' },
            { page: 'Trial Balance CY vs PY', path: '', desc: 'Within audit engagement → TBCYvPY tab' },
            { page: 'Preliminary Analytical Review', path: '', desc: 'Within audit engagement → PAR tab' },
            { page: 'Identifying & Assessing RMM', path: '', desc: 'Within audit engagement → RMM tab' },
            { page: 'Data Extraction', path: '/tools/data-extraction', desc: 'Extracted data tables' },
            { page: 'FS Assertions', path: '/tools/fs-assertions', desc: 'Financial statement assertions grid' },
          ].map(p => (
            <div key={p.page} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-50">
              <span className="w-2 h-2 rounded-full bg-blue-400 mt-1 flex-shrink-0" />
              <div>
                <span className="font-medium text-slate-700">{p.page}</span>
                <span className="text-slate-400 ml-1">— {p.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Shortcuts do not work when browser popups, modals, or dropdown menus are open. Close them first to use shortcuts.
        On macOS, use ⌘ (Cmd) instead of Ctrl for combination shortcuts.
      </p>
    </div>
  );
}
