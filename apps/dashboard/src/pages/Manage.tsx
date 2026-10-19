// Gestión de la estructura: crear, modificar, archivar y borrar áreas, cuestionarios y campos.
import { useState } from 'react';
import type { Area, Cadence, Column, Field, FieldType, Form } from '@shared/model.ts';
import { CADENCES, CADENCE_LABEL, FIELD_TYPES, TYPE_LABEL } from '@shared/model.ts';
import { useStructure } from '../data';
import { Link, navigate } from '../router';
import { explainError, rpc } from '../supabase';
import { optionsToText, parseOptions, slugify } from '../values';

function useAction() {
  const s = useStructure();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await s.reload();
      after?.();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

export function ManageList() {
  const s = useStructure();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const act = useAction();
  const active = s.areas.filter((a) => a.status === 'active');
  const archived = s.areas.filter((a) => a.status === 'archived');
  return (
    <main>
      <header className="page-head"><h1>Áreas</h1></header>
      <section className="card">
        <h2>Nueva área</h2>
        <form className="inline-form" onSubmit={(e) => {
          e.preventDefault();
          const slug = slugify(name);
          void act.run(() => rpc('save_area', { p_id: null, p_slug: slug, p_name: name, p_description: '', p_icon: icon, p_sort_order: (s.areas.length + 1) * 10 }),
            () => navigate(`/gestion/${slug}`));
        }}>
          <input className="icon-input" aria-label="Icono" placeholder="🙂" value={icon} maxLength={8} onChange={(e) => setIcon(e.target.value)} />
          <input aria-label="Nombre" placeholder="Nombre del área" value={name} onChange={(e) => setName(e.target.value)} required />
          <button className="btn primary" disabled={act.busy || !slugify(name)}>Crear</button>
        </form>
        {act.error ? <p className="error">{act.error}</p> : null}
      </section>
      <section className="card">
        <h2>Activas</h2>
        <ul className="list">{active.map((a) => <li key={a.id}><Link to={`/gestion/${a.slug}`}>{a.icon} {a.name}</Link></li>)}</ul>
      </section>
      {archived.length ? (
        <section className="card">
          <h2>Archivadas</h2>
          <ul className="list">{archived.map((a) => <li key={a.id}><Link to={`/gestion/${a.slug}`}>{a.icon} {a.name}</Link></li>)}</ul>
        </section>
      ) : null}
    </main>
  );
}

export function ManageArea({ slug }: { slug: string }) {
  const s = useStructure();
  const area = s.areas.find((a) => a.slug === slug);
  if (!area) return <main><p>No existe esa área.</p><Link to="/gestion">Volver</Link></main>;
  const forms = s.forms.filter((f) => f.area_id === area.id);
  return (
    <main>
      <header className="page-head">
        <Link to="/gestion" className="link">← Áreas</Link>
        <h1>{area.icon} {area.name}</h1>
      </header>
      <AreaEditor area={area} />
      {forms.map((f) => <FormEditor key={f.id} area={area} form={f} />)}
      <NewForm area={area} />
      <DangerZone area={area} />
    </main>
  );
}

function AreaEditor({ area }: { area: Area }) {
  const [v, setV] = useState({ name: area.name, icon: area.icon, description: area.description, slug: area.slug, sort: String(area.sort_order) });
  const act = useAction();
  return (
    <section className="card">
      <h2>Datos del área</h2>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        void act.run(() => rpc('save_area', { p_id: area.id, p_slug: v.slug, p_name: v.name, p_description: v.description, p_icon: v.icon, p_sort_order: Number(v.sort) || 100 }),
          () => { if (v.slug !== area.slug) navigate(`/gestion/${v.slug}`, true); });
      }}>
        <div className="row gap">
          <label className="narrow">Icono<input className="icon-input" value={v.icon} maxLength={8} onChange={(e) => setV({ ...v, icon: e.target.value })} /></label>
          <label className="grow">Nombre<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></label>
        </div>
        <label>Descripción<textarea rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></label>
        <div className="row gap">
          <label className="grow">Identificador<input value={v.slug} onChange={(e) => setV({ ...v, slug: slugify(e.target.value) })} /></label>
          <label className="narrow">Orden<input inputMode="numeric" value={v.sort} onChange={(e) => setV({ ...v, sort: e.target.value })} /></label>
        </div>
        <p className="muted small">El identificador es el que usa Claude ("{area.slug}"). Si lo cambias, avísale.</p>
        <button className="btn" disabled={act.busy}>Guardar</button>
        {act.error ? <p className="error">{act.error}</p> : null}
      </form>
    </section>
  );
}

