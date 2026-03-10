import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // KST (UTC+9) 기준 빌드 시간
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const buildTime = kst.toISOString().slice(0, 16).replace('T', ' ');
  return ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "robots.txt", "pwa-192x192.png", "pwa-512x512.png"],
      manifest: {
        name: "MeerCOP - 노트북 도난 방지",
        short_name: "MeerCOP Smartphone",
        description: "노트북 도난 방지 및 원격 모니터링 서비스",
        theme_color: "#0EA5E9",
        background_color: "#0EA5E9",
        display: "standalone",
        orientation: "any",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        importScripts: ["/push-handler.js"],
        navigateFallbackDenylist: [/^\/~oauth/],
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_debugger: true,
        // drop_console 일시 비활성화 — 모바일 오디오 디버깅용
        // drop_console: true,
      },
    },
  },
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
});
});
