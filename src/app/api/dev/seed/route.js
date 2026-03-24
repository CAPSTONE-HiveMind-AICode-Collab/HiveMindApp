import { NextResponse } from "next/server";
import { seedDemoHive } from "@/lib/dev/demoSeed";

export const runtime = "nodejs";

export async function POST(req) {
  const seedEnabled =
    process.env.NEXT_PUBLIC_DEV_SEED === "1" || process.env.DEV_SEED === "1";

  if (!seedEnabled) {
    return NextResponse.json(
      {
        error: "Dev seed disabled. Set NEXT_PUBLIC_DEV_SEED=1 or DEV_SEED=1 to enable.",
      },
      { status: 403 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const result = await seedDemoHive(body?.user || null);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: String(error?.message || error),
        stack: error?.stack || "",
      },
      { status: 500 }
    );
  }
}
