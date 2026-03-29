# IAP Native Implementation Guide

## 1. 웹 → 네이티브 데이터 흐름

Pay 버튼 클릭 시 웹앱이 `NativeApp.purchaseProduct(productId, metadata)` 호출:

```
productId: "meercop_basic_6m" 또는 "meercop_premium_12m"
metadata (JSON string):
{
  "product_id": "meercop_basic_6m",
  "plan_type": "basic",
  "plan_name": "Basic Plan",
  "duration_months": 6,
  "unit_price": 24.90,
  "quantity": 1,
  "total_amount": 24.90,
  "currency": "USD",
  "mode": "new",              // "new" 또는 "upgrade"
  "serial_keys": [],          // upgrade 시 대상 시리얼 키 배열
  "user_id": "uuid-string",
  "verify_url": "https://www.meercop.com/functions/v1/iap-payment"
}
```

## 2. 네이티브 → 웹 결과 반환

결제 완료/실패 후 네이티브에서 WebView로 결과 전달:

```javascript
// 성공 시
window.onIAPResult(JSON.stringify({
  "success": true,
  "platform": "apple",       // 또는 "google"
  "product_id": "meercop_basic_6m",
  "receipt_data": "...",      // Apple: Base64 receipt, Google: purchase token
  "transaction_id": "..."    // 플랫폼 트랜잭션 ID
}));

// 실패/취소 시
window.onIAPResult(JSON.stringify({
  "success": false,
  "error": "User cancelled"  // 또는 에러 메시지
}));
```

웹앱이 `onIAPResult`를 받으면 자동으로 `verify_url`(서버)에 영수증 검증 요청을 보내고, 검증 성공 시 시리얼이 할당됩니다.

---

## 3. Android (Java/Kotlin) 구현

### 3-1. build.gradle 의존성

```groovy
implementation 'com.android.billingclient:billing:6.2.0'
```

### 3-2. App Store에 등록할 상품 ID

| Product ID | 가격 | 기간 |
|---|---|---|
| `meercop_basic_6m` | $24.90 | 6개월 |
| `meercop_premium_12m` | $39.90 | 12개월 |

> Google Play Console → Monetize → In-app products에서 **일회성 상품(One-time product)** 으로 등록

### 3-3. WebView JavaScript Interface

```java
public class NativeAppBridge {
    private final Activity activity;
    private final WebView webView;
    private BillingClient billingClient;
    private String pendingMetadata; // 결제 메타데이터 임시 저장

    public NativeAppBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        setupBillingClient();
    }

    // ── 웹에서 호출되는 결제 시작 메서드 ──
    @JavascriptInterface
    public void purchaseProduct(String productId, String metadata) {
        this.pendingMetadata = metadata;
        
        activity.runOnUiThread(() -> {
            QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(List.of(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()))
                .build();

            billingClient.queryProductDetailsAsync(params, (billingResult, productDetailsList) -> {
                if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK 
                    || productDetailsList.isEmpty()) {
                    sendIAPResult(false, null, null, "Product not found");
                    return;
                }

                ProductDetails productDetails = productDetailsList.get(0);
                BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(List.of(
                        BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(productDetails)
                            .build()))
                    .build();

                billingClient.launchBillingFlow(activity, flowParams);
            });
        });
    }

    // ── BillingClient 설정 ──
    private void setupBillingClient() {
        billingClient = BillingClient.newBuilder(activity)
            .setListener(this::onPurchaseUpdated)
            .enablePendingPurchases()
            .build();

        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                Log.d("IAP", "Billing setup: " + result.getResponseCode());
            }
            @Override
            public void onBillingServiceDisconnected() {
                // 재연결 로직
                billingClient.startConnection(this);
            }
        });
    }

    // ── 결제 결과 콜백 ──
    private void onPurchaseUpdated(BillingResult result, List<Purchase> purchases) {
        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK 
            && purchases != null) {
            for (Purchase purchase : purchases) {
                handlePurchase(purchase);
            }
        } else if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            sendIAPResult(false, null, null, "User cancelled");
        } else {
            sendIAPResult(false, null, null, "Error: " + result.getDebugMessage());
        }
    }

    private void handlePurchase(Purchase purchase) {
        if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
            // 1) 웹뷰에 성공 결과 전달 (서버 검증은 웹앱이 처리)
            sendIAPResult(
                true,
                purchase.getProducts().get(0),
                purchase.getPurchaseToken(),  // Google receipt = purchase token
                null
            );

            // 2) 소비 처리 (일회성 상품이므로 재구매 가능하게)
            ConsumeParams consumeParams = ConsumeParams.newBuilder()
                .setPurchaseToken(purchase.getPurchaseToken())
                .build();
            billingClient.consumeAsync(consumeParams, (billingResult, token) -> {
                Log.d("IAP", "Consume result: " + billingResult.getResponseCode());
            });
        }
    }

    // ── WebView로 결과 전달 ──
    private void sendIAPResult(boolean success, String productId, 
                                String receiptData, String error) {
        JSONObject result = new JSONObject();
        try {
            result.put("success", success);
            result.put("platform", "google");
            if (productId != null) result.put("product_id", productId);
            if (receiptData != null) result.put("receipt_data", receiptData);
            if (error != null) result.put("error", error);
            
            // pendingMetadata에서 transaction 관련 정보 복원
            if (success && pendingMetadata != null) {
                JSONObject meta = new JSONObject(pendingMetadata);
                result.put("transaction_id", receiptData); // Google은 token이 ID 역할
            }
        } catch (JSONException e) {
            e.printStackTrace();
        }

        String js = "javascript:window.onIAPResult('" 
            + result.toString().replace("'", "\\'") + "')";
        activity.runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }
}
```

