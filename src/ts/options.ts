document.addEventListener('DOMContentLoaded', () => {
  const defaultCaptureModeSelect = document.getElementById('defaultCaptureMode') as HTMLSelectElement;
  const saveSubfolderInput = document.getElementById('saveSubfolder') as HTMLInputElement;
  const saveButton = document.getElementById('saveOptions') as HTMLButtonElement;
  const statusDiv = document.getElementById('status') as HTMLDivElement;

  if (defaultCaptureModeSelect && saveSubfolderInput) {
    chrome.storage.sync.get(['defaultCaptureMode', 'saveSubfolder'], (items) => {
      defaultCaptureModeSelect.value = items.defaultCaptureMode || 'ask';
      saveSubfolderInput.value = items.saveSubfolder || '';
    });
  }

  if (saveButton) {
    saveButton.addEventListener('click', () => {
      const defaultCaptureMode = defaultCaptureModeSelect.value;
      const saveSubfolder = saveSubfolderInput.value.trim();

      chrome.storage.sync.set({
        defaultCaptureMode: defaultCaptureMode,
        saveSubfolder: saveSubfolder
      }, () => {
        statusDiv.textContent = '設定を保存しました。';
        setTimeout(() => { statusDiv.textContent = ''; }, 3000);
      });
    });
  }
});
