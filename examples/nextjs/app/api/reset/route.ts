import { resetGame } from "@/lib/game";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const png = resetGame();
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
