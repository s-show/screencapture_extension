// content_script.js

interface CSBaseRequest {
  action: string;
}
interface CSGetPageDetailsRequest extends CSBaseRequest {
  action: "getPageDetails";
}
interface CSScrollToPositionRequest extends CSBaseRequest {
  action: "scrollToPosition";
  y: number;
}
type CSRequest = CSGetPageDetailsRequest | CSScrollToPositionRequest;

chrome.runtime.onMessage.addListener(
  (request: CSRequest, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (request.action === "getPageDetails") {
      sendResponse({
        totalHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, document.body.offsetHeight, document.documentElement.offsetHeight, document.body.clientHeight, document.documentElement.clientHeight),
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: window.innerHeight, // ビューポートの高さ
        devicePixelRatio: window.devicePixelRatio || 1
      });
    } else if (request.action === "scrollToPosition") {
      if (typeof (request as CSScrollToPositionRequest).y === 'number') {
        window.scrollTo(0, (request as CSScrollToPositionRequest).y);
        sendResponse({ status: "scrolled", y: (request as CSScrollToPositionRequest).y });
      } else {
        sendResponse({ status: "error", message: "Y coordinate not provided for scroll." });
      }
    }
    return true; // 非同期応答の可能性を示す
  });
