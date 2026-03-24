'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import {
  KeyboardShortcutManager,
  getScopeFromElement,
  type ShortcutActions,
  type ShortcutContext,
  type SelectionState,
} from '@/lib/keyboard-shortcuts';
import { useToast } from '@/components/ui/use-toast';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScopeRegistration {
  actions: ShortcutActions;
  getSelection: () => SelectionState;
}

interface KeyboardShortcutContextValue {
  registerScope: (scopeId: string, registration: ScopeRegistration) => void;
  unregisterScope: (scopeId: string) => void;
  manager: KeyboardShortcutManager;
  sequenceBuffer: string[];
}

const EMPTY_SELECTION: SelectionState = {
  type: 'none',
  cells: [],
  isFullRow: false,
  isFullColumn: false,
  selectedRows: [],
  selectedCols: [],
  getValues: () => [],
};

// ─── Context ────────────────────────────────────────────────────────────────

const KeyboardShortcutContext = createContext<KeyboardShortcutContextValue | null>(null);

export function useKeyboardShortcutContext() {
  const ctx = useContext(KeyboardShortcutContext);
  if (!ctx) {
    throw new Error('useKeyboardShortcutContext must be used within KeyboardShortcutProvider');
  }
  return ctx;
}

// ─── Provider ───────────────────────────────────────────────────────────────

export function KeyboardShortcutProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [sequenceBuffer, setSequenceBuffer] = useState<string[]>([]);
  const scopesRef = useRef<Map<string, ScopeRegistration>>(new Map());
  const managerRef = useRef<KeyboardShortcutManager | null>(null);

  // Lazily create manager
  if (!managerRef.current) {
    managerRef.current = new KeyboardShortcutManager();
  }
  const manager = managerRef.current;

  const registerScope = useCallback((scopeId: string, registration: ScopeRegistration) => {
    scopesRef.current.set(scopeId, registration);
  }, []);

  const unregisterScope = useCallback((scopeId: string) => {
    scopesRef.current.delete(scopeId);
  }, []);

  // Set up the context provider function that the manager calls
  useEffect(() => {
    const toastFn = toast;

    manager.setContextProvider((): ShortcutContext | null => {
      const activeEl = document.activeElement;
      const scope = getScopeFromElement(activeEl);
      if (!scope) return null;

      // Find the scope registration for the active element
      // Walk up to find the scope element and its ID
      const scopeEl = (activeEl as HTMLElement)?.closest?.('[data-kb-scope]');
      const scopeId = scopeEl?.getAttribute('data-kb-scope-id') ?? '';

      const registration = scopesRef.current.get(scopeId);
      if (!registration) {
        // Fallback: try to find any registration
        const firstReg = scopesRef.current.values().next().value as ScopeRegistration | undefined;
        if (!firstReg) return null;
        const sel = firstReg.getSelection();
        return {
          scope,
          selection: sel,
          actions: firstReg.actions,
        };
      }

      const sel = registration.getSelection();
      return {
        scope,
        selection: sel,
        actions: registration.actions,
      };
    });

    manager.setSequenceChangeCallback((tokens) => {
      setSequenceBuffer([...tokens]);
    });

    manager.attach();

    return () => {
      manager.detach();
    };
  }, [manager, toast]);

  return (
    <KeyboardShortcutContext.Provider
      value={{ registerScope, unregisterScope, manager, sequenceBuffer }}
    >
      {children}
      {/* Sequence buffer indicator */}
      {sequenceBuffer.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-800 text-white px-3 py-1.5 rounded-md text-sm font-mono shadow-lg animate-in fade-in duration-150">
          {sequenceBuffer.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(' + ')}
          <span className="ml-1 animate-pulse">...</span>
        </div>
      )}
    </KeyboardShortcutContext.Provider>
  );
}
