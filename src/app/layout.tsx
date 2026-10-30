import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SuryaDesk — Solar After-Sales Service Management",
  description: "Keep every solar service on track. SuryaDesk is the operations workspace for solar installation companies: customers, installations, AMC, maintenance, service jobs and verified proof of service.",
  icons: {
    icon: "/suryadesk/icon.svg",
  },
  manifest: "/suryadesk/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#176B52",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased bg-background text-foreground`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