### 3-4. WebView에 Bridge 등록

```java
// MainActivity.java
webView.addJavascriptInterface(
    new NativeAppBridge(this, webView), "NativeApp"
);
```

---

## 4. iOS (Swift) 구현

### 4-1. App Store Connect에서 상품 등록

| Product ID | Type | 가격 |
|---|---|---|
| `meercop_basic_6m` | Non-Consumable 또는 Non-Renewing Subscription | $24.90 |
| `meercop_premium_12m` | Non-Consumable 또는 Non-Renewing Subscription | $39.90 |

### 4-2. StoreKit 2 구현 (iOS 15+)

```swift
import StoreKit
import WebKit

class IAPManager: NSObject {
    static let shared = IAPManager()
    
    private var webView: WKWebView?
    private var pendingMetadata: String?
    
    func setWebView(_ webView: WKWebView) {
        self.webView = webView
    }
    
    // ── 웹에서 호출: 결제 시작 ──
    func purchaseProduct(productId: String, metadata: String) {
        self.pendingMetadata = metadata
        
        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    sendIAPResult(success: false, productId: productId,
                                  receiptData: nil, error: "Product not found")
                    return
                }
                
                let result = try await product.purchase()
                
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        // 성공 - AppStore receipt 가져오기
                        let receiptData = await getAppReceipt()
                        sendIAPResult(
                            success: true,
                            productId: productId,
                            receiptData: receiptData,
                            transactionId: String(transaction.id),
                            error: nil
                        )
                        await transaction.finish()
                        
                    case .unverified(_, let error):
                        sendIAPResult(success: false, productId: productId,
                                      receiptData: nil, error: "Verification failed: \(error)")
                    }
                    
                case .userCancelled:
                    sendIAPResult(success: false, productId: productId,
                                  receiptData: nil, error: "User cancelled")
                    
                case .pending:
                    sendIAPResult(success: false, productId: productId,
                                  receiptData: nil, error: "Payment pending approval")
                    
                @unknown default:
                    sendIAPResult(success: false, productId: productId,
                                  receiptData: nil, error: "Unknown result")
                }
            } catch {
                sendIAPResult(success: false, productId: productId,
                              receiptData: nil, error: error.localizedDescription)
            }
        }
    }
    
    // ── App Store Receipt 가져오기 ──
    private func getAppReceipt() async -> String? {
        guard let receiptURL = Bundle.main.appStoreReceiptURL,
              let receiptData = try? Data(contentsOf: receiptURL) else {
            return nil
        }
        return receiptData.base64EncodedString()
    }
    
    // ── WebView로 결과 전달 ──
    private func sendIAPResult(success: Bool, productId: String?,
                                receiptData: String?, transactionId: String? = nil,
                                error: String?) {
        var result: [String: Any] = [
            "success": success,
            "platform": "apple"
        ]
        if let pid = productId { result["product_id"] = pid }
        if let receipt = receiptData { result["receipt_data"] = receipt }
        if let txId = transactionId { result["transaction_id"] = txId }
        if let err = error { result["error"] = err }
        
        guard let jsonData = try? JSONSerialization.data(withJSONObject: result),
              let jsonString = String(data: jsonData, encoding: .utf8) else { return }
        
        let escaped = jsonString.replacingOccurrences(of: "'", with: "\\'")
        let js = "window.onIAPResult('\(escaped)')"
        
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js)
        }
    }
}
```

