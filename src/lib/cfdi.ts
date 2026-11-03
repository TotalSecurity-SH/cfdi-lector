// Lector de CFDI (3.3 y 4.0). Corre 100% en el navegador: el XML nunca sale del equipo.

export type Concepto = {
  claveProdServ: string;
  cantidad: number;
  claveUnidad: string;
  descripcion: string;
  valorUnitario: number;
  importe: number;
  descuento: number;
};

export type Impuesto = {
  tipo: "Traslado" | "Retención";
  impuesto: string;
  tasa: string;
  importe: number;
};

export type Cfdi = {
  /** De dónde se leyó: XML completo o representación impresa (PDF). */
  origen?: "xml" | "pdf";
  /** En PDF: datos tomados del código QR o, si no hay, del texto. */
  fuenteDatos?: "qr" | "texto";
  version: string;
  tipo: string;
  serie: string;
  folio: string;
  fecha: string;
  moneda: string;
  formaPago: string;
  metodoPago: string;
  lugarExpedicion: string;
  subTotal: number;
  descuento: number;
  total: number;
  totalRaw: string;
  sello: string;
  emisor: { rfc: string; nombre: string; regimen: string };
  receptor: { rfc: string; nombre: string; usoCfdi: string; regimen: string; domicilio: string };
  conceptos: Concepto[];
  impuestos: Impuesto[];
  totalTrasladados: number;
  totalRetenidos: number;
  timbre: { uuid: string; fechaTimbrado: string; rfcProvCertif: string };
};

const TIPOS: Record<string, string> = { I: "Ingreso", E: "Egreso", T: "Traslado", N: "Nómina", P: "Pago" };
const IMPUESTOS: Record<string, string> = { "001": "ISR", "002": "IVA", "003": "IEPS" };

const num = (v: string | null | undefined) => (v ? Number(v) : 0);

function first(root: Document | Element, localName: string): Element | null {
  return root.getElementsByTagNameNS("*", localName)[0] ?? null;
}

function children(parent: Element | null, localName: string): Element[] {
  if (!parent) return [];
  return Array.from(parent.children).filter((c) => c.localName === localName);
}

export class CfdiError extends Error {}

export function parseCfdi(xml: string): Cfdi {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new CfdiError("El archivo no es un XML válido.");
  }
  const c = first(doc, "Comprobante");
  if (!c) throw new CfdiError("El XML no contiene un nodo Comprobante de CFDI.");

  const version = c.getAttribute("Version") ?? c.getAttribute("version") ?? "";
  if (!["3.3", "4.0"].includes(version)) {
    throw new CfdiError(`Versión de CFDI no soportada (${version || "desconocida"}). Se aceptan 3.3 y 4.0.`);
  }

  const emisor = first(c, "Emisor");
  const receptor = first(c, "Receptor");
  const timbre = first(c, "TimbreFiscalDigital");
  if (!emisor || !receptor) throw new CfdiError("Faltan los datos de Emisor o Receptor.");
  if (!timbre) throw new CfdiError("La factura no está timbrada (no tiene TimbreFiscalDigital).");

  const conceptos = children(first(c, "Conceptos"), "Concepto").map((n) => ({
    claveProdServ: n.getAttribute("ClaveProdServ") ?? "",
    cantidad: num(n.getAttribute("Cantidad")),
    claveUnidad: n.getAttribute("ClaveUnidad") ?? "",
    descripcion: n.getAttribute("Descripcion") ?? "",
    valorUnitario: num(n.getAttribute("ValorUnitario")),
    importe: num(n.getAttribute("Importe")),
    descuento: num(n.getAttribute("Descuento")),
  }));

  // Impuestos a nivel comprobante (hijo directo de Comprobante, no de los conceptos)
  const imp = children(c, "Impuestos")[0] ?? null;
  const impuestos: Impuesto[] = [
    ...children(children(imp, "Traslados")[0] ?? null, "Traslado").map((t) => ({
      tipo: "Traslado" as const,
      impuesto: IMPUESTOS[t.getAttribute("Impuesto") ?? ""] ?? t.getAttribute("Impuesto") ?? "",
      tasa: t.getAttribute("TasaOCuota") ?? t.getAttribute("TipoFactor") ?? "",
      importe: num(t.getAttribute("Importe")),
    })),
    ...children(children(imp, "Retenciones")[0] ?? null, "Retencion").map((t) => ({
      tipo: "Retención" as const,
      impuesto: IMPUESTOS[t.getAttribute("Impuesto") ?? ""] ?? t.getAttribute("Impuesto") ?? "",
      tasa: "",
      importe: num(t.getAttribute("Importe")),
    })),
  ];

  const domicilio = receptor.getAttribute("DomicilioFiscalReceptor") ?? "";
  const totalRaw = c.getAttribute("Total") ?? "0";

  return {
    origen: "xml",
    version,
    tipo: TIPOS[c.getAttribute("TipoDeComprobante") ?? ""] ?? c.getAttribute("TipoDeComprobante") ?? "",
    serie: c.getAttribute("Serie") ?? "",
    folio: c.getAttribute("Folio") ?? "",
    fecha: c.getAttribute("Fecha") ?? "",
    moneda: c.getAttribute("Moneda") ?? "MXN",
    formaPago: c.getAttribute("FormaPago") ?? "",
    metodoPago: c.getAttribute("MetodoPago") ?? "",
    lugarExpedicion: c.getAttribute("LugarExpedicion") ?? "",
    subTotal: num(c.getAttribute("SubTotal")),
    descuento: num(c.getAttribute("Descuento")),
    total: num(totalRaw),
    totalRaw,
    sello: c.getAttribute("Sello") ?? "",
    emisor: {
      rfc: (emisor.getAttribute("Rfc") ?? "").toUpperCase(),
      nombre: emisor.getAttribute("Nombre") ?? "",
      regimen: emisor.getAttribute("RegimenFiscal") ?? "",
    },
    receptor: {
      rfc: (receptor.getAttribute("Rfc") ?? "").toUpperCase(),
      nombre: receptor.getAttribute("Nombre") ?? "",
      usoCfdi: receptor.getAttribute("UsoCFDI") ?? "",
      regimen: receptor.getAttribute("RegimenFiscalReceptor") ?? "",
      domicilio,
    },
    conceptos,
    impuestos,
    totalTrasladados: num(imp?.getAttribute("TotalImpuestosTrasladados")),
    totalRetenidos: num(imp?.getAttribute("TotalImpuestosRetenidos")),
    timbre: {
      uuid: (timbre.getAttribute("UUID") ?? "").toUpperCase(),
      fechaTimbrado: timbre.getAttribute("FechaTimbrado") ?? "",
      rfcProvCertif: timbre.getAttribute("RfcProvCertif") ?? "",
    },
  };
}

export const money = (n: number, moneda = "MXN") =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda.length === 3 ? moneda : "MXN" }).format(n);
