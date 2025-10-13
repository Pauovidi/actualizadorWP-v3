// app/layout.tsx
import "./globals.css"; // 👈 IMPORTANTE

export const metadata = {
  title: "Panel Actualizador WP",
  description: "Gestor de actualizaciones multi-WordPress",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>{children}</body>
    </html>
  );
}
