import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const titleFont = localFont({ src: "./fonts/BricolageGrotesque.ttf", variable: "--font-hestia-title", weight: "200 800", display: "swap" });
const textFont = localFont({ src: [{ path: "./fonts/AtkinsonHyperlegible-Regular.ttf", weight: "400", style: "normal" }, { path: "./fonts/AtkinsonHyperlegible-Bold.ttf", weight: "700", style: "normal" }], variable: "--font-hestia-text", display: "swap" });

export const metadata: Metadata = {
  title: "Hestia — Documents",
  description: "Les documents de votre foyer, dans un espace privé.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr" className={`${titleFont.variable} ${textFont.variable}`}><body>{children}</body></html>;
}
