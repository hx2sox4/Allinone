import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://ilson:ilson@localhost:5432/ilson?schema=test",
      QUEUE_MODE: "inline",
      USD_KRW_RATE: "1400",
      HF_WEBHOOK_SECRET: "whsec_dGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQtdGVzdA==",
      APP_PUBLIC_URL: "",
    },
  },
});
