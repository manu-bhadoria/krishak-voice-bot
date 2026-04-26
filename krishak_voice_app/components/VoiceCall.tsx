"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";

async function getConversationToken(): Promise<string> {
  const r = await fetch("/api/signed-url");
  if (!r.ok) throw new Error("token fetch failed");
  const d = await r.json();
  return d.conversationToken;
}

function CallUI() {
  const [callTime, setCallTime] = useState(0);
  const [micDenied, setMicDenied] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const {
    status,
    isSpeaking,
    isMuted,
    setMuted,
    startSession,
    endSession,
  } = useConversation();

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  useEffect(() => {
    if (isConnected) {
      timerRef.current = setInterval(() => setCallTime((t) => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setCallTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isConnected]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  async function start() {
    setMicDenied(false);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMicDenied(true);
      return;
    }
    const conversationToken = await getConversationToken();
    startSession({ conversationToken, connectionType: "webrtc" });
  }

  const statusLabel = isConnecting
    ? "कनेक्ट हो रहा है..."
    : isConnected
    ? isSpeaking
      ? "बोल रहे हैं..."
      : "सुन रहे हैं..."
    : null;

  return (
    <div className="flex flex-col items-center gap-7 w-full max-w-md mx-auto">
      <div className="relative">
        {isConnected && isSpeaking && (
          <>
            <span className="absolute inset-0 rounded-full border border-[#c89b3c] speaking-ring" aria-hidden />
            <span className="absolute inset-0 rounded-full border border-[#c89b3c] speaking-ring" style={{ animationDelay: "0.55s" }} aria-hidden />
          </>
        )}
        <div
          className={`relative rounded-full overflow-hidden transition-all duration-300 bg-white ${
            isConnected
              ? "w-52 h-52 border-2 border-[#c89b3c]/80 shadow-[0_0_50px_-10px_rgba(200,155,60,0.45)]"
              : "w-48 h-48 border border-[#d9c9a6] shadow-[0_12px_30px_-12px_rgba(80,60,30,0.25)]"
          } subtle-float`}
        >
          <img
            src="/cm.jpg"
            alt="मुख्यमंत्री डॉक्टर मोहन यादव"
            width={208}
            height={208}
            decoding="async"
            fetchPriority="high"
            className="w-full h-full object-cover object-center select-none"
            draggable={false}
          />
        </div>
      </div>

      <div className="text-center">
        <p className="kicker mb-2">मुख्यमंत्री · कृषक कल्याण वर्ष 2026</p>
        <h1 className="hindi-serif text-[24px] sm:text-[26px] leading-tight text-[#1e1812]">
          डॉ. मोहन यादव — किसान की सीधी लाइन
        </h1>
        <p className="mt-2 text-[12px] text-[#4a4035] leading-relaxed">
          खेती-किसानी की हर बात — मुख्यमंत्री से सीधी
        </p>
        {(isConnected || isConnecting) && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-[#c89b3c] soft-pulse"
              aria-hidden
            />
            {statusLabel && (
              <span className="text-[11px] text-[#80746a]">{statusLabel}</span>
            )}
            {isConnected && (
              <span className="text-[11px] text-[#80746a] font-mono ml-1">
                · {fmt(callTime)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="w-full flex flex-col items-center gap-3">
        {!isConnected ? (
          <button
            onClick={start}
            disabled={isConnecting}
            className="btn-wheat w-full max-w-xs rounded-full px-6 py-3.5 text-[15px] font-semibold"
          >
            {isConnecting ? "कनेक्ट हो रहा है..." : "बात करें"}
          </button>
        ) : (
          <div className="flex gap-2 w-full max-w-xs">
            <button
              onClick={() => setMuted(!isMuted)}
              className="btn-ghost flex-1 rounded-full px-4 py-3 text-[13px]"
            >
              {isMuted ? "अनम्यूट" : "म्यूट"}
            </button>
            <button
              onClick={() => endSession()}
              className="btn-danger flex-1 rounded-full px-4 py-3 text-[13px]"
            >
              समाप्त
            </button>
          </div>
        )}

        {micDenied && (
          <p className="text-[11px] text-red-600 text-center leading-relaxed">
            माइक्रोफोन की अनुमति चाहिए। ब्राउज़र सेटिंग से अनुमति देकर पुनः प्रयास करें।
          </p>
        )}
      </div>

    </div>
  );
}

export function VoiceCall() {
  return (
    <ConversationProvider>
      <CallUI />
    </ConversationProvider>
  );
}
