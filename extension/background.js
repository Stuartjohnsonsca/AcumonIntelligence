/**
 * Acumon Screen Capture — Background Service Worker
 * Handles captureVisibleTab requests from the content script.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'captureTab' && sender.tab) {
    // Try captureVisibleTab with null windowId (current window)
    try {
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error('[Acumon Capture] captureVisibleTab error:', chrome.runtime.lastError.message);
          // Fallback: try with explicit window ID
          chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl2) => {
            if (chrome.runtime.lastError) {
              console.error('[Acumon Capture] Fallback also failed:', chrome.runtime.lastError.message);
              sendResponse({ error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ dataUrl: dataUrl2 });
            }
          });
        } else {
          sendResponse({ dataUrl });
        }
      });
    } catch (err) {
      console.error('[Acumon Capture] Exception:', err);
      sendResponse({ error: String(err) });
    }
    return true; // Keep message channel open for async response
  }
});

// Also allow capture via the extension icon click (grants activeTab)
chrome.action = chrome.action || {};
if (chrome.action.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
      if (!chrome.runtime.lastError && dataUrl) {
        chrome.tabs.sendMessage(tab.id, { type: 'ACUMON_CAPTURE_FROM_ICON', dataUrl });
      }
    });
  });
}
