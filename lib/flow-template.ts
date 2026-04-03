/**
 * Flow Template Resolution
 *
 * Resolves {{placeholder}} tokens in prompt templates and request messages
 * using the accumulated execution context.
 */

export interface ExecutionContext {
  engagement: {
    clientName: string;
    periodStart: string;
    periodEnd: string;
    materiality: number;
    performanceMateriality: number;
    clearlyTrivial: number;
    framework: string;
    auditType: string;
  };
  test: {
    description: string;
    fsLine: string;
    assertion: string;
  };
  nodes: Record<string, any>;    // outputs keyed by nodeId
  vars: Record<string, any>;     // flow-level variables — persist across nodes and sub-flows
  loop?: {
    currentItem: any;
    index: number;
  };
}

/**
 * Resolve all {{path.to.value}} placeholders in a template string.
 *
 * Supports:
 *   {{engagement.clientName}}
 *   {{test.description}}
 *   {{input.<key>}}         — resolved from executionDef.inputs via context
 *   {{nodes.<nodeId>}}      — output from a specific node
 *   {{loop.currentItem}}
 *   {{loop.index}}
 */
export function resolveTemplate(template: string, ctx: ExecutionContext, inputBindings?: Record<string, any>): string {
  if (!template) return '';

  return template.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
    const trimmed = path.trim();
    const parts = trimmed.split('.');

    // {{engagement.xxx}}
    if (parts[0] === 'engagement' && parts.length >= 2) {
      const val = (ctx.engagement as any)?.[parts[1]];
      return val != null ? String(val) : match;
    }

    // {{test.xxx}}
    if (parts[0] === 'test' && parts.length >= 2) {
      const val = (ctx.test as any)?.[parts[1]];
      return val != null ? String(val) : match;
    }

    // {{input.xxx}} — resolved from input bindings
    if (parts[0] === 'input' && parts.length >= 2) {
      const key = parts[1];
      if (inputBindings && key in inputBindings) {
        const val = inputBindings[key];
        return typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
      }
      return match;
    }

    // {{vars.<key>}} — flow-level variables
    if (parts[0] === 'vars' && parts.length >= 2) {
      const val = ctx.vars?.[parts[1]];
      return val != null ? String(val) : match;
    }

    // {{nodes.<nodeId>}} or {{nodes.<nodeId>.<field>}}
    if (parts[0] === 'nodes' && parts.length >= 2) {
      const nodeOutput = ctx.nodes[parts[1]];
      if (parts.length === 2) {
        return typeof nodeOutput === 'object' ? JSON.stringify(nodeOutput) : String(nodeOutput ?? '');
      }
      const field = parts[2];
      return nodeOutput?.[field] != null ? String(nodeOutput[field]) : match;
    }

    // {{loop.currentItem}} / {{loop.currentItem.FieldName}} / {{loop.index}}
    if (parts[0] === 'loop') {
      if (parts[1] === 'currentItem') {
        const val = ctx.loop?.currentItem;
        if (val == null) return match;

        // {{loop.currentItem.FieldName}} — access specific field with semantic fallbacks
        if (parts.length >= 3) {
          const field = parts[2];
          // Direct match
          if (val[field] != null) return typeof val[field] === 'object' ? JSON.stringify(val[field]) : String(val[field]);
          // Case-insensitive match
          const key = Object.keys(val).find(k => k.toLowerCase() === field.toLowerCase());
          if (key) return String(val[key] ?? '');
          // Semantic fallbacks — common audit field aliases
          const aliases: Record<string, string[]> = {
            amount: ['Total', 'Gross', 'LineAmount', 'InvoiceAmountDue', 'Amount', 'Net', 'UnitAmount', 'SubTotal'],
            customer: ['ContactName', 'Customer', 'ClientName', 'Name', 'Debtor', 'Supplier', 'Vendor'],
            reference: ['Reference', 'Ref', 'InvoiceNumber', 'Invoice', 'TransactionId', 'ID', 'Number'],
            description: ['Description', 'Desc', 'Narrative', 'Details', 'Memo'],
            date: ['InvoiceDate', 'Date', 'TransactionDate', 'TxnDate', 'DueDate'],
            net: ['LineAmount', 'Net', 'SubTotal', 'UnitAmount'],
            tax: ['TaxTotal', 'TaxAmount', 'Tax', 'VAT'],
            gross: ['Total', 'Gross', 'InvoiceAmountDue', 'Amount'],
            type: ['Type', 'TransactionType', 'DocType'],
            status: ['Status', 'State'],
          };
          const fieldLower = field.toLowerCase();
          const aliasList = aliases[fieldLower];
          if (aliasList) {
            for (const alias of aliasList) {
              const aliasKey = Object.keys(val).find(k => k.toLowerCase() === alias.toLowerCase());
              if (aliasKey && val[aliasKey] != null) return String(val[aliasKey]);
            }
          }
          return match; // Unresolved
        }

        // {{loop.currentItem}} alone — extract readable summary from object
        if (typeof val === 'object') {
          return summariseItem(val);
        }
        return String(val);
      }
      if (parts[1] === 'index') {
        return String(ctx.loop?.index ?? 0);
      }
      if (parts[1] === 'position') {
        return String((ctx.loop?.index ?? 0) + 1);
      }
      if (parts[1] === 'total') {
        return String(ctx.vars?.sampleCount || ctx.vars?.populationCount || '');
      }
    }

    // Unresolved — leave as-is
    return match;
  });
}

