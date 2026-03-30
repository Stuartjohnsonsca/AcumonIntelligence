import { useState, useEffect } from 'react';

const DEFAULT_TRIGGERS = [
  'On Start',
  'On Upload',
  'On Push to Portal',
  'On Verification',
  'On Portal Response',
  'On Section Sign Off',
];

/**
 * Hook to load the firm's configured action triggers from methodology admin.
 * Falls back to defaults if not configured.
 */
export function useActionTriggers() {
  const [triggers, setTriggers] = useState<string[]>(DEFAULT_TRIGGERS);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/methodology-admin/templates?templateType=action_triggers&auditType=ALL');
        if (res.ok) {
          const data = await res.json();
          const items = data.template?.items || data.items;
          if (Array.isArray(items) && items.length > 0) {
            setTriggers(items as string[]);
          }
        }
      } catch {}
    }
    load();
  }, []);

  return triggers;
}
