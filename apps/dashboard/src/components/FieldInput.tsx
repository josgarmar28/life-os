import type { Column, Field, FieldType, Option } from '@shared/model.ts';
import type { Cell, Row } from '../values';
import { emptyRow } from '../values';

interface ScalarProps {
  id: string;
  type: FieldType;
  label: string;
  unit?: string;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  options?: Option[];
  value: Cell;
  onChange: (v: Cell) => void;
  compact?: boolean;
}

function Chips({ options, value, multi, label, onChange }: { options: Option[]; value: Cell; multi?: boolean; label: string; onChange: (v: Cell) => void }) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  return (
    <div className="chips" role={multi ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button key={o.value} type="button" className={on ? 'chip on' : 'chip'}
            {...(multi ? { 'aria-pressed': on } : { role: 'radio', 'aria-checked': on })}
            onClick={() => {
              if (multi) onChange(on ? selected.filter((x) => x !== o.value) : [...selected, o.value]);
              else onChange(on ? '' : o.value);
            }}>
            {o.label ?? o.value}
          </button>
        );
      })}
    </div>
  );
}

export function ScalarInput(p: ScalarProps) {
  const v = typeof p.value === 'string' ? p.value : '';
  switch (p.type) {
    case 'scale': {
      const lo = p.min ?? 1;
      const hi = p.max ?? 5;
      const opts = Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => ({ value: String(lo + i) }));
      return opts.length <= 11 ? <Chips options={opts} value={v} label={p.label} onChange={p.onChange} />
        : <input id={p.id} type="number" inputMode="numeric" min={lo} max={hi} value={v} onChange={(e) => p.onChange(e.target.value)} />;
    }
    case 'boolean':
      return <Chips options={[{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }]} value={v} label={p.label} onChange={p.onChange} />;
    case 'choice':
      return (p.options?.length ?? 0) <= 8 ? <Chips options={p.options ?? []} value={v} label={p.label} onChange={p.onChange} />
        : (
          <select id={p.id} value={v} onChange={(e) => p.onChange(e.target.value)}>
            <option value="">—</option>
            {(p.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label ?? o.value}</option>)}
          </select>
        );
    case 'multi':
      return <Chips options={p.options ?? []} value={p.value} multi label={p.label} onChange={p.onChange} />;
    case 'date':
      return <input id={p.id} type="date" value={v} onChange={(e) => p.onChange(e.target.value)} />;
    case 'time':
      return <input id={p.id} type="time" value={v} onChange={(e) => p.onChange(e.target.value)} />;
    case 'text':
      return p.compact
        ? <input id={p.id} type="text" value={v} onChange={(e) => p.onChange(e.target.value)} />
        : <textarea id={p.id} rows={2} value={v} onChange={(e) => p.onChange(e.target.value)} />;
    case 'duration':
      return (
        <div className="with-unit">
          <input id={p.id} type="text" inputMode="text" placeholder="7h40 o 460" value={v} onChange={(e) => p.onChange(e.target.value)} />
          <span className="unit">min</span>
        </div>
      );
    default:
      return (
        <div className="with-unit">
          <input id={p.id} type="text" inputMode={p.type === 'integer' ? 'numeric' : 'decimal'} value={v}
            placeholder={p.min != null || p.max != null ? `${p.min ?? ''}–${p.max ?? ''}` : ''}
            onChange={(e) => p.onChange(e.target.value)} />
          {p.unit ? <span className="unit">{p.unit}</span> : null}
        </div>
      );
  }
}

export function TableInput({ field, rows, onChange }: { field: Field; rows: Row[]; onChange: (rows: Row[]) => void }) {
  const set = (i: number, key: string, v: Cell) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  return (
    <div className="table-input">
      {rows.map((row, i) => (
        <div className="trow" key={i}>
          <div className="trow-head">
            <strong>{i + 1}</strong>
            <button type="button" className="link danger" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Quitar</button>
          </div>
          <div className="tcells">
            {field.columns.map((c: Column) => (
              <label key={c.key} className={c.type === 'text' ? 'tcell wide' : 'tcell'}>
                <span>{c.label}{c.unit ? ` (${c.unit})` : ''}{c.required ? ' *' : ''}</span>
                <ScalarInput id={`${field.key}-${i}-${c.key}`} type={c.type} label={c.label} unit={c.unit} min={c.min} max={c.max}
                  options={c.options} value={row[c.key] ?? ''} onChange={(v) => set(i, c.key, v)} compact />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="row gap">
        <button type="button" className="btn small" onClick={() => onChange([...rows, emptyRow(field.columns)])}>Añadir fila</button>
        {rows.length ? (
          <button type="button" className="btn small ghost" onClick={() => onChange([...rows, { ...rows[rows.length - 1] }])}>Duplicar la última</button>
        ) : null}
      </div>
    </div>
  );
}
