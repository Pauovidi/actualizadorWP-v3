import './globals.css';

export const metadata = {
  title: 'Actualitzador WP — Dashboard',
  description: 'Actualizar sitios WP y descargar informes',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
