// src/ts/background.ts

// メッセージの型定義
interface BaseRequest {
  action: string;
}
interface CaptureVisibleRequest extends BaseRequest {
  action: "captureVisible";
}
interface CaptureFullPageRequest extends BaseRequest {
  action: "captureFullPage";
}
// background.js が受信するメッセージの型
type ExtensionRequest = CaptureVisibleRequest | CaptureFullPageRequest;

// background.js が content_script.js に送信するメッセージの型
interface BackgroundMessageToCS {
  action: "getPageDetails" | "scrollToPosition";
  y?: number;
}

interface PageDetails {
  totalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

// FileReaderを使ってBlobをData URLに変換するヘルパー関数
function blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (reader.error) {
                console.error("FileReader error:", reader.error);
                reject(reader.error);
            } else {
                resolve(reader.result as string);
            }
        };
        reader.onerror = (errEvent) => { // FileReaderのエラーイベントを捕捉
            console.error("FileReader.onerror event triggered:", errEvent);
            // errEvent自体はProgressEventなので、reader.errorでエラーオブジェクトを取得
            reject(reader.error || new Error("FileReader unspecified error during readAsDataURL"));
        };
        reader.readAsDataURL(blob);
    });
}


chrome.runtime.onMessage.addListener(
  (request: ExtensionRequest, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void): boolean => {
    (async () => {
      if (request.action === "captureVisible") {
        await captureVisibleTab();
        sendResponse({ status: "visible capture processed" });
      } else if (request.action === "captureFullPage") {
        await captureFullPage();
        sendResponse({ status: "full page capture processed" });
      }
    })();
    return true; // 非同期処理のため true を返す
  }
);

async function getCurrentTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id === 'undefined') {
    const errorMsg = "アクティブなタブが見つかりません。";
    console.error(errorMsg);
    showNotification("エラー", errorMsg);
    throw new Error(errorMsg);
  }
  if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('file://') || tab.url.startsWith('about:'))) {
    const errorMsg = "このページではスクリーンショットを撮影できません: " + tab.url;
    console.error(errorMsg);
    showNotification("エラー", "このページではスクリーンショットを撮影できません。");
    throw new Error(errorMsg);
  }
  return tab;
}

async function captureVisibleTab(): Promise<void> {
  try {
    const tab = await getCurrentTab();
    if (typeof tab.windowId === 'undefined') {
        const errorMsg = "表示範囲撮影エラー: タブのwindowIdが未定義です。";
        console.error(errorMsg);
        showNotification("エラー", errorMsg);
        throw new Error(errorMsg);
    }
    const dataUrl: string = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    await saveScreenshot(dataUrl, "screenshot_visible");
  } catch (error: any) {
    console.error("表示範囲の撮影に失敗:", error.message);
    if (!error.message.includes("アクティブなタブが") && !error.message.includes("このページでは")) {
        showNotification("エラー", `表示範囲の撮影に失敗しました: ${error.message}`);
    }
  }
}

