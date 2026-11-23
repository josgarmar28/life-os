// Huecos grises con la forma de lo que va a cargar, en lugar de "Cargando…".
export function Skeleton({ rows = 3, tiles = 0, title = true }: { rows?: number; tiles?: number; title?: boolean }) {
  return (
    <div className="skel-card" role="status" aria-label="Cargando">
      {title ? <div className="skel skel-title" /> : null}
      {tiles ? <div className="skel-tiles">{Array.from({ length: tiles }, (_, i) => <div key={i} className="skel skel-tile" />)}</div> : null}
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skel skel-row" style={{ width: `${92 - (i % 3) * 14}%` }} />)}
    </div>
  );
}

/** Pantalla entera mientras llega la estructura la primera vez. */
export function PageSkeleton() {
  return (
    <main aria-busy="true">
      <div className="skel skel-h1" />
      <Skeleton rows={2} />
      <Skeleton rows={4} />
      <Skeleton rows={0} tiles={4} />
    </main>
  );
}
