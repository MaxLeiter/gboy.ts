import { getGameInfo } from "@/lib/game";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const info = getGameInfo();
    return Response.json(info, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
