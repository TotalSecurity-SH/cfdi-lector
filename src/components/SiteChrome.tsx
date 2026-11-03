import { LINKS } from "@/lib/site";

// Header y footer de la marca. Se usan <a> (no next/link) porque el catálogo vive en otra zona (el hub).

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-navy-950">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href={LINKS.hub} className="flex items-center gap-2.5" aria-label="Catálogo de herramientas">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-teal to-steel text-[13px] font-extrabold text-navy-950">
            TS
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold text-white">Total Security SH</span>
            <span className="block font-mono text-[11px] text-teal">/herramientas</span>
          </span>
        </a>
        <nav className="flex items-center gap-1 text-sm" aria-label="Principal">
          <a href={LINKS.hub} className="rounded-md px-3 py-1.5 text-[#c9d3e0] hover:bg-white/5 hover:text-white">
            Todas las herramientas
          </a>
          <a href={LINKS.marca} className="ml-1 rounded-lg bg-teal px-3 py-1.5 text-xs font-semibold text-navy-950 hover:bg-teal/90">
            Contacto
          </a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)]">
      <div className="muted mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs sm:px-6">
        <p>
          © 2026 <a className="font-semibold hover:underline" href={LINKS.marca}>Total Security SH</a> · Herramienta gratuita y de código abierto
        </p>
        <p className="flex gap-4">
          <a className="hover:underline" href={LINKS.portafolio}>Hecho por Carlos Santiago</a>
          <a className="hover:underline" href={LINKS.github}>Código en GitHub</a>
        </p>
      </div>
    </footer>
  );
}
