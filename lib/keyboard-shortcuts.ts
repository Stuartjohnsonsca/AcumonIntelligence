// ─── Types ──────────────────────────────────────────────────────────────────

export type Scope = 'sheet' | 'text' | 'both';

export interface SelectionState {
  type: 'none' | 'cell' | 'range' | 'row' | 'column';
  cells: Array<{ row: number; col: number }>;
  isFullRow: boolean;
  isFullColumn: boolean;
  selectedRows: number[];
  selectedCols: number[];
  getValues: () => string[][];
}

export interface ShortcutActions {
  copySelection: () => Promise<void>;
  pasteToSelection: () => Promise<void>;
  deleteSelectedRows: () => void;
  deleteSelectedColumns: () => void;
  sumSelection: () => void;
  showPlaceholder: (label: string) => void;
}

export interface ShortcutContext {
  scope: Scope;
  selection: SelectionState;
  actions: ShortcutActions;
}

export interface ShortcutDef {
  id: string;
  type: 'combo' | 'sequence';
  scope: Scope;
  label: string;
  // For combos:
  combo?: {
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
    key: string; // lowercased e.key
  };
  // For sequences:
  sequence?: string[]; // e.g. ['alt','h','k']
  // Guard:
  when?: (ctx: ShortcutContext) => boolean;
  // Handler:
  run: (ctx: ShortcutContext) => void;
  preventDefault?: boolean;
}

// ─── Key Normalization ──────────────────────────────────────────────────────

const MODIFIER_KEYS = new Set(['control', 'alt', 'shift', 'meta']);

function normalizeKey(e: KeyboardEvent): string {
  return e.key.toLowerCase();
}

function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

// ─── Scope Detection ────────────────────────────────────────────────────────

export function getScopeFromElement(el: Element | null): 'sheet' | 'text' | null {
  if (!el) return null;
  const scoped = (el as HTMLElement).closest?.('[data-kb-scope]');
  if (!scoped) return null;
  const scope = (scoped as HTMLElement).dataset.kbScope;
  if (scope === 'sheet' || scope === 'text') return scope;
  return null;
}

export function isTextEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type?.toLowerCase();
    // Only text-like inputs are editable
    return ['text', 'search', 'url', 'tel', 'email', 'password', 'number', ''].includes(type);
  }
  if (tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  // Check ancestors
  if (el.closest?.('[contenteditable="true"]')) return true;
  return false;
}