function NewForm({ area }: { area: Area }) {
  const s = useStructure();
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<Cadence>('daily');
  const act = useAction();
  return (
    <section className="card">
      <h2>Nuevo cuestionario</h2>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        void act.run(() => rpc('save_form', { p_id: null, p_area_id: area.id, p_slug: slugify(name), p_name: name, p_description: '', p_cadence: cadence,
          p_sort_order: (s.forms.filter((f) => f.area_id === area.id).length + 1) * 10 }), () => setName(''));
      }}>
        <label>Nombre<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Frecuencia
          <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
            {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
          </select>
        </label>
        <button className="btn" disabled={act.busy || !slugify(name)}>Añadir cuestionario</button>
        {act.error ? <p className="error">{act.error}</p> : null}
      </form>
    </section>
  );
}

function FormEditor({ area, form }: { area: Area; form: Form }) {
  const s = useStructure();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: form.name, description: form.description, cadence: form.cadence, slug: form.slug, sort: String(form.sort_order) });
  const act = useAction();
  const fields = s.fields.filter((f) => f.form_id === form.id);
  const archived = form.status === 'archived';
  return (
    <section className={archived ? 'card archived' : 'card'}>
      <div className="card-head">
        <h2>{form.name}{archived ? ' (archivado)' : ''}</h2>
        <button className="link" onClick={() => setOpen(!open)}>{open ? 'Cerrar' : 'Editar'}</button>
      </div>
      <p className="muted small">{CADENCE_LABEL[form.cadence]} · {fields.filter((f) => f.status === 'active').length} campos</p>
      {open ? (
        <>
          <form className="stack" onSubmit={(e) => {
            e.preventDefault();
            void act.run(() => rpc('save_form', { p_id: form.id, p_area_id: area.id, p_slug: v.slug, p_name: v.name, p_description: v.description, p_cadence: v.cadence, p_sort_order: Number(v.sort) || 100 }));
          }}>
            <label>Nombre<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></label>
            <label>Descripción<textarea rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></label>
            <div className="row gap">
              <label className="grow">Frecuencia
                <select value={v.cadence} onChange={(e) => setV({ ...v, cadence: e.target.value as Cadence })}>
                  {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
                </select>
              </label>
              <label className="narrow">Orden<input inputMode="numeric" value={v.sort} onChange={(e) => setV({ ...v, sort: e.target.value })} /></label>
            </div>
            <label>Identificador<input value={v.slug} onChange={(e) => setV({ ...v, slug: slugify(e.target.value) })} /></label>
            <div className="row gap">
              <button className="btn" disabled={act.busy}>Guardar</button>
              <button type="button" className="btn ghost" disabled={act.busy}
                onClick={() => void act.run(() => rpc('set_form_status', { p_id: form.id, p_status: archived ? 'active' : 'archived' }))}>
                {archived ? 'Recuperar' : 'Archivar'}
              </button>
            </div>
            {act.error ? <p className="error">{act.error}</p> : null}
          </form>
          <h3>Campos</h3>
          {fields.map((f) => <FieldEditor key={f.id} formId={form.id} field={f} />)}
          <FieldEditor formId={form.id} sortHint={(fields.length + 1) * 10} />
        </>
      ) : null}
    </section>
  );
}

const COLUMNS_EXAMPLE = '[\n  {"key": "ejercicio", "label": "Ejercicio", "type": "text", "required": true},\n  {"key": "reps", "label": "Reps", "type": "integer", "min": 0, "max": 100}\n]';

