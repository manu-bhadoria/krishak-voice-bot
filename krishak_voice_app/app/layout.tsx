import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "डॉ. मोहन यादव — किसान की सीधी लाइन | कृषक कल्याण वर्ष 2026",
  description:
    "खेती-किसानी की हर बात — मुख्यमंत्री से सीधी। मध्य प्रदेश कृषक कल्याण वर्ष 2026।",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="hi">
      <head>
        {/* Preload portrait so first paint has it ready — zero runtime cost. */}
        <link rel="preload" as="image" href="/cm.jpg" fetchPriority="high" />
      </head>
      <body>{children}</body>
    </html>
  );
}
