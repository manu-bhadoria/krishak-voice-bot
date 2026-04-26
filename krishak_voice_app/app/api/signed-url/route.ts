import { NextResponse } from "next/server";

// Returns a short-lived WebRTC conversation token for the ElevenLabs ConvAI
// agent. The API key stays on the server — the browser never sees it.
//
// Edge runtime: required for Cloudflare Pages (Pages does not run a Node.js
// runtime). The route uses only fetch + process.env + NextResponse, all of
// which are edge-compatible.

export const runtime = "edge";

export async function GET() {
  const agentId = process.env.VOICE_AGENT_ID;
  const apiKey = process.env.VOICE_API_KEY;

  if (!agentId || !apiKey) {
    return NextResponse.json(
      { error: "VOICE_AGENT_ID or VOICE_API_KEY is not set" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
      { headers: { "xi-api-key": apiKey }, cache: "no-store" }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("ElevenLabs error:", res.status, text);
      return NextResponse.json(
        { error: `ElevenLabs API error: ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({ conversationToken: data.token });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Failed to get conversation token" },
      { status: 500 }
    );
  }
}
