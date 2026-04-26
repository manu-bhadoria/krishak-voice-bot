import Link from "next/link";
import { VoiceCall } from "@/components/VoiceCall";

export default function Home() {
  return (
    <div className="backdrop-hero min-h-screen flex flex-col">
      <header className="nav-glass fixed top-0 left-0 right-0 z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-[56px] flex items-center justify-between">
          <div className="w-7 h-7 rounded-full bg-wheat flex items-center justify-center text-white font-bold text-[13px]">
            कृ
          </div>
          <Link
            href="/dashboard"
            className="text-[11px] text-[#80746a] hover:text-[#1e1812] transition-colors"
          >
            dashboard
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center pt-[72px] pb-10 px-4">
        <VoiceCall />
      </main>
    </div>
  );
}