// ─── Shortcut Registry (22 shortcuts) ───────────────────────────────────────

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // ── Combos ──
  {
    id: 'copy',
    type: 'combo',
    scope: 'both',
    label: 'Copy',
    combo: { ctrl: true, key: 'c' },
    run: (ctx) => ctx.actions.copySelection(),
    preventDefault: true,
  },
  {
    id: 'paste',
    type: 'combo',
    scope: 'both',
    label: 'Paste',
    combo: { ctrl: true, key: 'v' },
    run: (ctx) => ctx.actions.pasteToSelection(),
    preventDefault: true,
  },
  {
    id: 'sum',
    type: 'combo',
    scope: 'sheet',
    label: 'Sum',
    combo: { alt: true, key: '=' },
    run: (ctx) => ctx.actions.sumSelection(),
    preventDefault: true,
  },
  {
    id: 'delete-row',
    type: 'combo',
    scope: 'sheet',
    label: 'Delete Row',
    combo: { ctrl: true, key: '-' },
    when: (ctx) => ctx.selection.isFullRow,
    run: (ctx) => ctx.actions.deleteSelectedRows(),
    preventDefault: true,
  },
  {
    id: 'delete-column',
    type: 'combo',
    scope: 'sheet',
    label: 'Delete Column',
    combo: { ctrl: true, key: '-' },
    when: (ctx) => ctx.selection.isFullColumn,
    run: (ctx) => ctx.actions.deleteSelectedColumns(),
    preventDefault: true,
  },

  // ── Ctrl ribbon sequences ──
  {
    id: 'paste-special-values',
    type: 'sequence',
    scope: 'sheet',
    label: 'Paste Special Values',
    sequence: ['ctrl', 'e', 's', 'v'],
    run: (ctx) => ctx.actions.showPlaceholder('Paste Special Values'),
    preventDefault: true,
  },
  {
    id: 'paste-special-formatting',
    type: 'sequence',
    scope: 'sheet',
    label: 'Paste Special Formatting',
    sequence: ['ctrl', 'e', 's', 'f'],
    run: (ctx) => ctx.actions.showPlaceholder('Paste Special Formatting'),
    preventDefault: true,
  },
  {
    id: 'percentage',
    type: 'sequence',
    scope: 'sheet',
    label: 'Percentage',
    sequence: ['ctrl', 'h', 'p'],
    run: (ctx) => ctx.actions.showPlaceholder('Percentage Format'),
    preventDefault: true,
  },

  // ── Alt ribbon sequences ──
  {
    id: 'number-format',
    type: 'sequence',
    scope: 'sheet',
    label: 'Number Format',
    sequence: ['alt', 'h', 'k'],
    run: (ctx) => ctx.actions.showPlaceholder('Number Format'),
    preventDefault: true,
  },
  {
    id: 'reduce-decimals',
    type: 'sequence',
    scope: 'sheet',
    label: 'Reduce Decimals',
    sequence: ['alt', 'h', '9'],
    run: (ctx) => ctx.actions.showPlaceholder('Reduce Decimals'),
    preventDefault: true,
  },
  {
    id: 'freeze-panes',
    type: 'sequence',
    scope: 'sheet',
    label: 'Freeze Panes',
    sequence: ['alt', 'w', 'f', 'f'],
    run: (ctx) => ctx.actions.showPlaceholder('Freeze Panes'),
    preventDefault: true,
  },
  {
    id: 'font-selection',
    type: 'sequence',
    scope: 'sheet',
    label: 'Font Selection',
    sequence: ['alt', 'h', 'f', 'f'],
    run: (ctx) => ctx.actions.showPlaceholder('Font Selection'),
    preventDefault: true,
  },
  {
    id: 'font-size',
    type: 'sequence',
    scope: 'sheet',
    label: 'Font Size',
    sequence: ['alt', 'h', 'f', 's'],
    run: (ctx) => ctx.actions.showPlaceholder('Font Size'),
    preventDefault: true,
  },
  {
    id: 'wrap-text',
    type: 'sequence',
    scope: 'sheet',
    label: 'Wrap Text',
    sequence: ['alt', 'h', 'w'],
    run: (ctx) => ctx.actions.showPlaceholder('Wrap Text'),
    preventDefault: true,
  },
  {
    id: 'merge-centre',
    type: 'sequence',
    scope: 'sheet',
    label: 'Merge & Centre',
    sequence: ['alt', 'h', 'm', 'c'],
    run: (ctx) => ctx.actions.showPlaceholder('Merge & Centre'),
    preventDefault: true,
  },
  {
    id: 'align-left',
    type: 'sequence',
    scope: 'sheet',
    label: 'Left Alignment',
    sequence: ['alt', 'h', 'a', 'l'],
    run: (ctx) => ctx.actions.showPlaceholder('Left Alignment'),
    preventDefault: true,
  },
  {
    id: 'align-right',
    type: 'sequence',
    scope: 'sheet',
    label: 'Right Alignment',
    sequence: ['alt', 'h', 'a', 'r'],
    run: (ctx) => ctx.actions.showPlaceholder('Right Alignment'),
    preventDefault: true,
  },
  {
    id: 'align-centre',
    type: 'sequence',
    scope: 'sheet',
    label: 'Centre Alignment',
    sequence: ['alt', 'h', 'a', 'c'],
    run: (ctx) => ctx.actions.showPlaceholder('Centre Alignment'),
    preventDefault: true,
  },
  {
    id: 'border-bottom',
    type: 'sequence',
    scope: 'sheet',
    label: 'Bottom Border',
    sequence: ['alt', 'h', 'b', 'o'],
    run: (ctx) => ctx.actions.showPlaceholder('Bottom Border'),
    preventDefault: true,
  },
  {
    id: 'border-top',
    type: 'sequence',
    scope: 'sheet',
    label: 'Top Border',
    sequence: ['alt', 'h', 'b', 'p'],
    run: (ctx) => ctx.actions.showPlaceholder('Top Border'),
    preventDefault: true,
  },
  {
    id: 'fill-color',
    type: 'sequence',
    scope: 'sheet',
    label: 'Fill Color',
    sequence: ['alt', 'h', 'h'],
    run: (ctx) => ctx.actions.showPlaceholder('Fill Color'),
    preventDefault: true,
  },
  {
    id: 'font-color',
    type: 'sequence',
    scope: 'sheet',
    label: 'Font Color',
    sequence: ['alt', 'h', 'f', 'c'],
    run: (ctx) => ctx.actions.showPlaceholder('Font Color'),
    preventDefault: true,
  },
];

