import { getFrame, runIdleFrames } from "@/lib/game";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const advance = parseInt(searchParams.get("advance") || "0", 10);

  try {
    const png = advance > 0 ? runIdleFrames(advance) : getFrame();
    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
