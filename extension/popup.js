const toggleButton = document.getElementById('toggleBtn');

toggleButton.addEventListener('click', async () => {
  const result = await chrome.storage.sync.get('BOT_ENABLED');
  const enabled = result.BOT_ENABLED !== false;
  await chrome.storage.sync.set({ BOT_ENABLED: !enabled });
  toggleButton.textContent = !enabled ? 'Enable' : 'Disable';
  toggleButton.className = 'btn' + (!enabled ? ' active' : '');
});

document.getElementById('optionsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.sync.get('BOT_ENABLED', (result) => {
  const enabled = result.BOT_ENABLED !== false;
  toggleButton.textContent = enabled ? 'Disable' : 'Enable';
  toggleButton.className = 'btn' + (enabled ? ' active' : '');
});
