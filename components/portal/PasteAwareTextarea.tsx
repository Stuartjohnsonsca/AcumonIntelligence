'use client';

import { useRef } from 'react';

interface Props {
  value: string;
  onChange: (text: string) => void;
  onFilesAdded?: (files: File[]) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}

/**
 * Textarea that handles paste events:
 * - Plain text: inserts as normal
 * - Images (screenshots, copy from browser): converts to File attachment
 * - Rich text (Excel, Word): extracts plain text, saves HTML as attachment
 * - Files: adds as attachments
 */
export function PasteAwareTextarea({ value, onChange, onFilesAdded, placeholder, rows = 3, className }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const newFiles: File[] = [];

    // Check for pasted files (images, screenshots)
    if (clipboardData.files.length > 0) {
      e.preventDefault();
      for (const file of Array.from(clipboardData.files)) {
        // Rename generic "image.png" to something more descriptive
        const name = file.name === 'image.png'
          ? `pasted-image-${Date.now()}.png`
          : file.name;
        const renamedFile = new File([file], name, { type: file.type });
        newFiles.push(renamedFile);
      }
      if (newFiles.length > 0) {
        onFilesAdded?.(newFiles);
        // Add a note in the text
        const fileNames = newFiles.map(f => f.name).join(', ');
        const cursor = ref.current?.selectionStart ?? value.length;
        const before = value.slice(0, cursor);
        const after = value.slice(cursor);
        onChange(`${before}[Pasted: ${fileNames}]${after}`);
      }
      return;
    }

    // Check for rich HTML content (Excel, Word paste)
    const html = clipboardData.getData('text/html');
    const plainText = clipboardData.getData('text/plain');

    if (html && html.length > 100) {
      // Has substantial HTML — save as attachment and insert plain text
      e.preventDefault();

      // Create HTML file as attachment
      const blob = new Blob([html], { type: 'text/html' });
      const htmlFile = new File([blob], `pasted-content-${Date.now()}.html`, { type: 'text/html' });
      newFiles.push(htmlFile);

      // Also check if the HTML contains a table (Excel paste)
      if (html.includes('<table') || html.includes('<TABLE')) {
        // Convert HTML table to simple tab-separated text for readability
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const tables = doc.querySelectorAll('table');
        if (tables.length > 0) {
          const tableText = Array.from(tables[0].rows).map(row =>
            Array.from(row.cells).map(cell => cell.textContent?.trim() || '').join('\t')
          ).join('\n');
          onChange(value ? `${value}\n${tableText}` : tableText);
          onFilesAdded?.(newFiles);
          return;
        }
      }

      // Insert plain text version
      onChange(value ? `${value}\n${plainText}` : plainText);
      onFilesAdded?.(newFiles);
      return;
    }

    // Plain text paste — let browser handle normally
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      onPaste={handlePaste}
      placeholder={placeholder}
      rows={rows}
      className={className || 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y'}
    />
  );
}
