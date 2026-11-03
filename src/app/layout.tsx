import type { Metadata, Viewport } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://herramientas.totalsecuritysh.com"),
  title: "CFDI Lector: lee y valida facturas ante el SAT · Total Security SH",
  description:
    "Sube tus XML de CFDI 3.3 / 4.0, visualiza sus datos y valida si están vigentes o cancelados ante el SAT, incluida la lista EFOS 69-B. Gratis y sin guardar tus archivos.",
  keywords: ["CFDI", "SAT", "validar factura", "verificar CFDI", "EFOS", "69-B", "XML"],
};

export const viewport: Viewport = { themeColor: "#0b1424" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-MX" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <div className="flex flex-1 flex-col">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
