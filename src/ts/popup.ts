document.addEventListener('DOMContentLoaded', async () => {
  const captureVisibleButton = document.getElementById('captureVisible');
  const captureFullPageButton = document.getElementById('captureFullPage');
  const optionsLink = document.getElementById('optionsLink');
  const selectionDiv = document.getElementById('selectionDiv');
  const messageArea = document.getElementById('messageArea');

  if (optionsLink) {
    optionsLink.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  // chrome.storage.sync.get の戻り値の型定義
  const settings: { defaultCaptureMode?: string } = await chrome.storage.sync.get(['defaultCaptureMode']);
  const mode = settings.defaultCaptureMode;

  if (messageArea) {
    if (mode === 'visible') {
      messageArea.textContent = '表示範囲を撮影中です...';
      chrome.runtime.sendMessage({ action: "captureVisible" }, () => window.close());
    } else if (mode === 'fullPage') {
      messageArea.textContent = 'ページ全体を撮影中です...';
      chrome.runtime.sendMessage({ action: "captureFullPage" }, () => window.close());
    } else { // 'ask' または未設定の場合
      if (selectionDiv) selectionDiv.style.display = 'block';
    }
  }

  if (captureVisibleButton) {
    captureVisibleButton.addEventListener('click', () => {
      if (messageArea) messageArea.textContent = '表示範囲を撮影中です...';
      chrome.runtime.sendMessage({ action: "captureVisible" }, () => window.close());
    });
  }

  if (captureFullPageButton) {
    captureFullPageButton.addEventListener('click', () => {
      if (messageArea) messageArea.textContent = 'ページ全体を撮影中です...';
      chrome.runtime.sendMessage({ action: "captureFullPage" }, () => window.close());
    });
  }
});
