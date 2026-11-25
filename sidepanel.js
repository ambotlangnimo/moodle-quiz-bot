const logElement = document.getElementById('log');

function renderLogLines(lines) {
  logElement.textContent = '';
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) {
    logElement.textContent = 'Waiting for logs...';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const raw of list) {
    const text = String(raw || '');
    const div = document.createElement('div');
    let cls = 'log-info';
    if (/\[ERROR\]/i.test(text)) cls = 'log-error';
    else if (/\[WARN\]/i.test(text)) cls = 'log-warn';
    else if (/\[SUCCESS\]/i.test(text)) cls = 'log-success';
    div.className = cls;
    div.textContent = text;
    frag.appendChild(div);
  }
  logElement.appendChild(frag);
  logElement.scrollTop = logElement.scrollHeight;
}

document.getElementById('clearBtn').addEventListener('click', async () => {
  logElement.textContent = 'Waiting for logs...';
  try {
    await chrome.storage.local.set({ _sidepanel_log: [] });
  } catch (error) { /* ignore */ }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.action !== 'log') return;
  if (logElement.textContent === 'Waiting for logs...') logElement.textContent = '';
  const line = document.createElement('div');
  line.className = 'log-' + (message.level || 'info');
  line.textContent = message.text;
  logElement.appendChild(line);
  logElement.scrollTop = logElement.scrollHeight;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes._sidepanel_log) return;
  renderLogLines(changes._sidepanel_log.newValue || []);
});

// Hydrate persisted log buffer immediately when the panel opens.
chrome.storage.local.get('_sidepanel_log', (stored) => {
  if (chrome.runtime && chrome.runtime.lastError) return;
  if (stored && Array.isArray(stored._sidepanel_log) && stored._sidepanel_log.length) {
    renderLogLines(stored._sidepanel_log);
  }
});
