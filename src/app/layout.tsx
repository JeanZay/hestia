import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hestia — Le quotidien, à sa place",
  description: "Démonstration locale du socle numérique familial Hestia, avec des documents entièrement synthétiques.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
