/**
 * 푸시 알림 Service Worker 핸들러
 * VitePWA의 workbox.importScripts를 통해 로드됨
 */

self.addEventListener("push", (event) => {
  console.log("[SW Push] Received push event");

  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "경보 알림", body: event.data?.text() || "새로운 경보가 발생했습니다!" };
  }

  const title = data.title || "🚨 경보 알림";
  const options = {
    body: data.body || "새로운 경보가 발생했습니다!",
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    vibrate: [300, 100, 300, 100, 300],
    tag: data.tag || "meercop-alert",
    renotify: true,
    requireInteraction: true,
    data: data,
    actions: [
      { action: "open", title: "확인" },
      { action: "dismiss", title: "해제" },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  console.log("[SW Push] Notification clicked:", event.action);
  event.notification.close();

  if (event.action === "dismiss") {
    return;
  }

  // 앱 포커스 또는 새 창 열기
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow("/");
      })
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  console.log("[SW Push] Subscription changed");
  // 구독이 변경되면 새 구독으로 업데이트 필요
  // 클라이언트에서 처리하도록 메시지 전송
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" });
      });
    })
  );
});