// ─── Sequence Index ─────────────────────────────────────────────────────────

interface SequenceIndex {
  exact: Map<string, ShortcutDef>;
  prefixes: Set<string>;
}

function buildSequenceIndex(shortcuts: ShortcutDef[]): SequenceIndex {
  const exact = new Map<string, ShortcutDef>();
  const prefixes = new Set<string>();

  for (const s of shortcuts) {
    if (s.type !== 'sequence' || !s.sequence) continue;
    const key = s.sequence.join(' ');
    exact.set(key, s);
    // Build all prefixes
    for (let i = 1; i < s.sequence.length; i++) {
      prefixes.add(s.sequence.slice(0, i).join(' '));
    }
  }

  return { exact, prefixes };
}

// ─── Combo Matching ─────────────────────────────────────────────────────────

function matchCombo(e: KeyboardEvent, shortcuts: ShortcutDef[]): ShortcutDef | null {
  const key = normalizeKey(e);
  if (isModifierKey(key)) return null;

  for (const s of shortcuts) {
    if (s.type !== 'combo' || !s.combo) continue;
    const c = s.combo;
    if ((c.ctrl ?? false) !== e.ctrlKey) continue;
    if ((c.alt ?? false) !== e.altKey) continue;
    if ((c.shift ?? false) !== e.shiftKey) continue;
    if ((c.meta ?? false) !== e.metaKey) continue;
    if (c.key !== key) continue;
    return s;
  }
  return null;
}

// ─── Scope Matching ─────────────────────────────────────────────────────────

function scopeAllows(shortcut: ShortcutDef, scope: 'sheet' | 'text'): boolean {
  if (shortcut.scope === 'both') return true;
  return shortcut.scope === scope;
}

// Text-scope allowlist: only these combo IDs are allowed when inside editable text
const TEXT_EDITABLE_ALLOWLIST = new Set(['copy', 'paste']);

// ─── Manager Class ──────────────────────────────────────────────────────────

export type ContextProvider = () => ShortcutContext | null;

export class KeyboardShortcutManager {
  private shortcuts: ShortcutDef[];
  private sequenceIndex: SequenceIndex;
  private buffer: string[] = [];
  private bufferTimer: ReturnType<typeof setTimeout> | null = null;
  private bufferTimeoutMs = 1000;
  private contextProvider: ContextProvider | null = null;
  private activeModifier: string | null = null;
  private onSequenceChange: ((tokens: string[]) => void) | null = null;

  constructor(shortcuts?: ShortcutDef[]) {
    this.shortcuts = shortcuts ?? [...DEFAULT_SHORTCUTS];
    this.sequenceIndex = buildSequenceIndex(this.shortcuts);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
  }

  setContextProvider(fn: ContextProvider) {
    this.contextProvider = fn;
  }

  setSequenceChangeCallback(fn: ((tokens: string[]) => void) | null) {
    this.onSequenceChange = fn;
  }

  attach() {
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
  }

  detach() {
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    this.resetBuffer();
  }

  addShortcut(def: ShortcutDef) {
    this.shortcuts.push(def);
    this.sequenceIndex = buildSequenceIndex(this.shortcuts);
  }

  removeShortcut(id: string) {
    this.shortcuts = this.shortcuts.filter((s) => s.id !== id);
    this.sequenceIndex = buildSequenceIndex(this.shortcuts);
  }

  private resetBuffer() {
    this.buffer = [];
    this.activeModifier = null;
    if (this.bufferTimer) clearTimeout(this.bufferTimer);
    this.bufferTimer = null;
    this.onSequenceChange?.([]);
  }

  private bumpTimeout() {
    if (this.bufferTimer) clearTimeout(this.bufferTimer);
    this.bufferTimer = setTimeout(() => this.resetBuffer(), this.bufferTimeoutMs);
  }

