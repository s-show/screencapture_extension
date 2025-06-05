document.addEventListener('DOMContentLoaded', () => {
  const defaultCaptureModeSelect = document.getElementById('defaultCaptureMode') as HTMLSelectElement;
  const saveSubfolderInput = document.getElementById('saveSubfolder') as HTMLInputElement;
  const saveButton = document.getElementById('saveOptions') as HTMLButtonElement;
  const statusDiv = document.getElementById('status') as HTMLDivElement;

  const fullPageModeStitchRadio = document.getElementById('fullPageModeStitch') as HTMLInputElement | null;
  const fullPageModeSegmentsRadio = document.getElementById('fullPageModeSegments') as HTMLInputElement | null;

  // 設定値を読み込んで表示
  chrome.storage.sync.get(['defaultCaptureMode', 'saveSubfolder', 'fullPageMode'], (items) => {
    if (defaultCaptureModeSelect) {
        defaultCaptureModeSelect.value = items.defaultCaptureMode || 'ask';
    }
    if (saveSubfolderInput) {
        saveSubfolderInput.value = items.saveSubfolder || '';
    }
    if (items.fullPageMode === 'segments' && fullPageModeSegmentsRadio) {
        fullPageModeSegmentsRadio.checked = true;
    } else if (fullPageModeStitchRadio) { // デフォルトまたは 'stitch'
        fullPageModeStitchRadio.checked = true;
    }
  });

  if (saveButton) {
    saveButton.addEventListener('click', () => {
      const defaultCaptureMode = defaultCaptureModeSelect.value;
      const saveSubfolder = saveSubfolderInput.value.trim();
      let fullPageMode = 'stitch'; // デフォルト
      if (fullPageModeSegmentsRadio?.checked) {
        fullPageMode = 'segments';
      }

      chrome.storage.sync.set({
        defaultCaptureMode: defaultCaptureMode,
        saveSubfolder: saveSubfolder,
        fullPageMode: fullPageMode
      }, () => {
        statusDiv.textContent = '設定を保存しました。';
        setTimeout(() => {
          statusDiv.textContent = '';
        }, 3000);
      });
    });
  }
});
