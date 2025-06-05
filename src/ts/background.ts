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
      showNotification("エラー", errorMsg); // ここで通知
      throw new Error(errorMsg);
    }
    const dataUrl: string = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    await saveScreenshot(dataUrl, "screenshot_visible"); // segmentIndexなし
    showNotification("成功", "表示範囲のスクリーンショットを保存しました！"); // 保存成功後に通知
  } catch (error: any) {
    console.error("表示範囲の撮影または保存に失敗:", error.message);
    // getCurrentTab 内で通知されるエラーとの重複を避ける
    if (error && error.message &&
      !error.message.includes("アクティブなタブが") &&
      !error.message.includes("このページではスクリーンショットを撮影できません") &&
      !error.message.includes("タブのwindowIdが未定義です。")) {
      showNotification("エラー", `表示範囲の撮影・保存に失敗: ${error.message}`);
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

    // オプションから保存モードを取得
    const settings: { fullPageMode?: string } = await chrome.storage.sync.get(['fullPageMode']);
    const mode = settings.fullPageMode || 'stitch'; // デフォルトは 'stitch'

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

    if (mode === 'segments') {
      // === 個別セグメントとして保存するモード ===
      let scrollTop = 0;
      let segmentIndex = 0; // 0から始まるインデックス
      let savedCount = 0;
      let errorCount = 0;

      while (scrollTop < totalHeight) {
        await chrome.tabs.sendMessage(tab.id, { action: "scrollToPosition", y: scrollTop } as BackgroundMessageToCS);
        await new Promise(resolve => setTimeout(resolve, 400));

        if (typeof tab.windowId === 'undefined') {
          const errorMsg = "ページ全体撮影エラー(セグメント): ループ中にタブのwindowIdが未定義になりました。";
          console.error(errorMsg);
          showNotification("エラー", errorMsg); // 個別エラーとして通知
          errorCount++; // このセグメントはエラーとしてカウント
          // ループを続けるか、ここで中断するかは設計次第。ここでは続ける。
          scrollTop += viewportHeight;
          if (scrollTop >= totalHeight) break;
          segmentIndex++; // 次のインデックスへ
          continue; // このイテレーションの残りをスキップ
        }
        const segmentDataUrl: string = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });

        try {
          await saveScreenshot(segmentDataUrl, "fullpage_segment", segmentIndex);
          savedCount++;
        } catch (segmentSaveError: any) {
          console.error(`セグメント ${segmentIndex + 1} の保存に失敗:`, segmentSaveError.message);
          // 個別のセグメント保存失敗をユーザーに通知することも可能
          // showNotification("エラー", `セグメント ${segmentIndex + 1} の保存に失敗しました。`);
          errorCount++;
        }

        segmentIndex++;
        scrollTop += viewportHeight;
        if (scrollTop >= totalHeight) break;
      }

      // 元の位置にスクロールを戻す
      await chrome.tabs.sendMessage(tab.id, { action: "scrollToPosition", y: 0 } as BackgroundMessageToCS);

      // 最終的な通知
      if (savedCount > 0 && errorCount === 0) {
        showNotification("成功", `${savedCount}個のセグメントを全て保存しました！`);
      } else if (savedCount > 0 && errorCount > 0) {
        showNotification("一部成功", `${savedCount}個のセグメントを保存、${errorCount}個は失敗しました。`);
      } else if (savedCount === 0 && errorCount > 0) {
        showNotification("エラー", `全セグメントの保存に失敗しました。(${errorCount}個)`);
      } else {
        showNotification("情報", "保存対象のセグメントが処理されませんでした。");
      }

    } else { // mode === 'stitch' (結合して1枚で保存するモード)
      const canvasWidth = Math.floor(viewportWidth * devicePixelRatio);
      const canvasHeight = Math.floor(totalHeight * devicePixelRatio);

      const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
      if (!ctx) {
        const errorMsg = "ページ全体撮影エラー(結合): OffscreenCanvas の2Dコンテキストを取得できませんでした。";
        console.error(errorMsg);
        showNotification("エラー", errorMsg);
        throw new Error(errorMsg);
      }

      let scrollTop = 0;
      while (scrollTop < totalHeight) {
        await chrome.tabs.sendMessage(tab.id, { action: "scrollToPosition", y: scrollTop } as BackgroundMessageToCS);
        await new Promise(resolve => setTimeout(resolve, 400));

        if (typeof tab.windowId === 'undefined') {
          const errorMsg = "ページ全体撮影エラー(結合): ループ中にタブのwindowIdが未定義になりました。";
          console.error(errorMsg);
          showNotification("エラー", errorMsg);
          throw new Error(errorMsg); // 結合モードでは致命的なので中断
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
      console.log('captureFullPage(stitch): Blob object created:', blob);

      try {
        const dataUrlFromReader = await blobToDataURL(blob);
        console.log('captureFullPage(stitch): Created Data URL via FileReader (first 100 chars):', dataUrlFromReader.substring(0, 100));
        await saveScreenshot(dataUrlFromReader, "screenshot_fullpage_stitched"); // 結合版のベースファイル名
        showNotification("成功", "ページ全体のスクリーンショット（結合版）を保存しました！"); // 成功通知
      } catch (saveOrConvertError: any) {
        const errorMsg = `結合版スクリーンショットのURL変換または保存に失敗: ${saveOrConvertError.message || saveOrConvertError}`;
        console.error('captureFullPage(stitch):', errorMsg, saveOrConvertError);
        showNotification("エラー", errorMsg); // エラー通知
        return;
      }
    }

  } catch (error: any) { // captureFullPage全体のtry-catch
    console.error("ページ全体の撮影処理中にエラー(outer try-catch):", error.message, error.stack);
    if (tab && typeof tab.id !== 'undefined') { // 可能な限りスクロールを戻す
      try {
        await chrome.tabs.sendMessage(tab.id, { action: "scrollToPosition", y: 0 } as BackgroundMessageToCS);
      } catch (resetError: any) {
        console.error("スクロールのリセット試行中にエラー:", resetError.message);
      }
    }
    // エラーメッセージの重複を避けるための条件
    if (error && error.message &&
      !error.message.includes("アクティブなタブが") &&
      !error.message.includes("このページではスクリーンショットを撮影できません") &&
      !error.message.includes("ページサイズの取得に失敗") &&
      !error.message.includes("OffscreenCanvas の2Dコンテキストを取得できませんでした") &&
      !error.message.includes("タブのwindowIdが未定義です。") &&
      !error.message.includes("FileReader")) {
      showNotification("エラー", `ページ全体の撮影処理中にエラーが発生: ${error.message}`);
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

async function saveScreenshot(dataUrl: string, baseFilename: string, segmentIndex?: number): Promise<void> { // 通知を削除し、Promiseを返す
  try {
    const settings: { saveSubfolder?: string } = await chrome.storage.sync.get(['saveSubfolder']);
    const subfolder = settings.saveSubfolder || "";

    const date = new Date();
    const timestamp = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}${date.getSeconds().toString().padStart(2, '0')}`;

    let filename: string;
    if (typeof segmentIndex === 'number') {
      // セグメント番号は1から始まるように調整 (ユーザーフレンドリーにするため)
      filename = `${baseFilename}_${segmentIndex + 1}_${timestamp}.png`;
    } else {
      filename = `${baseFilename}_${timestamp}.png`;
    }

    const sanitizedSubfolder = subfolder.replace(/[<>:"/\\|?*]/g, '_').replace(/^\.+$/, '_').replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i, '_');
    const fullPath = sanitizedSubfolder ? `${sanitizedSubfolder}/${filename}` : filename;

    console.log(`Attempting to download to: ${fullPath} (URL starts with: ${dataUrl.substring(0, 30)})`);

    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: dataUrl,
        filename: fullPath,
        saveAs: false
      }, (downloadId?: number) => {
        if (chrome.runtime.lastError) {
          const errorMsg = `ダウンロードエラー: ${chrome.runtime.lastError.message}`;
          console.error(errorMsg, "Filename:", fullPath);
          reject(new Error(errorMsg)); // エラーでPromiseをreject
          // Blob URLの場合の解放処理 (エラー時)
          if (dataUrl.startsWith('blob:') && typeof self.URL?.revokeObjectURL === 'function') {
            console.log("Revoking Blob URL due to download error:", dataUrl);
            self.URL.revokeObjectURL(dataUrl);
          }
          return;
        }
        if (typeof downloadId !== 'undefined') {
          console.log("Download started with ID:", downloadId);
          resolve(); // 成功でPromiseをresolve
        } else {
          const warnMsg = "ダウンロードは開始されましたが、downloadIdが取得できませんでした（エラーなし）。";
          console.warn(warnMsg);
          resolve(); // 不明瞭だが、エラーではないのでresolve
        }
      });
    });
  } catch (error: any) {
    // このcatchは主に chrome.storage.sync.get の失敗などを捕捉
    const errorMsg = `保存処理の準備中に予期せぬエラー: ${error.message}`;
    console.error(errorMsg, error.stack);
    throw new Error(errorMsg); // エラーを呼び出し元に伝播
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
