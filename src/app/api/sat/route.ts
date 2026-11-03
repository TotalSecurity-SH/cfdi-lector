import type { NextRequest } from "next/server";
import { consultarSat, RFC_RE, UUID_RE, type EstatusSat } from "@/lib/sat";

export const maxDuration = 30;

// Límite simple por IP (best-effort por instancia) para evitar abuso del servicio del SAT.
const VENTANA_MS = 60_000;
const MAX_POR_VENTANA = 60;
const hits = new Map<string, { n: number; t: number }>();

function limitado(ip: string) {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > VENTANA_MS) hits.delete(k);
  const h = hits.get(ip);
  if (!h || now - h.t > VENTANA_MS) {
    hits.set(ip, { n: 1, t: now });
    return false;
  }
  h.n++;
  return h.n > MAX_POR_VENTANA;
}

function error(status: number, mensaje: string) {
  return Response.json({ ok: false, mensaje }, { status });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limitado(ip)) return error(429, "Demasiadas consultas. Espera un minuto e intenta de nuevo.");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error(400, "Solicitud inválida.");
  }

  const re = String(body.re ?? "").trim().toUpperCase();
  const rr = String(body.rr ?? "").trim().toUpperCase();
  const tt = String(body.tt ?? "").trim();
  const id = String(body.id ?? "").trim().toUpperCase();
  const fe = String(body.fe ?? "").trim().slice(-8);

  if (!RFC_RE.test(re)) return error(400, "El RFC del emisor no tiene un formato válido.");
  if (!RFC_RE.test(rr)) return error(400, "El RFC del receptor no tiene un formato válido.");
  if (!UUID_RE.test(id)) return error(400, "El folio fiscal (UUID) no tiene un formato válido.");
  if (!/^\d{1,18}(\.\d{1,6})?$/.test(tt)) return error(400, "El total no tiene un formato válido.");
  if (!/^[A-Za-z0-9+/=]{0,8}$/.test(fe)) return error(400, "El sello no tiene un formato válido.");

  // Modo demo para desarrollo local sin acceso al SAT (no se usa en producción).
  if (process.env.SAT_MOCK === "1") {
    const demo: EstatusSat = {
      estado: id.endsWith("0") ? "Cancelado" : "Vigente",
      codigoEstatus: "S - Comprobante obtenido satisfactoriamente.",
      esCancelable: "Cancelable con aceptación",
      estatusCancelacion: "",
      validacionEfos: "200",
      enListaEfos: false,
      consultadoEn: new Date().toISOString(),
    };
    return Response.json({ ok: true, estatus: demo, demo: true });
  }

  try {
    const estatus = await consultarSat({ re, rr, tt, id, fe: fe || undefined });
    return Response.json({ ok: true, estatus });
  } catch {
    return error(502, "El servicio del SAT no respondió. Suele pasar en horas pico o cierre de mes; intenta en unos minutos.");
  }
}
