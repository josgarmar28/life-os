// Piezas pequeñas del armario: selector de opciones, punto de color, miniatura y cabecera con pestañas.
import type { ReactNode } from 'react';
import { colorHex, colorLabel, type Garment, type GarmentPhoto } from '@shared/wardrobe.ts';
import { Link } from '../router';

export function Pick<T extends string | number>({ options, value, onChange, multi, label, max }: {
  options: { key: T; label: string; swatch?: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  multi?: boolean;
  label: string;
  max?: number;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.key);
        return (
          <button key={String(o.key)} type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on}
            onClick={() => {
              if (!multi) onChange(on ? [] : [o.key]);
              else if (on) onChange(value.filter((x) => x !== o.key));
              else if (!max || value.length < max) onChange([...value, o.key]);
            }}>
            {o.swatch ? <span className="swatch" style={{ background: o.swatch }} aria-hidden="true" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ColorDots({ colors }: { colors: string[] }) {
  return (
    <span className="color-dots" aria-label={colors.map((c) => colorLabel(c)).join(', ')}>
      {colors.map((c) => <span key={c} className="swatch" style={{ background: colorHex(c) }} title={colorLabel(c)} />)}
    </span>
  );
}

/** Foto de la prenda (miniatura o principal) o un hueco con su inicial si aún no tiene. */
export function Thumb({ g, photo, urls, full }: { g: Pick<Garment, 'name' | 'colors'>; photo?: GarmentPhoto; urls: Record<string, string>; full?: boolean }) {
  const src = photo ? urls[full ? photo.path : photo.thumb_path] : undefined;
  return (
    <div className={full ? 'thumb full' : 'thumb'}>
      {src ? <img src={src} alt={g.name} loading="lazy" decoding="async" />
        : <span className="thumb-empty" aria-hidden="true" style={g.colors[0] ? { background: colorHex(g.colors[0]) } : undefined}>{photo ? '…' : g.name.slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}

export function WardrobeHead({ title, sub, children, back }: { title: string; sub?: ReactNode; children?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="page-head">
      {back ? <Link to={back.to} className="muted small">← {back.label}</Link> : null}
      <h1>{title}</h1>
      {sub ? <p className="muted small">{sub}</p> : null}
      {children}
    </header>
  );
}

export function money(n: number | null, currency: string): string {
  if (n === null) return '—';
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
}

export function uuid(): string {
  return crypto.randomUUID();
}
