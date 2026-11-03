// Cliente del servicio público de consulta de CFDI del SAT (el mismo que usa "Verificación de CFDI").
// Solo se usa del lado del servidor: el SAT no permite llamadas directas desde el navegador (CORS).

export type ConsultaInput = {
  re: string; // RFC emisor
  rr: string; // RFC receptor
  tt: string; // total
  id: string; // UUID
  fe?: string; // últimos 8 caracteres del sello (opcional)
};

export type EstatusSat = {
  estado: "Vigente" | "Cancelado" | "No Encontrado" | string;
  codigoEstatus: string;
  esCancelable: string;
  estatusCancelacion: string;
  validacionEfos: string;
  enListaEfos: boolean | null;
  consultadoEn: string;
};

const ENDPOINT = "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc";
const SOAP_ACTION = "http://tempuri.org/IConsultaCFDIService/Consulta";

export const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
export const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

/** El SAT pide el total sin ceros no significativos (Anexo 20, código QR). */
export function formatTotal(total: string): string {
  const n = Number(total);
  if (!Number.isFinite(n) || n < 0) throw new Error("Total inválido");
  let s = n.toFixed(6).replace(/0+$/, "");
  if (s.endsWith(".")) s += "0";
  return s;
}

export function buildExpresion(i: ConsultaInput): string {
  const parts = [
    `re=${encodeXml(i.re)}`,
    `rr=${encodeXml(i.rr)}`,
    `tt=${formatTotal(i.tt)}`,
    `id=${i.id}`,
  ];
  if (i.fe) parts.push(`fe=${encodeXml(i.fe)}`);
  return "?" + parts.join("&");
}

function encodeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function envelope(expresion: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <tem:Consulta>
      <tem:expresionImpresa><![CDATA[${expresion}]]></tem:expresionImpresa>
    </tem:Consulta>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function pick(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`));
  return m ? m[1].trim() : "";
}

export function parseRespuesta(xml: string): EstatusSat {
  const validacionEfos = pick(xml, "ValidacionEFOS");
  return {
    estado: pick(xml, "Estado") || "Sin respuesta",
    codigoEstatus: pick(xml, "CodigoEstatus"),
    esCancelable: pick(xml, "EsCancelable"),
    estatusCancelacion: pick(xml, "EstatusCancelacion"),
    validacionEfos,
    // 200 = el emisor NO está en el listado 69-B; 100 = sí está.
    enListaEfos: validacionEfos === "100" ? true : validacionEfos === "200" ? false : null,
    consultadoEn: new Date().toISOString(),
  };
}

export async function consultarSat(input: ConsultaInput, intentos = 2): Promise<EstatusSat> {
  const body = envelope(buildExpresion(input));
  let ultimoError: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: SOAP_ACTION },
        body,
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`SAT respondió ${res.status}`);
      return parseRespuesta(text);
    } catch (e) {
      ultimoError = e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw ultimoError instanceof Error ? ultimoError : new Error("No se pudo consultar al SAT");
}
