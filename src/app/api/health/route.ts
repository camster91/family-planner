import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

/**
 * Readiness probe. The HTTP status remains useful to the container orchestrator,
 * while the public response avoids exposing database and secret configuration.
 */
export async function GET() {
  try {
    const databaseConfigured = Boolean(process.env.DATABASE_URL);
    const jwtSecretConfigured = Boolean(process.env.JWT_SECRET);
    let databaseReady = false;

    if (prisma) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        databaseReady = true;
      } catch {
        databaseReady = false;
      }
    }

    const status =
      databaseReady && databaseConfigured && jwtSecretConfigured
        ? "healthy"
        : "degraded";

    return NextResponse.json(
      { status },
      {
        status: status === "healthy" ? 200 : 503,
        headers: {
          ...NO_STORE,
          ...(process.env.RELEASE_SHA
            ? { "X-Release-Commit": process.env.RELEASE_SHA }
            : {}),
        },
      },
    );
  } catch {
    // Do not return exception text or configuration diagnostics to anonymous callers.
    console.error("Health check failed");
    return NextResponse.json(
      { status: "degraded" },
      {
        status: 503,
        headers: NO_STORE,
      },
    );
  }
}
