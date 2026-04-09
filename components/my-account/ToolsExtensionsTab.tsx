'use client';

import { useState, useEffect } from 'react';
import { Download, CheckCircle2, Monitor, Globe, Apple, Smartphone, ChevronDown, ChevronRight, Camera, Clipboard } from 'lucide-react';

const EXTENSION_VERSION = '1.0.0';
const EXTENSION_URL = `/extensions/acumon-capture-v1.0.0.zip`;

interface PlatformInstruction {
  platform: string;
  icon: React.ReactNode;
  method: 'extension' | 'clipboard';
  browser: string;
  steps: string[];
  shortcut?: string;
}

const INSTRUCTIONS: PlatformInstruction[] = [
  {
    platform: 'Windows', icon: <Monitor className="h-4 w-4" />, method: 'extension', browser: 'Chrome & Edge',
    steps: [
      'Download the extension package below',
      'Extract the ZIP to a folder (right-click → Extract All)',
      'Double-click "Install Acumon Capture.bat" in the extracted folder',
      'The installer registers the extension with Chrome and Edge automatically',
      'Restart your browser — the extension will be active on Acumon pages',
    ],
  },
  {
    platform: 'Windows', icon: <Monitor className="h-4 w-4" />, method: 'clipboard', browser: 'Any browser',
    shortcut: 'Win + Shift + S',
    steps: [
      'Press Win + Shift + S to open the Snipping Tool',
      'Select the region of the screen you want to capture',
      'Click the camera button on the flowchart step',
      'Click "Paste from Clipboard" or press Ctrl + V',
    ],
  },
  {
    platform: 'Mac', icon: <Apple className="h-4 w-4" />, method: 'extension', browser: 'Chrome & Edge',
    steps: [
      'Download the extension package below',
      'Extract the ZIP (double-click in Finder)',
      'Open Terminal in the extracted folder',
      'Run: chmod +x install.sh && ./install.sh (if available), or:',
      'Open Chrome → chrome://extensions → Enable Developer Mode → Load unpacked → select folder',
      'Restart your browser',
    ],
  },
  {
    platform: 'Mac', icon: <Apple className="h-4 w-4" />, method: 'clipboard', browser: 'Safari / Any browser',
    shortcut: 'Cmd + Shift + 4',
    steps: [
      'Press Cmd + Shift + 4 to enter region capture mode',
      'Drag to select the area (saved to clipboard if Ctrl held, or Desktop)',
      'In Acumon, click the camera button on the flowchart step',
      'Press Cmd + V to paste the screenshot',
    ],
  },
  {
    platform: 'iOS / iPad', icon: <Smartphone className="h-4 w-4" />, method: 'clipboard', browser: 'Safari',
    steps: [
      'Take a screenshot (Power + Volume Up, or AssistiveTouch)',
      'Tap the preview thumbnail and crop if needed',
      'Copy to clipboard (tap Share → Copy)',
      'In Acumon, click the camera button and paste',
    ],
  },
  {
    platform: 'Android', icon: <Smartphone className="h-4 w-4" />, method: 'clipboard', browser: 'Chrome',
    steps: [
      'Take a screenshot (Power + Volume Down)',
      'Open the screenshot in Gallery and crop if needed',
      'Copy to clipboard (Share → Copy)',
      'In Acumon, click the camera button and paste',
    ],
  },
];

export function ToolsExtensionsTab() {
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [detectedVersion, setDetectedVersion] = useState('');
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);

  useEffect(() => {
    const ver = document.documentElement.getAttribute('data-acumon-ext');
    if (ver) { setExtensionDetected(true); setDetectedVersion(ver); }
  }, []);

  const extensionPlatforms = INSTRUCTIONS.filter(i => i.method === 'extension');
  const clipboardPlatforms = INSTRUCTIONS.filter(i => i.method === 'clipboard');

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-slate-800">Tools & Extensions</h3>
        <p className="text-sm text-slate-500 mt-1">Browser tools to enhance your Acumon experience.</p>
      </div>

      {/* Extension Card */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <Camera className="h-6 w-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-800">Acumon Screen Capture</h4>
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-mono">v{EXTENSION_VERSION}</span>
              {extensionDetected ? (
                <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Installed{detectedVersion ? ` v${detectedVersion}` : ''}
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full font-medium">Not detected</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              One-click screen capture for methodology walkthroughs. Capture evidence directly from flowchart steps during Teams calls — no dialogs, no keyboard shortcuts required.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Works with Chrome and Microsoft Edge on Windows, Mac, and Linux.
            </p>
          </div>
          <a href={EXTENSION_URL} download className="shrink-0 px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 inline-flex items-center gap-2">
            <Download className="h-4 w-4" /> Download Extension
          </a>
        </div>

        {/* Installation Instructions */}
        <div className="border-t border-slate-100">
          <div className="px-5 py-3 bg-slate-50">
            <p className="text-xs font-semibold text-slate-600">Installation Instructions</p>
          </div>

          {/* Extension-based (Chrome/Edge) */}
          <div className="px-5 py-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Browser Extension (Recommended)</p>
            {extensionPlatforms.map((inst, i) => {
              const key = `ext-${inst.platform}-${inst.browser}`;
              const isOpen = expandedPlatform === key;
              return (
                <div key={i} className="mb-1">
                  <button onClick={() => setExpandedPlatform(isOpen ? null : key)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 text-left">
                    {isOpen ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                    {inst.icon}
                    <span className="text-xs text-slate-700">{inst.platform} — {inst.browser}</span>
                  </button>
                  {isOpen && (
                    <ol className="ml-10 mb-2 space-y-1">
                      {inst.steps.map((step, j) => (
                        <li key={j} className="text-xs text-slate-600 list-decimal">{step}</li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>

          {/* Clipboard-based (all platforms) */}
          <div className="px-5 py-2 border-t border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Clipboard Paste (No Extension Needed)</p>
            <p className="text-[10px] text-slate-500 mb-2">Works on all platforms and browsers. Use your system&apos;s built-in screenshot tool, then paste into Acumon.</p>
            {clipboardPlatforms.map((inst, i) => {
              const key = `clip-${inst.platform}-${inst.browser}`;
              const isOpen = expandedPlatform === key;
              return (
                <div key={i} className="mb-1">
                  <button onClick={() => setExpandedPlatform(isOpen ? null : key)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 text-left">
                    {isOpen ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                    {inst.icon}
                    <span className="text-xs text-slate-700">{inst.platform} — {inst.browser}</span>
                    {inst.shortcut && <kbd className="text-[9px] px-1.5 py-0.5 bg-slate-100 border rounded font-mono ml-1">{inst.shortcut}</kbd>}
                  </button>
                  {isOpen && (
                    <ol className="ml-10 mb-2 space-y-1">
                      {inst.steps.map((step, j) => (
                        <li key={j} className="text-xs text-slate-600 list-decimal">{step}</li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
