import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    VitePWA({
      registerType: "autoUpdate",
      // Matches the filename index.html already references (/manifest.json)
      // so the existing <link> tag and this plugin's output line up.
      manifestFilename: "manifest.json",
      manifest: {
        name: "NyumbaTrack — Smart Rent Management for Kenyan Landlords",
        short_name: "NyumbaTrack",
        description:
          "Manage tenants, track rent payments, balances, and receipts — built for Kenya.",
        theme_color: "#166534",
        background_color: "#F5F5F0",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Caches the app shell (HTML/JS/CSS) so the UI still loads with a
        // weak or no connection. Live data (tenants, payments, balances)
        // still needs Supabase to actually respond — this makes the shell
        // resilient, not the data itself available offline.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api-cache",
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 50,
                // Short TTL on purpose: stale rent/payment data is worse
                // than no cached data at all for this app specifically.
                maxAgeSeconds: 60 * 5,
              },
            },
          },
        ],
      },
    }),
  ],
});