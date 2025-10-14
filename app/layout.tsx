import "./globals.css";
import type { Metadata } from "next";

import { isDemo } from "@/lib/env";
import DemoBadge from "@/components/DemoBadge";

export const metadata: Metadata = {
  title: "Panel Actualizador WP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {isDemo ? <DemoBadge /> : null}
        {children}
      </body>
    </html>
  );
}
