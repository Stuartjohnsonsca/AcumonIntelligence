/**
 * Acumon Screen Capture — Content Script
 * Bridges communication between the Acumon web app and the background service worker.
 * Runs on Acumon pages only (defined in manifest.json content_scripts.matches).
 */

// Signal to the web app that the extension is installed (data attribute avoids CSP issues)
document.documentElement.setAttribute('data-acumon-ext', '1.0.0');

// Allowed origins for security
const ALLOWED_ORIGINS = [
  'https://acumon-intelligence.vercel.app',
  'https://www.acumonintelligence.com',
  'http://localhost:3000',
];

// Listen for capture requests from the web app
window.addEventListener('message', (event) => {
  // Validate origin
  if (!ALLOWED_ORIGINS.some(origin => event.origin === origin || event.origin.startsWith(origin))) return;
  if (event.data?.type !== 'ACUMON_CAPTURE_REQUEST') return;

  // Forward to background service worker
  chrome.runtime.sendMessage({ type: 'captureTab' }, (response) => {
    if (response?.dataUrl) {
      window.postMessage({ type: 'ACUMON_CAPTURE_RESULT', dataUrl: response.dataUrl }, event.origin);
    } else {
      window.postMessage({ type: 'ACUMON_CAPTURE_ERROR', error: response?.error || 'Capture failed' }, event.origin);
    }
  });
});