async function captureFullPage(): Promise<void> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await getCurrentTab();
    if (!tab || typeof tab.id === 'undefined') {
        throw new Error("ページ全体撮影エラー: タブまたはタブIDが未定義です。");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['js/content_script.js']
    });

    const pageDetails: PageDetails = await chrome.tabs.sendMessage(tab.id, { action: "getPageDetails" } as BackgroundMessageToCS);
    const { totalHeight, viewportWidth, viewportHeight, devicePixelRatio } = pageDetails;

    if (viewportWidth <= 0 || totalHeight <= 0) {
        const errorMsg = `ページ全体撮影エラー: ページサイズの取得に失敗しました (W: ${viewportWidth}, H: ${totalHeight})。`;
        console.error(errorMsg);
        showNotification("エラー", errorMsg);
        throw new Error(errorMsg);
    }

    const canvasWidth = Math.floor(viewportWidth * devicePixelRatio);
    const canvasHeight = Math.floor(totalHeight * devicePixelRatio);

    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) {
      const errorMsg = "ページ全体撮影エラー: OffscreenCanvas の2Dコンテキストを取得できませんでした。";
      console.error(errorMsg);
      showNotification("エラー", errorMsg);
      throw new Error(errorMsg);
    }

    let scrollTop = 0;
    while (scrollTop < totalHeight) {
      await chrome.tabs.sendMessage(tab.id, { action: "scrollToPosition", y: scrollTop } as BackgroundMessageToCS);
      await new Promise(resolve => setTimeout(resolve, 400)); 

      if (typeof tab.windowId === 'undefined') {
          const errorMsg = "ページ全体撮影エラー: ループ中にタブのwindowIdが未定義になりました。";
          console.error(errorMsg);
          showNotification("エラー", errorMsg);
          throw new Error(errorMsg);
      }
      const dataUrl: string = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      const image: ImageBitmap = await createImageBitmapFromDataUrl(dataUrl);
      
      const physicalScrollTop = Math.floor(scrollTop * devicePixelRatio);
      let drawHeight = image.height; 

      if (physicalScrollTop + drawHeight > canvas.height) {
           drawHeight = canvas.height - physicalScrollTop;
      }

      if (drawHeight > 0) {
         ctx.drawImage(image, 0, 0, image.width, drawHeight, 0, physicalScrollTop, image.width, drawHeight);
      }
      image.close(); 

      scrollTop += viewportHeight; 
      if (scrollTop >= totalHeight) break; 
    }

    await chrome.tabs.sendMessage(tab.id, { action: "scrollToPosition", y: 0 } as BackgroundMessageToCS);

    const blob: Blob = await canvas.convertToBlob({ type: "image/png" });
    console.log('captureFullPage: Blob object created:', blob);
    console.log('captureFullPage: Is it a Blob instance?', blob instanceof Blob);

    // URL.createObjectURL の代わりに FileReader を使用
    try {
        const dataUrlFromReader = await blobToDataURL(blob);
        console.log('captureFullPage: Created Data URL via FileReader (first 100 chars):', dataUrlFromReader.substring(0, 100) + "...");
        await saveScreenshot(dataUrlFromReader, "screenshot_fullpage");
        // Data URLの場合、revokeObjectURL は不要
    } catch (fileReaderError: any) {
        const errorMsg = `内部エラー: 画像のURL変換に失敗しました (FileReader: ${fileReaderError.message || fileReaderError})`
        console.error('captureFullPage: FileReader failed to convert Blob to Data URL.', fileReaderError);
        showNotification("エラー", errorMsg);
        return; // これ以上進めないのでリターン
    }

  } catch (error: any) {
    console.error("ページ全体の撮影に失敗(outer try-catch):", error.message, error.stack); 
    if (tab && typeof tab.id !== 'undefined') {
        try {
            await chrome.tabs.sendMessage(tab.id, { action: "scrollToPosition", y: 0 } as BackgroundMessageToCS);
        } catch (resetError: any) {
            console.error("スクロールのリセットに失敗:", resetError.message);
        }
    }
    // エラーメッセージの重複を避けるための条件
    if (error && error.message && 
        !error.message.includes("アクティブなタブが") &&
        !error.message.includes("このページではスクリーンショットを撮影できません") &&
        !error.message.includes("ページサイズの取得に失敗") &&
        !error.message.includes("OffscreenCanvas の2Dコンテキストを取得できませんでした") &&
        !error.message.includes("FileReader")) { // FileReaderからのエラーは既に通知されているはず
      showNotification("エラー", `ページ全体の撮影に失敗しました: ${error.message}`);
    }
  }
}

async function createImageBitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch data URL: ${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  return createImageBitmap(blob);
}

async function saveScreenshot(dataUrl: string, baseFilename: string): Promise<void> {
  try {
    const settings: { saveSubfolder?: string } = await chrome.storage.sync.get(['saveSubfolder']);
    const subfolder = settings.saveSubfolder || "";

    const date = new Date();
    const timestamp = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}${date.getSeconds().toString().padStart(2, '0')}`;
    const filename = `${baseFilename}_${timestamp}.png`;
    const sanitizedSubfolder = subfolder.replace(/[<>:"/\\|?*]/g, '_').replace(/^\.+$/, '_').replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i, '_');
    const fullPath = sanitizedSubfolder ? `${sanitizedSubfolder}/${filename}` : filename;

    console.log(`Attempting to download to: ${fullPath} (URL starts with: ${dataUrl.substring(0,30)})`);

    chrome.downloads.download({
      url: dataUrl,
      filename: fullPath,
      saveAs: false
    }, (downloadId?: number) => {
      if (chrome.runtime.lastError) {
        const errorMsg = `ダウンロードエラー: ${chrome.runtime.lastError.message}`;
        console.error(errorMsg, "Filename:", fullPath);
        showNotification("保存エラー", `保存に失敗しました: ${chrome.runtime.lastError.message}`);
        return;
      }
      if (typeof downloadId !== 'undefined') {
        console.log("Download started with ID:", downloadId);
        showNotification("成功", "スクリーンショットを保存しました！");
      } else {
         const warnMsg = "ダウンロードは開始されましたが、downloadIdが取得できませんでした。";
         console.warn(warnMsg);
         showNotification("注意", warnMsg);
      }
    });
  } catch (error: any) {
    const errorMsg = `保存処理中に予期せぬエラー: ${error.message}`;
    console.error(errorMsg, error.stack);
    showNotification("保存エラー", errorMsg);
  }
}

function showNotification(title: string, message: string): void {
  const notificationId = `screenshot_notification_${Date.now()}`;
  // Service Worker 内でのアイコンパスの解決のため chrome.runtime.getURL を使用することを推奨
  const iconUrl = chrome.runtime.getURL("images/icon48.png");

  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: iconUrl,
    title: title,
    message: message,
    priority: 0
  }, (createdNotificationId?: string) => {
    if (chrome.runtime.lastError) {
      // `Unable to download all specified images.` エラーはここで発生している可能性
      console.error("通知作成エラー:", chrome.runtime.lastError.message, "(Icon URL was:", iconUrl, ")");
      return;
    }
    if (createdNotificationId) {
        setTimeout(() => {
          chrome.notifications.clear(createdNotificationId, (wasCleared?: boolean) => {
            if (chrome.runtime.lastError) {
              // console.warn("通知クリアエラー:", chrome.runtime.lastError.message);
            }
          });
        }, 4000);
    }
  });
}
