import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

// 앱이 포그라운드로 돌아올 때 배지 카운트 초기화
if (navigator.clearAppBadge) {
  navigator.clearAppBadge();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      navigator.clearAppBadge?.();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
