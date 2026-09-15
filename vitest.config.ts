import { defineConfig } from "vitest/config";

// Osobna konfiguracja: vite.config.ts ładuje vite-plugin-cesium, który nie jest
// potrzebny (ani bezpieczny) w testach silnika uruchamianych w Node.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
