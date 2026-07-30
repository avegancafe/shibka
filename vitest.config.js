import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside workerd (not Node), which is the point: they prove the ported
// crypto really behaves the same on the Workers runtime under nodejs_compat.
// Bindings/flags come from wrangler.jsonc so the test runtime matches production.
//
// Note: @cloudflare/vitest-pool-workers >= 0.16 dropped the old
// `@cloudflare/vitest-pool-workers/config` entry point (and `defineWorkersConfig`)
// in favor of this `cloudflareTest()` Vite plugin.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    include: ["test/**/*.spec.js"],
  },
});
