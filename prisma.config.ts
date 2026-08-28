import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Generation and validation do not connect. A placeholder keeps local and
    // CI builds deterministic; database commands must provide DATABASE_URL.
    url:
      process.env.DATABASE_URL ??
      "postgresql://placeholder@localhost:5432/placeholder",
  },
});
