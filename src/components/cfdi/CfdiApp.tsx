"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseCfdi, money, CfdiError, type Cfdi } from "@/lib/cfdi";
import type { EstatusSat } from "@/lib/sat";
import { BASE_PATH, LINKS } from "@/lib/site";
import { parsePdf } from "@/lib/pdf";

type Fila = {
  key: string;
  archivo: string;
  cfdi?: Cfdi;
  errorLectura?: string;
  sat: "pendiente" | "consultando" | "listo" | "error";
  estatus?: EstatusSat;
  errorSat?: string;
};

const MAX_ARCHIVOS = 200;
const CONCURRENCIA = 3;

async function consultar(datos: { re: string; rr: string; tt: string; id: string; fe?: string }) {
  const res = await fetch(`${BASE_PATH}/api/sat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  });
  const json = await res.json().catch(() => ({ ok: false, mensaje: "Respuesta inválida del servidor." }));
  if (!json.ok) throw new Error(json.mensaje ?? "No se pudo consultar.");
  return json.estatus as EstatusSat;
}

function fmtFecha(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

function safeMoney(n: number, m?: string) {
  try {
    return money(n, m);
  } catch {
    return money(n);
  }
}

/* ---------- UI atoms ---------- */

function Badge({ fila }: { fila: Fila }) {
  const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap";
  if (fila.errorLectura) return <span className={`${base} bg-bad/15 text-bad`}>{/\.pdf$/i.test(fila.archivo) ? "PDF no legible" : "XML inválido"}</span>;
  if (fila.sat === "consultando" || fila.sat === "pendiente")
    return (
      <span className={`${base} bg-steel/15 text-steel`}>
        <span className="spin inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent" />
        Consultando
      </span>
    );
  if (fila.sat === "error") return <span className={`${base} bg-warn/20 text-warn`}>Sin respuesta SAT</span>;
  const e = fila.estatus?.estado ?? "";
  if (e === "Vigente") return <span className={`${base} bg-ok/15 text-ok`}>● Vigente</span>;
  if (e === "Cancelado") return <span className={`${base} bg-bad/15 text-bad`}>● Cancelado</span>;
  return <span className={`${base} bg-warn/20 text-warn`}>● {e || "No encontrado"}</span>;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className={`text-2xl font-bold ${tone ?? ""}`}>{value}</div>
      <div className="muted text-xs">{label}</div>
    </div>
  );
}

function Campo({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="muted text-[11px] uppercase tracking-wider">{label}</div>
      <div className={`break-all text-sm font-medium ${mono ? "font-mono" : ""}`}>{value || "—"}</div>
    </div>
  );
}

/* ---------- Main ---------- */

export default function CfdiApp() {
  const [tab, setTab] = useState<"xml" | "manual">("xml");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filasRef = useRef<Fila[]>([]);
  useEffect(() => {
    filasRef.current = filas;
  }, [filas]);

  const actualizar = useCallback((key: string, patch: Partial<Fila>) => {
    setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }, []);

  const validarEnSat = useCallback(
    async (lista: Fila[]) => {
      const cola = lista.filter((f) => f.cfdi);
      const worker = async () => {
        while (cola.length) {
          const f = cola.shift()!;
          const c = f.cfdi!;
          actualizar(f.key, { sat: "consultando" });
          try {
            const estatus = await consultar({
              re: c.emisor.rfc,
              rr: c.receptor.rfc,
              tt: c.totalRaw,
              id: c.timbre.uuid,
              fe: c.sello.slice(-8),
            });
            actualizar(f.key, { sat: "listo", estatus, errorSat: undefined });
          } catch (e) {
            actualizar(f.key, { sat: "error", errorSat: (e as Error).message });
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCIA }, worker));
    },
    [actualizar],
  );

  const procesarTextos = useCallback(
    (items: { nombre: string; texto?: string; cfdi?: Cfdi; error?: string }[]) => {
      const nuevas: Fila[] = items.map(({ nombre, texto, cfdi, error }, i) => {
        const key = `${Date.now()}-${i}-${nombre}`;
        if (error) return { key, archivo: nombre, errorLectura: error, sat: "error" };
        try {
          return { key, archivo: nombre, cfdi: cfdi ?? parseCfdi(texto ?? ""), sat: "pendiente" };
        } catch (e) {
          return {
            key,
            archivo: nombre,
            errorLectura: e instanceof CfdiError ? e.message : "No se pudo leer el archivo.",
            sat: "error",
          };
        }
      });
      // Evita duplicados por UUID (contra lo ya cargado y dentro del mismo lote)
      const vistos = new Set(filasRef.current.map((f) => f.cfdi?.timbre.uuid).filter(Boolean));
      const unicas = nuevas.filter((f) => {
        if (!f.cfdi) return true;
        if (vistos.has(f.cfdi.timbre.uuid)) return false;
        vistos.add(f.cfdi.timbre.uuid);
        return true;
      });
      if (unicas.length < nuevas.length) setAviso(`Se omitieron ${nuevas.length - unicas.length} factura(s) repetidas.`);
      if (!unicas.length) return;
      filasRef.current = [...unicas, ...filasRef.current];
      setFilas(filasRef.current);
      setSeleccion((unicas.find((f) => f.cfdi) ?? unicas[0]).key);
      void validarEnSat(unicas);
    },
    [validarEnSat],
  );

  const onArchivos = useCallback(
    async (files: FileList | File[]) => {
      setAviso(null);
      const lista = Array.from(files).filter((f) => /\.(xml|pdf)$/i.test(f.name));
      if (!lista.length) {
        setAviso("Solo se aceptan archivos .xml o .pdf de CFDI.");
        return;
      }
      if (lista.length > MAX_ARCHIVOS) setAviso(`Se procesarán solo los primeros ${MAX_ARCHIVOS} archivos.`);
      const hayPdf = lista.some((f) => /\.pdf$/i.test(f.name));
      if (hayPdf) setLeyendo(true);
      const items = await Promise.all(
        lista.slice(0, MAX_ARCHIVOS).map(async (f) => {
          if (!/\.pdf$/i.test(f.name)) return { nombre: f.name, texto: await f.text() };
          try {
            return { nombre: f.name, cfdi: await parsePdf(f) };
          } catch (e) {
            return { nombre: f.name, error: e instanceof CfdiError ? e.message : "No se pudo leer el PDF." };
          }
        }),
      );
      setLeyendo(false);
      procesarTextos(items);
    },
    [procesarTextos],
  );

  const cargarEjemplo = async () => {
    const texto = await fetch(`${BASE_PATH}/ejemplo-cfdi.xml`).then((r) => r.text());
    procesarTextos([{ nombre: "ejemplo-cfdi.xml", texto }]);
  };

  const reintentar = (f: Fila) => {
    if (!f.cfdi) return;
    void validarEnSat([f]);
  };

  const resumen = useMemo(() => {
    const ok = filas.filter((f) => f.estatus?.estado === "Vigente");
    return {
      total: filas.length,
      vigentes: ok.length,
      canceladas: filas.filter((f) => f.estatus?.estado === "Cancelado").length,
      otras: filas.filter((f) => f.errorLectura || f.sat === "error" || (f.estatus && !["Vigente", "Cancelado"].includes(f.estatus.estado))).length,
      efos: filas.filter((f) => f.estatus?.enListaEfos).length,
      monto: ok.reduce((s, f) => s + (f.cfdi?.total ?? 0), 0),
    };
  }, [filas]);

  const exportar = () => {
    const cols = ["Archivo", "Estado SAT", "Cancelable", "Lista EFOS", "UUID", "Fecha", "Tipo", "Serie", "Folio", "RFC Emisor", "Emisor", "RFC Receptor", "Receptor", "Subtotal", "Descuento", "IVA/Trasladados", "Retenidos", "Total", "Moneda"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filas.map((f) => {
      const c = f.cfdi;
      return [
        f.archivo,
        f.errorLectura ?? f.estatus?.estado ?? f.errorSat ?? "",
        f.estatus?.esCancelable,
        f.estatus?.enListaEfos == null ? "" : f.estatus.enListaEfos ? "SÍ" : "No",
        c?.timbre.uuid, c?.fecha, c?.tipo, c?.serie, c?.folio,
        c?.emisor.rfc, c?.emisor.nombre, c?.receptor.rfc, c?.receptor.nombre,
        c?.subTotal, c?.descuento, c?.totalTrasladados, c?.totalRetenidos, c?.total, c?.moneda,
      ].map(esc).join(",");
    });
    const blob = new Blob(["﻿" + [cols.map(esc).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `validacion-cfdi-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sel = filas.find((f) => f.key === seleccion);

  return (
    <div className="flex flex-1 flex-col">
      {/* ---------- Hero ---------- */}
      <header className="hero-grid relative overflow-hidden text-[#eef2f7]">
        <div className="accent-bar absolute inset-x-0 top-0 h-1" />
        <div className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
          <nav className="flex items-center gap-2 font-mono text-xs text-[#93a1b5]" aria-label="Ruta">
            <a href={LINKS.hub} className="hover:text-white">herramientas</a>
            <span>/</span>
            <span className="text-teal">cfdi</span>
          </nav>
          <h1 className="fade-up mt-8 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">
            Lee y valida tus facturas <span className="text-teal">CFDI</span> ante el SAT
          </h1>
          <p className="fade-up mt-4 max-w-2xl text-[#93a1b5] sm:text-lg" style={{ animationDelay: ".1s" }}>
            Sube uno o cientos de XML o PDF y conoce al instante si están <b className="text-white">vigentes</b> o{" "}
            <b className="text-white">cancelados</b>, y si el emisor aparece en la lista negra <b className="text-white">EFOS 69-B</b>.
          </p>
          <div className="fade-up mt-6 flex flex-wrap gap-2 text-xs" style={{ animationDelay: ".2s" }}>
            {["XML y PDF", "CFDI 3.3 y 4.0", "Validación oficial SAT", "Carga masiva", "Exporta a Excel", "Tus archivos no se guardan"].map((t) => (
              <span key={t} className="rounded-full border border-teal/40 bg-teal/10 px-3 py-1 text-[#cfe9ef]">
                {t}
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-16 w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6">
        {/* ---------- Entrada ---------- */}
        <section className="card fade-up p-2 shadow-xl shadow-black/5" style={{ animationDelay: ".25s" }}>
          <div className="flex gap-1 p-1" role="tablist">
            {(
              [
                ["xml", "Subir archivos"],
                ["manual", "Consulta manual"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  tab === k ? "bg-navy-900 text-white dark:bg-teal/20 dark:text-teal" : "muted hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {tab === "xml" ? (
            <div className="p-2">
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setArrastrando(true);
                }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setArrastrando(false);
                  void onArchivos(e.dataTransfer.files);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
                  arrastrando ? "border-teal bg-teal/10" : "border-[var(--line)] hover:border-teal/70 hover:bg-teal/5"
                }`}
              >
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" className="text-teal" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <p className="mt-3 text-base font-semibold">{leyendo ? "Leyendo PDF…" : "Arrastra tus archivos XML o PDF aquí"}</p>
                <p className="muted mt-1 text-sm">o haz clic para seleccionarlos · hasta {MAX_ARCHIVOS} a la vez</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xml,.pdf,text/xml,application/xml,application/pdf"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    if (e.target.files) void onArchivos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="muted text-xs">🔒 Tus archivos se leen en tu navegador. Solo se envían RFC, total y UUID al SAT para validar.</p>
                <button onClick={cargarEjemplo} className="text-sm font-semibold text-teal-dark hover:underline dark:text-teal">
                  Probar con una factura de ejemplo →
                </button>
              </div>
            </div>
          ) : (
            <ConsultaManual
              onResultado={(fila) => {
                setFilas((prev) => [fila, ...prev]);
                setSeleccion(fila.key);
              }}
            />
          )}
        </section>

        {aviso && (
          <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-2 text-sm" role="status">
            {aviso}
          </p>
        )}

        {/* ---------- Resultados ---------- */}
        {filas.length > 0 && (
          <section className="mt-8 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Facturas" value={resumen.total} />
              <Stat label="Vigentes" value={resumen.vigentes} tone="text-ok" />
              <Stat label="Canceladas" value={resumen.canceladas} tone="text-bad" />
              <Stat label="Por revisar" value={resumen.otras} tone="text-warn" />
              <Stat label="Emisor en EFOS" value={resumen.efos} tone={resumen.efos ? "text-bad" : ""} />
              <Stat label="Monto vigente" value={safeMoney(resumen.monto)} />
            </div>

            <div className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
                <h2 className="font-semibold">Resultados</h2>
                <div className="flex gap-2">
                  <button
                    onClick={exportar}
                    className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-navy-800 dark:bg-teal/20 dark:text-teal"
                  >
                    Exportar a Excel
                  </button>
                  <button
                    onClick={() => {
                      setFilas([]);
                      setSeleccion(null);
                      setAviso(null);
                    }}
                    className="muted rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm hover:text-bad"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="muted text-left text-[11px] uppercase tracking-wider">
                      <th className="px-4 py-2 font-medium">Estado SAT</th>
                      <th className="px-4 py-2 font-medium">Emisor</th>
                      <th className="hidden px-4 py-2 font-medium md:table-cell">Receptor</th>
                      <th className="hidden px-4 py-2 font-medium sm:table-cell">Fecha</th>
                      <th className="px-4 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => (
                      <tr
                        key={f.key}
                        onClick={() => setSeleccion(f.key)}
                        className={`cursor-pointer border-t border-[var(--line)] transition hover:bg-teal/5 ${
                          seleccion === f.key ? "bg-teal/10" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <Badge fila={f} />
                        </td>
                        <td className="max-w-[160px] px-4 py-3 sm:max-w-[220px]">
                          <div className="truncate font-medium">{f.cfdi?.emisor.nombre || f.archivo}</div>
                          <div className="muted truncate font-mono text-xs">{f.cfdi?.emisor.rfc ?? f.errorLectura}</div>
                        </td>
                        <td className="hidden max-w-[220px] px-4 py-3 md:table-cell">
                          <div className="truncate">{f.cfdi?.receptor.nombre}</div>
                          <div className="muted truncate font-mono text-xs">{f.cfdi?.receptor.rfc}</div>
                        </td>
                        <td className="muted hidden whitespace-nowrap px-4 py-3 sm:table-cell">{f.cfdi ? fmtFecha(f.cfdi.fecha) : "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                          {f.cfdi ? safeMoney(f.cfdi.total, f.cfdi.moneda) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {sel && <Detalle fila={sel} onReintentar={() => reintentar(sel)} />}
          </section>
        )}

        {filas.length === 0 && <ComoFunciona />}
      </main>

      <p className="muted mx-auto max-w-6xl px-4 pb-8 text-xs sm:px-6">
        Herramienta independiente, sin relación con el SAT. Consulta el servicio público de verificación de CFDI.
      </p>
    </div>
  );
}

/* ---------- Detalle ---------- */

function Detalle({ fila, onReintentar }: { fila: Fila; onReintentar: () => void }) {
  const c = fila.cfdi;
  if (!c)
    return (
      <div className="card fade-up p-5">
        <h3 className="font-semibold">{fila.archivo}</h3>
        <p className="mt-1 text-sm text-bad">{fila.errorLectura}</p>
      </div>
    );
  const e = fila.estatus;
  const tono =
    e?.estado === "Vigente" ? "border-ok/50 bg-ok/10 text-ok" : e?.estado === "Cancelado" ? "border-bad/50 bg-bad/10 text-bad" : "border-warn/50 bg-warn/10 text-warn";

  return (
    <div className="card fade-up overflow-hidden" key={fila.key}>
      <div className="accent-bar h-1" />
      <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-6">
          <div>
            <div className="muted text-xs">
              {c.origen === "pdf" ? c.tipo : `${c.tipo} · CFDI ${c.version}${c.serie || c.folio ? ` · ${c.serie}${c.folio}` : ""}`}
            </div>
            <h3 className="mt-1 text-xl font-bold">{c.emisor.nombre || c.emisor.rfc}</h3>
            <div className="muted font-mono text-xs">{c.timbre.uuid}</div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--line)] p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-teal-dark dark:text-teal">Emisor</div>
              <div className="space-y-2">
                <Campo label="RFC" value={c.emisor.rfc} mono />
                <Campo label="Nombre" value={c.emisor.nombre} />
                <Campo label="Régimen fiscal" value={c.emisor.regimen} />
              </div>
            </div>
            <div className="rounded-xl border border-[var(--line)] p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-steel">Receptor</div>
              <div className="space-y-2">
                <Campo label="RFC" value={c.receptor.rfc} mono />
                <Campo label="Nombre" value={c.receptor.nombre} />
                <Campo label="Uso CFDI" value={c.receptor.usoCfdi} />
              </div>
            </div>
          </div>

          <div className={`grid grid-cols-2 gap-4 sm:grid-cols-4 ${c.origen === "pdf" ? "hidden" : ""}`}>
            <Campo label="Fecha de emisión" value={fmtFecha(c.fecha)} />
            <Campo label="Fecha de timbrado" value={fmtFecha(c.timbre.fechaTimbrado)} />
            <Campo label="Método de pago" value={c.metodoPago} />
            <Campo label="Forma de pago" value={c.formaPago} />
          </div>

          {c.origen === "pdf" && (
            <p className="rounded-xl border border-steel/40 bg-steel/10 px-4 py-3 text-sm">
              Datos tomados {c.fuenteDatos === "qr" ? "del código QR" : "del texto"} del PDF. Para ver conceptos, impuestos y
              nombres, sube el <b>XML</b> de la factura.
            </p>
          )}

          {c.conceptos.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="muted text-left text-[11px] uppercase tracking-wider">
                    <th className="px-3 py-2 font-medium">Concepto</th>
                    <th className="px-3 py-2 text-right font-medium">Cant.</th>
                    <th className="px-3 py-2 text-right font-medium">Valor unit.</th>
                    <th className="px-3 py-2 text-right font-medium">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {c.conceptos.map((k, i) => (
                    <tr key={i} className="border-t border-[var(--line)]">
                      <td className="px-3 py-2">
                        <div>{k.descripcion}</div>
                        <div className="muted font-mono text-[11px]">{k.claveProdServ} · {k.claveUnidad}</div>
                      </td>
                      <td className="px-3 py-2 text-right">{k.cantidad}</td>
                      <td className="px-3 py-2 text-right">{safeMoney(k.valorUnitario, c.moneda)}</td>
                      <td className="px-3 py-2 text-right font-medium">{safeMoney(k.importe, c.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Lateral: estatus + totales */}
        <aside className="order-first min-w-0 space-y-4 lg:order-none">
          <div className={`rounded-xl border-2 p-4 text-center ${fila.sat === "listo" ? tono : "border-[var(--line)]"}`}>
            <div className="text-[11px] uppercase tracking-widest opacity-80">Estatus ante el SAT</div>
            {fila.sat === "listo" ? (
              <div className="mt-1 text-2xl font-extrabold tracking-wide">{e?.estado.toUpperCase()}</div>
            ) : fila.sat === "error" ? (
              <>
                <div className="mt-1 text-base font-bold text-warn">Sin respuesta</div>
                <p className="muted mt-1 text-xs">{fila.errorSat}</p>
                <button onClick={onReintentar} className="mt-2 text-sm font-semibold text-teal-dark hover:underline dark:text-teal">
                  Reintentar
                </button>
              </>
            ) : (
              <div className="muted mt-2 text-sm">Consultando…</div>
            )}
          </div>

          {fila.sat === "listo" && e && (
            <div className="space-y-3 rounded-xl border border-[var(--line)] p-4">
              <Campo label="¿Es cancelable?" value={e.esCancelable} />
              {e.estatusCancelacion && <Campo label="Estatus de cancelación" value={e.estatusCancelacion} />}
              <Campo
                label="Lista EFOS 69-B"
                value={
                  e.enListaEfos == null ? (
                    "Sin dato"
                  ) : e.enListaEfos ? (
                    <span className="text-bad">⚠ El emisor SÍ aparece</span>
                  ) : (
                    <span className="text-ok">✓ El emisor no aparece</span>
                  )
                }
              />
              <p className="muted text-[11px]">Consultado: {fmtFecha(e.consultadoEn)}</p>
            </div>
          )}

          <div className="space-y-2 rounded-xl border border-[var(--line)] p-4 text-sm">
            <div className={`flex justify-between ${c.origen === "pdf" ? "hidden" : ""}`}><span className="muted">Subtotal</span><span>{safeMoney(c.subTotal, c.moneda)}</span></div>
            {c.descuento > 0 && <div className="flex justify-between"><span className="muted">Descuento</span><span>-{safeMoney(c.descuento, c.moneda)}</span></div>}
            {c.impuestos.map((t, i) => (
              <div key={i} className="flex justify-between">
                <span className="muted">
                  {t.impuesto} {t.tipo === "Retención" ? "retenido" : t.tasa ? `${(Number(t.tasa) * 100).toFixed(0)}%` : ""}
                </span>
                <span>{t.tipo === "Retención" ? "-" : ""}{safeMoney(t.importe, c.moneda)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-[var(--line)] pt-2 text-base font-bold">
              <span>Total</span>
              <span>{safeMoney(c.total, c.moneda)}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ---------- Consulta manual ---------- */

function ConsultaManual({ onResultado }: { onResultado: (f: Fila) => void }) {
  const [v, setV] = useState({ re: "", rr: "", tt: "", id: "" });
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr(null);
    setCargando(true);
    const key = `manual-${Date.now()}`;
    const cfdi: Cfdi = {
      version: "—", tipo: "Consulta manual", serie: "", folio: "", fecha: "", moneda: "MXN", formaPago: "", metodoPago: "",
      lugarExpedicion: "", subTotal: Number(v.tt), descuento: 0, total: Number(v.tt), totalRaw: v.tt, sello: "",
      emisor: { rfc: v.re.toUpperCase(), nombre: "", regimen: "" },
      receptor: { rfc: v.rr.toUpperCase(), nombre: "", usoCfdi: "", regimen: "", domicilio: "" },
      conceptos: [], impuestos: [], totalTrasladados: 0, totalRetenidos: 0,
      timbre: { uuid: v.id.toUpperCase(), fechaTimbrado: "", rfcProvCertif: "" },
    };
    try {
      const estatus = await consultar({ re: v.re, rr: v.rr, tt: v.tt, id: v.id });
      onResultado({ key, archivo: "Consulta manual", cfdi, sat: "listo", estatus });
      setV({ re: "", rr: "", tt: "", id: "" });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCargando(false);
    }
  };

  const input =
    "w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2.5 font-mono text-sm uppercase outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/25";

  return (
    <form onSubmit={submit} className="grid gap-4 p-3 sm:grid-cols-2">
      <label className="space-y-1">
        <span className="muted text-xs font-medium">RFC del emisor</span>
        <input required className={input} value={v.re} onChange={(e) => setV({ ...v, re: e.target.value })} placeholder="EKU9003173C9" maxLength={13} />
      </label>
      <label className="space-y-1">
        <span className="muted text-xs font-medium">RFC del receptor</span>
        <input required className={input} value={v.rr} onChange={(e) => setV({ ...v, rr: e.target.value })} placeholder="XAXX010101000" maxLength={13} />
      </label>
      <label className="space-y-1">
        <span className="muted text-xs font-medium">Total de la factura</span>
        <input required inputMode="decimal" className={input} value={v.tt} onChange={(e) => setV({ ...v, tt: e.target.value.replace(/[^\d.]/g, "") })} placeholder="13920.00" />
      </label>
      <label className="space-y-1">
        <span className="muted text-xs font-medium">Folio fiscal (UUID)</span>
        <input required className={input} value={v.id} onChange={(e) => setV({ ...v, id: e.target.value })} placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" maxLength={36} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button
          disabled={cargando}
          className="rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-60 dark:bg-teal dark:text-navy-950"
        >
          {cargando ? "Consultando al SAT…" : "Validar factura"}
        </button>
        {err && <p className="text-sm text-bad">{err}</p>}
        <p className="muted text-xs">Los 4 datos vienen impresos en el PDF de la factura.</p>
      </div>
    </form>
  );
}

/* ---------- Estado vacío ---------- */

function ComoFunciona() {
  const pasos = [
    ["01", "Sube tus XML o PDF", "Arrastra uno o varios CFDI 3.3 / 4.0. Del PDF leemos el código QR. Todo se procesa en tu navegador."],
    ["02", "Validamos con el SAT", "Consultamos el servicio oficial de verificación: vigente, cancelado y si el emisor está en la lista EFOS."],
    ["03", "Revisa y exporta", "Ve el detalle de cada factura —conceptos, impuestos, totales— y descarga todo a Excel."],
  ];
  return (
    <section className="mt-10 grid gap-4 sm:grid-cols-3">
      {pasos.map(([n, t, d], i) => (
        <div key={n} className="card fade-up p-5" style={{ animationDelay: `${0.35 + i * 0.1}s` }}>
          <div className="font-mono text-sm font-bold text-teal-dark dark:text-teal">{n}</div>
          <h3 className="mt-2 font-semibold">{t}</h3>
          <p className="muted mt-1 text-sm leading-relaxed">{d}</p>
        </div>
      ))}
    </section>
  );
}
