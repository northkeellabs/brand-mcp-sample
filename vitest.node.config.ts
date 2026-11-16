import { defineConfig } from "vitest/config";

// Build and rules tests run in plain Node (they read files and spawn the build scripts).
export default defineConfig({ test: { include: ["test/node/**/*.test.ts", "test/figma/**/*.test.ts"], environment: "node" } });