  private onKeyUp(e: KeyboardEvent) {
    // Track modifier release for sequences
    const key = normalizeKey(e);
    if (key === 'control' || key === 'alt') {
      // Modifier released — if buffer has entries from this modifier, keep them
      // but clear the activeModifier so next non-mod key without modifier won't get prefixed
      if (this.activeModifier === key) {
        this.activeModifier = null;
      }
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    // Determine scope
    const activeEl = document.activeElement;
    const scope = getScopeFromElement(activeEl);

    // Outside any scope → don't handle
    if (!scope) {
      // If we had an active buffer, clear it
      if (this.buffer.length > 0) this.resetBuffer();
      return;
    }

    const editable = isTextEditable(activeEl);
    const key = normalizeKey(e);

    // ── Handle pure modifier press (start of sequence) ──
    if (isModifierKey(key)) {
      // Alt or Ctrl alone pressed — start/continue sequence tracking
      const modName = key === 'control' ? 'ctrl' : key;
      if (this.buffer.length === 0) {
        this.activeModifier = modName;
        this.buffer.push(modName);
        this.bumpTimeout();
        this.onSequenceChange?.([...this.buffer]);
      }
      return;
    }

    // ── Try combo match first (only if no active sequence buffer > 1) ──
    if (this.buffer.length <= 1) {
      const comboMatch = matchCombo(e, this.shortcuts);
      if (comboMatch && scopeAllows(comboMatch, scope)) {
        // Editable safety check
        if (editable && scope === 'sheet') {
          this.resetBuffer();
          return; // Don't steal from cell editors in sheet
        }
        if (editable && scope === 'text' && !TEXT_EDITABLE_ALLOWLIST.has(comboMatch.id)) {
          this.resetBuffer();
          return; // Only allow allowlisted shortcuts in text editors
        }

        // Get context for guard check
        const ctx = this.contextProvider?.();
        if (!ctx) {
          this.resetBuffer();
          return;
        }
        ctx.scope = scope;

        // Check guard
        if (comboMatch.when && !comboMatch.when(ctx)) {
          // Guard failed — don't fire but don't consume the event either
          // Check if another combo with same keys but different guard matches
          const otherMatch = this.shortcuts.find(
            (s) =>
              s.type === 'combo' &&
              s.id !== comboMatch.id &&
              s.combo &&
              s.combo.key === comboMatch.combo!.key &&
              (s.combo.ctrl ?? false) === e.ctrlKey &&
              (s.combo.alt ?? false) === e.altKey &&
              (s.combo.shift ?? false) === e.shiftKey &&
              scopeAllows(s, scope) &&
              (!s.when || s.when(ctx))
          );
          if (otherMatch) {
            if (otherMatch.preventDefault) e.preventDefault();
            e.stopPropagation();
            otherMatch.run(ctx);
            this.resetBuffer();
            return;
          }
          // No match — fall through
          this.resetBuffer();
          return;
        }

        if (comboMatch.preventDefault) e.preventDefault();
        e.stopPropagation();
        comboMatch.run(ctx);
        this.resetBuffer();
        return;
      }
    }

    // ── Sequence handling ──

    // Editable safety for sequences
    if (editable && scope === 'sheet') {
      this.resetBuffer();
      return;
    }

    // Determine if we should continue the sequence
    // If buffer is empty and a modifier is being held, start sequence
    if (this.buffer.length === 0) {
      if (e.ctrlKey) {
        this.buffer.push('ctrl');
      } else if (e.altKey) {
        this.buffer.push('alt');
      } else {
        // No modifier held and no existing buffer — not a sequence
        return;
      }
    }

    // Append the current non-modifier key
    this.buffer.push(key);
    this.bumpTimeout();
    this.onSequenceChange?.([...this.buffer]);

    const bufferKey = this.buffer.join(' ');

    // Check exact match
    const exactMatch = this.sequenceIndex.exact.get(bufferKey);
    if (exactMatch && scopeAllows(exactMatch, scope)) {
      const ctx = this.contextProvider?.();
      if (ctx) {
        ctx.scope = scope;
        if (!exactMatch.when || exactMatch.when(ctx)) {
          if (exactMatch.preventDefault) e.preventDefault();
          e.stopPropagation();
          exactMatch.run(ctx);
          this.resetBuffer();
          return;
        }
      }
    }

    // Check prefix match — keep waiting
    if (this.sequenceIndex.prefixes.has(bufferKey)) {
      // Prevent default to avoid browser menu activation (especially for Alt sequences)
      e.preventDefault();
      return;
    }

    // No match at all — reset
    this.resetBuffer();
  }
}