function FieldEditor({ formId, field, sortHint }: { formId: string; field?: Field; sortHint?: number }) {
  const isNew = !field;
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(() => ({
    label: field?.label ?? '',
    key: field?.key ?? '',
    type: (field?.type ?? 'number') as FieldType,
    help: field?.help ?? '',
    unit: field?.unit ?? '',
    min: field?.min?.toString() ?? '',
    max: field?.max?.toString() ?? '',
    step: field?.step?.toString() ?? '',
    options: optionsToText(field?.options ?? []),
    columns: field?.columns.length ? JSON.stringify(field.columns, null, 2) : '',
    required: field?.required ?? false,
    overview: field?.on_overview ?? false,
    sort: String(field?.sort_order ?? sortHint ?? 100),
  }));
  const act = useAction();
  const num = (x: string) => (x.trim() === '' ? null : Number(x.replace(',', '.')));

  function save() {
    let columns: Column[] = [];
    if (v.type === 'table') {
      try {
        columns = JSON.parse(v.columns || '[]');
      } catch {
        return act.run(async () => { throw new Error('Las columnas no son JSON válido'); });
      }
    }
    const key = v.key || slugify(v.label, '_');
    return act.run(() => rpc('save_field', {
      p_id: field?.id ?? null, p_form_id: formId, p_key: key, p_label: v.label, p_type: v.type,
      p_help: v.help, p_unit: v.unit, p_min: num(v.min), p_max: num(v.max), p_step: num(v.step),
      p_options: v.type === 'choice' || v.type === 'multi' ? parseOptions(v.options) : [],
      p_columns: columns, p_required: v.required, p_on_overview: v.overview, p_sort_order: Number(v.sort) || 100,
    }), () => { if (isNew) setOpen(false); });
  }

  if (!open) {
    return isNew
      ? <button className="btn small" onClick={() => setOpen(true)}>Añadir campo</button>
      : (
        <div className={field!.status === 'archived' ? 'field-row archived' : 'field-row'}>
          <span className="grow">{field!.label} <span className="muted small">· {TYPE_LABEL[field!.type]}{field!.required ? ' · obligatorio' : ''}{field!.on_overview ? ' · en la vista general' : ''}{field!.status === 'archived' ? ' · archivado' : ''}</span></span>
          <button className="link" onClick={() => setOpen(true)}>Editar</button>
        </div>
      );
  }
  return (
    <form className="stack field-editor" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>Pregunta o nombre<input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} required /></label>
      <div className="row gap">
        <label className="grow">Tipo
          <select value={v.type} disabled={!isNew} onChange={(e) => setV({ ...v, type: e.target.value as FieldType })}>
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="grow">Clave<input value={v.key} placeholder={slugify(v.label, '_')} disabled={!isNew} onChange={(e) => setV({ ...v, key: slugify(e.target.value, '_') })} /></label>
      </div>
      {!isNew ? <p className="muted small">La clave y el tipo no cambian (los datos antiguos dependen de ellos). Para cambiarlos, archiva este campo y crea otro.</p> : null}
      <label>Ayuda<input value={v.help} onChange={(e) => setV({ ...v, help: e.target.value })} /></label>
      {['number', 'integer', 'scale', 'duration', 'text'].includes(v.type) ? (
        <div className="row gap">
          {v.type !== 'text' ? <label className="grow">Unidad<input value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} /></label> : null}
          {v.type !== 'text' ? <label className="narrow">Mín.<input inputMode="decimal" value={v.min} onChange={(e) => setV({ ...v, min: e.target.value })} /></label> : null}
          <label className="narrow">{v.type === 'text' ? 'Máx. letras' : 'Máx.'}<input inputMode="decimal" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} /></label>
        </div>
      ) : null}
      {v.type === 'choice' || v.type === 'multi' ? (
        <label>Opciones (una por línea; "valor = Etiqueta" opcional)
          <textarea rows={4} value={v.options} onChange={(e) => setV({ ...v, options: e.target.value })} />
        </label>
      ) : null}
      {v.type === 'table' ? (
        <label>Columnas (JSON)
          <textarea rows={6} className="mono" placeholder={COLUMNS_EXAMPLE} value={v.columns} onChange={(e) => setV({ ...v, columns: e.target.value })} />
        </label>
      ) : null}
      <label className="check"><input type="checkbox" checked={v.required} onChange={(e) => setV({ ...v, required: e.target.checked })} /> Obligatorio</label>
      <label className="check"><input type="checkbox" checked={v.overview} onChange={(e) => setV({ ...v, overview: e.target.checked })} /> Mostrar en la vista general</label>
      <label className="narrow">Orden<input inputMode="numeric" value={v.sort} onChange={(e) => setV({ ...v, sort: e.target.value })} /></label>
      <div className="row gap">
        <button className="btn primary" disabled={act.busy}>Guardar campo</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
        {!isNew ? (
          <button type="button" className="btn ghost" disabled={act.busy}
            onClick={() => void act.run(() => rpc('set_field_status', { p_id: field!.id, p_status: field!.status === 'archived' ? 'active' : 'archived' }))}>
            {field!.status === 'archived' ? 'Recuperar' : 'Archivar'}
          </button>
        ) : null}
      </div>
      {act.error ? <p className="error">{act.error}</p> : null}
    </form>
  );
}

function DangerZone({ area }: { area: Area }) {
  const [confirmName, setConfirmName] = useState('');
  const act = useAction();
  const archived = area.status === 'archived';
  return (
    <section className="card danger-zone">
      <h2>{archived ? 'Área archivada' : 'Archivar'}</h2>
      {!archived ? (
        <>
          <p className="muted small">Archivar la oculta y no admite registros nuevos. Los datos se conservan y puedes recuperarla.</p>
          <button className="btn ghost" disabled={act.busy} onClick={() => void act.run(() => rpc('set_area_status', { p_id: area.id, p_status: 'archived' }))}>Archivar área</button>
        </>
      ) : (
        <>
          <button className="btn" disabled={act.busy} onClick={() => void act.run(() => rpc('set_area_status', { p_id: area.id, p_status: 'active' }))}>Recuperar área</button>
          <h3>Borrar definitivamente</h3>
          <p className="muted small">Borra el área, sus cuestionarios y TODOS sus registros. No se puede deshacer (salvo desde una copia de seguridad). Escribe <strong>{area.name}</strong> para confirmar.</p>
          <form className="inline-form" onSubmit={(e) => {
            e.preventDefault();
            void act.run(() => rpc('purge_area', { p_id: area.id, p_confirm_name: confirmName }), () => navigate('/gestion', true));
          }}>
            <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Nombre del área" />
            <button className="btn danger" disabled={act.busy || confirmName !== area.name}>Borrar para siempre</button>
          </form>
        </>
      )}
      {act.error ? <p className="error">{act.error}</p> : null}
    </section>
  );
}
