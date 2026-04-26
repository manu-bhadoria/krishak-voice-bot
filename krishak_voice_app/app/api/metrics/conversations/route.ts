import { NextResponse } from "next/server";
import { aggregate, getConversation, listConversations } from "@/lib/elevenlabs";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// List recent conversations WITH aggregate latency per call.
// Server-side only — uses xi-api-key.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "20"));

  try {
    const summaries = await listConversations(limit);

    // Fetch each detail in parallel (bounded by limit).
    const details = await Promise.all(
      summaries.map((s) =>
        getConversation(s.conversation_id).then(
          (d) => aggregate(d, s),
          (e) => ({ conversation_id: s.conversation_id, error: String(e) } as any)
        )
      )
    );

    return NextResponse.json({ calls: details });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "failed" }, { status: 500 });
  }
}
