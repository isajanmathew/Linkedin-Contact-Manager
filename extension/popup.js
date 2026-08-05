document.addEventListener('DOMContentLoaded', () => {
  const actionBtn = document.getElementById('actionBtn');

  actionBtn.addEventListener('click', async () => {
    // Example: get the current tab and send a message
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (response) => {
      console.log('Response from content script:', response);
    });
  });
});
