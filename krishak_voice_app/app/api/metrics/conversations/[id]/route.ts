import { NextResponse } from "next/server";
import { extractTurnLatencies, getConversation } from "@/lib/elevenlabs";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const conv = await getConversation(id);
    const turns = extractTurnLatencies(conv);
    return NextResponse.json({
      conversation_id: conv.conversation_id,
      agent_name: conv.agent_name,
      status: conv.status,
      metadata: conv.metadata,
      turns,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "failed" }, { status: 500 });
  }
}
