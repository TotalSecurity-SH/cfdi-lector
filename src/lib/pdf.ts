// Lectura de la representación impresa (PDF) de un CFDI, 100% en el navegador.
// 1) Busca el código QR del SAT, que trae RFC emisor, RFC receptor, total, UUID y el final del sello.
// 2) Si no hay QR legible, extrae los datos del texto del PDF.

import jsQR from "jsqr";
import { CfdiError, type Cfdi } from "@/lib/cfdi";
import { RFC_RE, UUID_RE } from "@/lib/sat";

type DatosConsulta = { re: string; rr: string; tt: string; id: string; fe: string; fuente: "qr" | "texto" };

const UUID_EN_TEXTO = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;
const RFC_EN_TEXTO = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g;

async function cargarPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return pdfjs;
}

/** Interpreta la URL del QR: https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=…&re=…&rr=…&tt=…&fe=… */
export function leerQrSat(texto: string): Omit<DatosConsulta, "fuente"> | null {
  const i = texto.indexOf("?");
  if (i < 0) return null;
  const p = new URLSearchParams(texto.slice(i + 1).replace(/&amp;/g, "&"));
  const id = (p.get("id") ?? "").toUpperCase();
  const re = (p.get("re") ?? "").toUpperCase();
  const rr = (p.get("rr") ?? "").toUpperCase();
  const tt = p.get("tt") ?? "";
  if (!UUID_RE.test(id) || !RFC_RE.test(re) || !RFC_RE.test(rr) || !tt) return null;
  return { id, re, rr, tt: String(Number(tt)), fe: p.get("fe") ?? "" };
}

/** Plan B: datos desde el texto. Supone que el primer RFC es el emisor y el siguiente distinto, el receptor. */
export function leerTexto(texto: string): Omit<DatosConsulta, "fuente"> | null {
  const id = texto.match(UUID_EN_TEXTO)?.[0].toUpperCase();
  const rfcs = [...new Set((texto.toUpperCase().match(RFC_EN_TEXTO) ?? []).filter((r) => RFC_RE.test(r)))];
  const totales = [...texto.matchAll(/total[^\d$]{0,20}\$?\s*([\d,]+\.\d{2})/gi)].map((m) => m[1].replace(/,/g, ""));
  const tt = totales.at(-1);
  if (!id || rfcs.length < 2 || !tt) return null;
  return { id, re: rfcs[0], rr: rfcs[1], tt, fe: "" };
}

async function buscarQr(pagina: import("pdfjs-dist").PDFPageProxy): Promise<string | null> {
  for (const escala of [2, 3]) {
    const viewport = pagina.getViewport({ scale: escala });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    await pagina.render({ canvasContext: ctx, viewport }).promise;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
    if (qr?.data) return qr.data;
  }
  return null;
}

export async function parsePdf(archivo: File): Promise<Cfdi> {
  const pdfjs = await cargarPdfjs();
  let doc: import("pdfjs-dist").PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) }).promise;
  } catch {
    throw new CfdiError("No se pudo abrir el PDF. Verifica que no esté dañado ni protegido con contraseña.");
  }

  let datos: DatosConsulta | null = null;
  let texto = "";
  const paginas = Math.min(doc.numPages, 3);

  for (let n = 1; n <= paginas && !datos; n++) {
    const pagina = await doc.getPage(n);
    const contenido = await pagina.getTextContent();
    texto += " " + contenido.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    const qr = await buscarQr(pagina);
    const deQr = qr ? leerQrSat(qr) : null;
    if (deQr) datos = { ...deQr, fuente: "qr" };
  }
  if (!datos) {
    const deTexto = leerTexto(texto);
    if (deTexto) datos = { ...deTexto, fuente: "texto" };
  }
  await doc.destroy();

  if (!datos) {
    throw new CfdiError("No encontramos el código QR ni los datos fiscales en el PDF. Sube el XML o usa la consulta manual.");
  }

  const total = Number(datos.tt);
  return {
    origen: "pdf",
    fuenteDatos: datos.fuente,
    version: "—",
    tipo: "Representación impresa (PDF)",
    serie: "",
    folio: "",
    fecha: "",
    moneda: "MXN",
    formaPago: "",
    metodoPago: "",
    lugarExpedicion: "",
    subTotal: total,
    descuento: 0,
    total,
    totalRaw: datos.tt,
    sello: datos.fe,
    emisor: { rfc: datos.re, nombre: "", regimen: "" },
    receptor: { rfc: datos.rr, nombre: "", usoCfdi: "", regimen: "", domicilio: "" },
    conceptos: [],
    impuestos: [],
    totalTrasladados: 0,
    totalRetenidos: 0,
    timbre: { uuid: datos.id, fechaTimbrado: "", rfcProvCertif: "" },
  };
}
