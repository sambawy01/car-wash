import type { Metadata } from "next";
import { Manrope, Tenor_Sans, Cairo } from "next/font/google";
import "./globals.css";

const tenor = Tenor_Sans({
  weight: "400",
  variable: "--font-tenor",
  subsets: ["latin"],
});

const manrope = Manrope({
  weight: ["400", "500", "600"],
  variable: "--font-manrope",
  subsets: ["latin"],
});

const cairo = Cairo({
  weight: ["400", "500", "600"],
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

export const metadata: Metadata = {
  title: "Elite Eco Car Wash",
  description:
    "Mobile car wash service in El Gouna, Egypt. We bring the car wash to you!",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${tenor.variable} ${manrope.variable} ${cairo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}