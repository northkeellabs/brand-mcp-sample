import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Sign-in tests: the OAuth-protected entry point, with Google's endpoints replaced by mocks at fetch().
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.auth.jsonc" },
      miniflare: {
        bindings: {
          MCP_RESOURCE: "http://localhost:8787/mcp",
          GOOGLE_CLIENT_ID: "mock-client.apps.example.test",
          GOOGLE_CLIENT_SECRET: "mock-client-secret",
          GOOGLE_AUTH_URL: "https://google.test/auth",
          GOOGLE_TOKEN_URL: "https://google.test/token",
          GOOGLE_JWKS_URL: "https://google.test/certs",
        },
      },
    }),
  ],
  test: { include: ["test/auth/**/*.test.ts"] },
});