### 4-3. WKScriptMessageHandler (WebView Bridge)

```swift
class WebViewBridge: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        guard message.name == "NativeApp",
              let body = message.body as? [String: Any],
              let method = body["method"] as? String else { return }
        
        switch method {
        case "purchaseProduct":
            let productId = body["productId"] as? String ?? ""
            let metadata = body["metadata"] as? String ?? "{}"
            IAPManager.shared.purchaseProduct(productId: productId, metadata: metadata)
            
        case "openExternalUrl":
            if let urlStr = body["url"] as? String,
               let url = URL(string: urlStr) {
                UIApplication.shared.open(url)
            }
            
        default: break
        }
    }
}

// ── ViewController에서 WebView 설정 ──
let config = WKWebViewConfiguration()
let bridge = WebViewBridge()
config.userContentController.add(bridge, name: "NativeApp")

// iOS에서는 window.webkit.messageHandlers를 NativeApp으로 매핑하는 JS 주입
let bridgeScript = WKUserScript(source: """
    window.NativeApp = {
        onLoginSuccess: function(a, r) {
            window.webkit.messageHandlers.NativeApp.postMessage({method:'onLoginSuccess',accessToken:a,refreshToken:r});
        },
        onLogout: function() {
            window.webkit.messageHandlers.NativeApp.postMessage({method:'onLogout'});
        },
        onSessionRestored: function() {
            window.webkit.messageHandlers.NativeApp.postMessage({method:'onSessionRestored'});
        },
        openExternalUrl: function(url) {
            window.webkit.messageHandlers.NativeApp.postMessage({method:'openExternalUrl',url:url});
        },
        purchaseProduct: function(productId, metadata) {
            window.webkit.messageHandlers.NativeApp.postMessage({method:'purchaseProduct',productId:productId,metadata:metadata});
        }
    };
    window.__IS_NATIVE_APP = true;
""", injectionTime: .atDocumentStart, forMainFrameOnly: true)
config.userContentController.addUserScript(bridgeScript)
```

---

## 5. 서버 검증 흐름 (meercop_website Edge Function)

웹앱이 `onIAPResult` 성공을 받으면 자동으로 서버에 검증 요청:

```
POST https://www.meercop.com/functions/v1/iap-payment
{
  "action": "verify_receipt",
  "platform": "apple" | "google",
  "receipt_data": "...",         // Apple: Base64 receipt, Google: purchase token
  "product_id": "meercop_basic_6m",
  "plan_type": "basic",
  "quantity": 1,
  "mode": "new" | "upgrade",
  "serial_keys": [],
  "user_id": "uuid"
}
```

서버에서 해야 할 일:
1. **Apple**: `https://buy.itunes.apple.com/verifyReceipt` (또는 sandbox URL)에 receipt 검증
2. **Google**: Google Play Developer API로 `purchases.products.get` 호출하여 token 검증
3. 검증 성공 시 기존 `generate_serial_key()` RPC로 시리얼 생성/업그레이드
4. 결과 반환 → 웹앱에서 성공 화면 표시

---

## 6. 테스트 체크리스트

- [ ] Google Play: 테스트 트랙에서 라이선스 테스터 계정으로 결제 테스트
- [ ] Apple: Sandbox 계정으로 결제 테스트
- [ ] 결제 취소 시 웹앱이 정상 복귀하는지 확인
- [ ] 네트워크 끊김 상태에서 결제 시 에러 처리 확인
- [ ] Upgrade 모드에서 기존 시리얼이 정상 갱신되는지 확인