/**
 * Resolve input bindings for a node.
 *
 * Each input in executionDef.inputs has a `key` and optionally a `binding`.
 * Auto-bindings resolve from the previous node's output.
 * Named keys resolve from engagement context or specific node outputs.
 */
export function resolveInputs(
  inputs: { key: string; label: string; binding?: string }[] | undefined,
  ctx: ExecutionContext,
  previousNodeId?: string,
): Record<string, any> {
  if (!inputs || inputs.length === 0) return {};

  const resolved: Record<string, any> = {};

  for (const input of inputs) {
    const { key, binding } = input;

    // Auto bindings — grab from previous node
    if (binding?.startsWith('auto')) {
      if (previousNodeId && ctx.nodes[previousNodeId]) {
        const prevOutput = ctx.nodes[previousNodeId];
        if (binding === 'auto' || binding === 'auto:ai_result') {
          resolved[key] = prevOutput;
        } else if (binding === 'auto:portal_file') {
          resolved[key] = prevOutput?.files || prevOutput?.uploadedFile || prevOutput;
        } else if (binding === 'auto:portal_text') {
          resolved[key] = prevOutput?.response || prevOutput?.text || prevOutput;
        } else if (binding === 'auto:pass_through') {
          resolved[key] = prevOutput?.verifiedData || prevOutput;
        } else {
          resolved[key] = prevOutput;
        }
      }
      continue;
    }

    // TB bindings
    if (key.startsWith('tb_')) {
      const tbField = key.replace('tb_', '');
      resolved[key] = (ctx.engagement as any)?.[tbField] || `[${key}]`;
      continue;
    }

    // Materiality bindings
    if (key === 'materiality') { resolved[key] = ctx.engagement.materiality; continue; }
    if (key === 'performance_materiality') { resolved[key] = ctx.engagement.performanceMateriality; continue; }
    if (key === 'clearly_trivial') { resolved[key] = ctx.engagement.clearlyTrivial; continue; }

    // Engagement context
    if (key === 'client_name') { resolved[key] = ctx.engagement.clientName; continue; }
    if (key === 'period_start') { resolved[key] = ctx.engagement.periodStart; continue; }
    if (key === 'period_end') { resolved[key] = ctx.engagement.periodEnd; continue; }
    if (key === 'audit_type') { resolved[key] = ctx.engagement.auditType; continue; }
    if (key === 'framework') { resolved[key] = ctx.engagement.framework; continue; }

    // If the key matches a node ID in context, grab its output
    if (ctx.nodes[key]) {
      resolved[key] = ctx.nodes[key];
      continue;
    }

    // Unresolved — mark as placeholder
    resolved[key] = `[${key}]`;
  }

  return resolved;
}

/**
 * Extract a human-readable summary from a data row object.
 * Prioritises audit-relevant fields: customer, date, description, amounts.
 */
function summariseItem(item: Record<string, any>): string {
  // Find key fields by common names (case-insensitive)
  const find = (...names: string[]): string => {
    for (const name of names) {
      const key = Object.keys(item).find(k => k.toLowerCase() === name.toLowerCase());
      if (key && item[key] != null && String(item[key]).trim()) return String(item[key]);
    }
    return '';
  };

  const customer = find('ContactName', 'Customer', 'ClientName', 'Name', 'Debtor', 'Creditor', 'Supplier', 'Vendor');
  const ref = find('Reference', 'Ref', 'InvoiceNumber', 'Invoice', 'TransactionId', 'ID', 'Number');
  const desc = find('Description', 'Desc', 'Narrative', 'Details', 'Memo');
  const date = find('InvoiceDate', 'Date', 'TransactionDate', 'TxnDate');
  const gross = find('Total', 'Gross', 'Amount', 'InvoiceAmountDue', 'LineAmount');
  const net = find('LineAmount', 'Net', 'SubTotal', 'UnitAmount');
  const tax = find('TaxTotal', 'TaxAmount', 'Tax', 'VAT');

  const parts: string[] = [];
  if (customer) parts.push(customer);
  if (ref) parts.push(`Ref: ${ref}`);
  if (date) parts.push(`Date: ${date}`);
  if (desc) parts.push(desc);
  if (net) parts.push(`Net: ${net}`);
  if (tax) parts.push(`VAT: ${tax}`);
  if (gross) parts.push(`Gross: ${gross}`);

  return parts.length > 0 ? parts.join(', ') : JSON.stringify(item).substring(0, 200);
}
