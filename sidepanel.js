const logElement = document.getElementById('log');

document.getElementById('clearBtn').addEventListener('click', () => {
  logElement.textContent = '';
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'log') return;
  const line = document.createElement('div');
  line.className = 'log-' + (message.level || 'info');
  line.textContent = message.text;
  logElement.appendChild(line);
  logElement.scrollTop = logElement.scrollHeight;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes._sidepanel_log) {
    const lines = changes._sidepanel_log.newValue || [];
    logElement.textContent = lines.join('\n');
  }
});
