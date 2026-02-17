import { applyInput } from "@/lib/game";
import { Button } from "gboy-ts";

export const dynamic = "force-dynamic";

const BUTTON_MAP: Record<string, Button> = {
  a: Button.A,
  b: Button.B,
  start: Button.Start,
  select: Button.Select,
  up: Button.Up,
  down: Button.Down,
  left: Button.Left,
  right: Button.Right,
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const buttonName = (body.button as string)?.toLowerCase();
    const button = BUTTON_MAP[buttonName];

    if (button === undefined) {
      return Response.json(
        {
          error: `Invalid button: ${buttonName}. Valid: ${Object.keys(BUTTON_MAP).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const png = applyInput(button);
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
