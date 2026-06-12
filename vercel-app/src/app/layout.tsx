import type { Metadata } from "next";
import { Manrope, Tenor_Sans } from "next/font/google";
import "./globals.css";

const tenor = Tenor_Sans({
  weight: "400",
  variable: "--font-tenor",
  subsets: ["latin", "cyrillic"],
});

const manrope = Manrope({
  weight: ["400", "500", "600"],
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Victoria Vasilyeva Holistic Beauty",
  description:
    "Holistic beauty studio — booking and concierge. Egypt & Russia, 10+ years of experience.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${tenor.variable} ${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
