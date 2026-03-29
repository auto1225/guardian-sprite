# IAP Payment Edge Function & Android Native Guide

## 1. meercop_website에 생성할 Edge Function: `iap-payment/index.ts`

아래 코드를 meercop_website 프로젝트의 `supabase/functions/iap-payment/index.ts`에 생성하세요.

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLAN_CONFIG: Record<string, { unitPrice: number; description: string; months: number; days: number }> = {
  basic: { unitPrice: 24.90, description: "MeerCOP Basic Plan (6 months)", months: 6, days: 180 },
  premium: { unitPrice: 39.90, description: "MeerCOP Premium Plan (1 year)", months: 12, days: 365 },
};

// Apple receipt verification
async function verifyAppleReceipt(receiptData: string): Promise<{ valid: boolean; productId?: string; transactionId?: string }> {
  const APPLE_VERIFY_URL = "https://buy.itunes.apple.com/verifyReceipt"; // Production
  const APPLE_SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt";
  const sharedSecret = Deno.env.get("APPLE_SHARED_SECRET");

  const body = JSON.stringify({ "receipt-data": receiptData, password: sharedSecret });
  
  // Try production first, fallback to sandbox
  let res = await fetch(APPLE_VERIFY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  let data = await res.json();
  
  if (data.status === 21007) {
    // Sandbox receipt, retry with sandbox URL
    res = await fetch(APPLE_SANDBOX_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    data = await res.json();
  }
  
  if (data.status !== 0) return { valid: false };
  
  const latestReceipt = data.latest_receipt_info?.[data.latest_receipt_info.length - 1] || data.receipt?.in_app?.[0];
  return {
    valid: true,
    productId: latestReceipt?.product_id,
    transactionId: latestReceipt?.transaction_id,
  };
}

// Google Play receipt verification
async function verifyGoogleReceipt(purchaseToken: string, productId: string): Promise<{ valid: boolean; transactionId?: string }> {
  const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!serviceAccountJson) throw new Error("Google service account not configured");
  
  const serviceAccount = JSON.parse(serviceAccountJson);
  
  // Create JWT for Google API auth
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  
  // Note: In production, use a proper JWT signing library
  // This is a simplified example - use jose or similar
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${payload}.SIGNATURE`,
  });
  
  const tokenData = await tokenRes.json();
  const packageName = "com.meercop.app"; // Your Android package name
  
  const verifyRes = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${purchaseToken}`,
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
  );
  
  const verifyData = await verifyRes.json();
  return {
    valid: verifyData.purchaseState === 0,
    transactionId: verifyData.orderId,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, platform, receipt_data, product_id, plan_type, quantity, mode, serial_keys, user_id } = body;

    if (action !== "verify_receipt") {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate inputs
    if (!platform || !receipt_data || !plan_type || !user_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const planConfig = PLAN_CONFIG[plan_type];
    if (!planConfig) {
      return new Response(JSON.stringify({ error: "Invalid plan type" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify receipt
    let verification: { valid: boolean; transactionId?: string };
    if (platform === "apple") {
      verification = await verifyAppleReceipt(receipt_data);
    } else if (platform === "google") {
      verification = await verifyGoogleReceipt(receipt_data, product_id);
    } else {
      return new Response(JSON.stringify({ error: "Invalid platform" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!verification.valid) {
      return new Response(JSON.stringify({ error: "Receipt verification failed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create admin client for DB operations
    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date();
    const results: any[] = [];
    const captureMode = mode || "new";
    const captureQuantity = Math.max(1, parseInt(String(quantity)) || 1);
    const captureSerialKeys: string[] = serial_keys || [];

    if (captureMode === "upgrade" && captureSerialKeys.length > 0) {
      for (let i = 0; i < captureSerialKeys.length; i++) {
        const serialKey = captureSerialKeys[i];
        const { data: existing } = await adminSupabase
          .from("serial_numbers")
          .select("id, serial_key, plan_type, status, expires_at")
          .eq("user_id", user_id)
          .eq("serial_key", serialKey)
          .single();

        if (!existing) continue;

        let remainingMs = 0;
        if (existing.expires_at) {
          remainingMs = Math.max(0, new Date(existing.expires_at).getTime() - now.getTime());
        }
        const newExpires = new Date(now.getTime() + remainingMs + planConfig.days * 24 * 60 * 60 * 1000);

        const { data: updated } = await adminSupabase
          .from("serial_numbers")
          .update({
            plan_type, status: "active",
            activated_at: now.toISOString(),
            expires_at: newExpires.toISOString(),
          })
          .eq("id", existing.id)
          .select("id, serial_key, plan_type, status, activated_at, expires_at")
          .single();

        if (updated) {
          results.push(updated);
          await adminSupabase.from("payments").insert({
            user_id, serial_id: updated.id,
            amount: planConfig.unitPrice, currency: "USD",
            payment_method: platform === "apple" ? "apple_iap" : "google_play",
            plan_type, plan_name: planConfig.description,
            status: "completed",
            transaction_id: verification.transactionId || `iap_${Date.now()}_${i}`,
            period_start: now.toISOString(),
            period_end: newExpires.toISOString(),
          });
        }
      }
    } else {
      const expiresAt = new Date(now.getTime() + planConfig.days * 24 * 60 * 60 * 1000);

      for (let i = 0; i < captureQuantity; i++) {
        const { data: keyData } = await adminSupabase.rpc("generate_serial_key");
        const newSerialKey = keyData as string;

        const { data: created } = await adminSupabase
          .from("serial_numbers")
          .insert({
            serial_key: newSerialKey, user_id,
            plan_type, status: "active",
            activated_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
          })
          .select("id, serial_key, plan_type, status, activated_at, expires_at")
          .single();

        if (created) {
          results.push(created);
          await adminSupabase.from("payments").insert({
            user_id, serial_id: created.id,
            amount: planConfig.unitPrice, currency: "USD",
            payment_method: platform === "apple" ? "apple_iap" : "google_play",
            plan_type, plan_name: planConfig.description,
            status: "completed",
            transaction_id: `${verification.transactionId || "iap"}_${i + 1}`,
            period_start: now.toISOString(),
            period_end: expiresAt.toISOString(),
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, serials: results, mode: captureMode }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("IAP payment error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

## 2. meercop_website에 필요한 시크릿

- `APPLE_SHARED_SECRET` — Apple App Store Connect에서 발급
- `GOOGLE_SERVICE_ACCOUNT_JSON` — Google Play Console에서 발급한 서비스 계정 JSON

## 3. Android 네이티브 구현 가이드

### 3.1 JS Interface 추가 (WebAppInterface.java)

```java
@JavascriptInterface
public void purchaseProduct(String productId, String metadata) {
    Log.d("NativeBridge", "purchaseProduct: " + productId);
    // metadata에는 plan_type, quantity, mode, serial_keys, user_id 포함
    
    Activity activity = activityRef.get();
    if (activity instanceof MainActivity) {
        activity.runOnUiThread(() -> {
            ((MainActivity) activity).startIAPPurchase(productId, metadata);
        });
    }
}
```

### 3.2 Google Play Billing 연동 (MainActivity.java)

```java
import com.android.billingclient.api.*;
import org.json.JSONObject;
import java.util.List;

public class MainActivity extends AppCompatActivity implements PurchasesUpdatedListener {
    
    private BillingClient billingClient;
    private WebView webView;
    private String pendingMetadata;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Initialize Billing Client
        billingClient = BillingClient.newBuilder(this)
            .setListener(this)
            .enablePendingPurchases()
            .build();
        
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                Log.d("Billing", "Setup finished: " + result.getResponseCode());
            }
            
            @Override
            public void onBillingServiceDisconnected() {
                Log.d("Billing", "Service disconnected");
            }
        });
    }
    
    public void startIAPPurchase(String productId, String metadata) {
        this.pendingMetadata = metadata;
        
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .addProduct(QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(BillingClient.ProductType.INAPP) // or SUBS
                .build())
            .build();
        
        billingClient.queryProductDetailsAsync(params, (result, productDetailsList) -> {
            if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && !productDetailsList.isEmpty()) {
                ProductDetails productDetails = productDetailsList.get(0);
                
                BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                    .addProductDetailsParams(
                        BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(productDetails)
                            .build())
                    .build();
                
                billingClient.launchBillingFlow(this, flowParams);
            } else {
                // 상품을 찾을 수 없음
                sendIAPResult(false, null, "Product not found");
            }
        });
    }
    
    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase purchase : purchases) {
                handlePurchase(purchase);
            }
        } else if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            sendIAPResult(false, null, "User cancelled");
        } else {
            sendIAPResult(false, null, "Purchase failed: " + result.getDebugMessage());
        }
    }
    
    private void handlePurchase(Purchase purchase) {
        if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
            // Acknowledge purchase
            if (!purchase.isAcknowledged()) {
                AcknowledgePurchaseParams ackParams = AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchase.getPurchaseToken())
                    .build();
                billingClient.acknowledgePurchase(ackParams, ackResult -> {
                    Log.d("Billing", "Purchase acknowledged: " + ackResult.getResponseCode());
                });
            }
            
            // Send result to WebView
            try {
                JSONObject resultObj = new JSONObject();
                resultObj.put("success", true);
                resultObj.put("platform", "google");
                resultObj.put("receipt_data", purchase.getPurchaseToken());
                resultObj.put("product_id", purchase.getProducts().get(0));
                resultObj.put("transaction_id", purchase.getOrderId());
                
                sendIAPResultJson(resultObj.toString());
            } catch (Exception e) {
                sendIAPResult(false, null, e.getMessage());
            }
        }
    }
    
    private void sendIAPResult(boolean success, String receiptData, String error) {
        try {
            JSONObject result = new JSONObject();
            result.put("success", success);
            result.put("platform", "google");
            if (receiptData != null) result.put("receipt_data", receiptData);
            if (error != null) result.put("error", error);
            
            sendIAPResultJson(result.toString());
        } catch (Exception e) {
            Log.e("Billing", "Failed to create result JSON", e);
        }
    }
    
    private void sendIAPResultJson(String json) {
        runOnUiThread(() -> {
            String escaped = json.replace("\\", "\\\\").replace("'", "\\'");
            webView.evaluateJavascript(
                "if(window.onIAPResult) window.onIAPResult('" + escaped + "');",
                null
            );
        });
    }
}
```

### 3.3 build.gradle 의존성 추가

```groovy
dependencies {
    implementation 'com.android.billingclient:billing:6.1.0'
}
```

### 3.4 Google Play Console 설정

1. **인앱 상품 등록** (Google Play Console → 수익 창출 → 인앱 상품):
   - `meercop_basic_6m` — $24.90
   - `meercop_premium_12m` — $39.90

2. **서비스 계정 생성** (Google Cloud Console):
   - API 접근용 서비스 계정 생성
   - JSON 키 다운로드
   - meercop_website의 시크릿에 `GOOGLE_SERVICE_ACCOUNT_JSON`으로 등록

## 4. iOS 네이티브 구현 (향후)

iOS의 경우 StoreKit 2를 사용하며, 동일한 `window.onIAPResult(json)` 패턴으로 결과를 WebView에 전달합니다.

## 5. 전체 플로우

1. 사용자가 앱에서 "Buy Now" 클릭
2. 플랜/수량 선택 → "Pay" 버튼 클릭  
3. 웹 → NativeApp.purchaseProduct(sku, metadata)
4. 네이티브에서 Google Play / Apple IAP 결제 화면 표시
5. 결제 완료 → window.onIAPResult(json) 호출
6. 웹에서 영수증을 meercop_website의 iap-payment 엣지 함수로 전송
7. 서버에서 영수증 검증 → 시리얼 생성/업그레이드
8. 성공 화면 표시 & 시리얼 목록 새로고침
