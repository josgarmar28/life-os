// Conector MCP de LIFE OS: lógica del protocolo y de las herramientas, sin dependencias de Deno
// (se prueba con vitest desde apps/dashboard). La autenticación y el acceso a Supabase viven en index.ts.
//
// Transporte: "Streamable HTTP" sin estado, respondiendo JSON (sin SSE). Cada petición es
// independiente, lo que encaja con Edge Functions.
import type { Area, Entry, Field, Form, Proposal } from '../_shared/model.ts';
import { byOrder } from '../_shared/model.ts';
import { addDays, formatValue, localDate, summarizeForm } from '../_shared/stats.ts';
import { summarizeWeek, weekRange } from '../_shared/week.ts';

export const SERVER_INFO = { name: 'lifeos', title: 'LIFE OS', version: '0.2.0' };
export const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export const INSTRUCTIONS = [
  'LIFE OS es el sistema personal de martagon. Los datos son personales y de salud: úsalos solo para lo que él pide.',
  'Antes de registrar, llama a lifeos_structure para conocer áreas, formularios, claves, tipos y rangos.',
  'Registra solo lo que él te diga o lo que derive de forma explícita de lo que te diga; nunca inventes valores.',
  "Calidad: 'manual' si él lo dice, 'estimated' si es una estimación (p. ej. kcal). Nunca 'measured'.",
  'Cambiar la estructura (áreas, formularios, campos) se hace con lifeos_propose_change; él lo aprueba en el dashboard.',
  'Para revisiones (semana, tendencias, cómo se influyen sueño, entreno, nutrición, estrés y agenda) usa lifeos_week y lifeos_overview antes de opinar, y separa lo que dicen los datos de lo que infieres.',
  'Él registra en el dashboard; tú registras solo cuando te lo pide expresamente en el chat.',
  'Las fotos corporales y de pelo no existen aquí y no deben subirse a ningún sitio.',
].join(' ');

/** Acceso a datos que index.ts implementa con supabase-js (como el usuario, con RLS). */
export interface Api {
  areas(): Promise<Area[]>;
  forms(): Promise<Form[]>;
  fields(): Promise<Field[]>;
  entries(q: { ids?: string[]; formIds?: string[]; from?: string; to?: string; limit: number }): Promise<Entry[]>;
  proposals(q: { status?: string; limit: number }): Promise<Proposal[]>;
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  timezone(): Promise<string>;
}

export interface Ctx {
  api: Api;
  now: Date;
  newId: () => string;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class ToolError extends Error {}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean | string>;
  run: (args: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;
}

const str = (v: unknown, name: string, required = false): string | undefined => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ToolError(`Falta "${name}".`);
    return undefined;
  }
  if (typeof v !== 'string') throw new ToolError(`"${name}" debe ser texto.`);
  return v;
};
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function loadStructure(api: Api) {
  const [areas, forms, fields] = await Promise.all([api.areas(), api.forms(), api.fields()]);
  return { areas, forms, fields };
}

async function resolveForm(api: Api, areaSlug: string, formSlug: string) {
  const { areas, forms, fields } = await loadStructure(api);
  const area = areas.find((a) => a.slug === areaSlug);
  if (!area) throw new ToolError(`No existe el área "${areaSlug}". Usa lifeos_structure.`);
  const form = forms.find((f) => f.area_id === area.id && f.slug === formSlug);
  if (!form) throw new ToolError(`No existe el formulario "${formSlug}" en "${areaSlug}". Usa lifeos_structure.`);
  return { area, form, fields: fields.filter((f) => f.form_id === form.id) };
}

function describeField(f: Field) {
  const out: Record<string, unknown> = { key: f.key, label: f.label, type: f.type };
  if (f.unit) out.unit = f.unit;
  if (f.min !== null) out.min = f.min;
  if (f.max !== null) out.max = f.max;
  if (f.required) out.required = true;
  if (f.help) out.help = f.help;
  if (f.options.length) out.options = f.options.map((o) => o.value);
  if (f.columns.length) out.columns = f.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, ...(c.required ? { required: true } : {}) }));
  return out;
}

function readableEntry(e: Entry, fields: Field[]) {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.data)) {
    const f = fields.find((x) => x.form_id === e.form_id && x.key === k);
    values[k] = f ? formatValue(f, v) : JSON.stringify(v);
  }
  return values;
}

export const TOOLS: Tool[] = [
  {
    name: 'lifeos_structure',
    title: 'Estructura de LIFE OS',
    description: 'Lista áreas, formularios (cuestionarios) y campos con su clave, tipo, unidad, rango y opciones. Úsalo antes de registrar o proponer cambios.',
    inputSchema: {
      type: 'object',
      properties: { include_archived: { type: 'boolean', description: 'Incluir lo archivado (por defecto no).' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args, { api }) {
      const all = args.include_archived === true;
      const { areas, forms, fields } = await loadStructure(api);
      return areas
        .filter((a) => all || a.status === 'active')
        .sort(byOrder)
        .map((a) => ({
          area: a.slug,
          name: a.name,
          status: a.status,
          description: a.description || undefined,
          forms: forms
            .filter((f) => f.area_id === a.id && (all || f.status === 'active'))
            .sort(byOrder)
            .map((f) => ({
              form: f.slug,
              name: f.name,
              cadence: f.cadence,
              status: f.status,
              form_id: f.id,
              fields: fields
                .filter((x) => x.form_id === f.id && (all || x.status === 'active'))
                .sort(byOrder)
                .map((x) => ({ ...describeField(x), field_id: x.id, ...(x.status !== 'active' ? { status: x.status } : {}) })),
            })),
        }));
    },
  },
  {
    name: 'lifeos_overview',
    title: 'Vista general',
    description: 'Resumen de hoy: qué cuestionarios faltan según su cadencia y los indicadores principales (último valor, media de 7 días y cambio frente a la semana anterior).',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Fecha YYYY-MM-DD (por defecto hoy en su zona horaria).' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args, { api, now }) {
      const tz = await api.timezone();
      const today = str(args.date, 'date') ?? localDate(now, tz);
      if (!isDate(today)) throw new ToolError('"date" debe ser YYYY-MM-DD.');
      const { areas, forms, fields } = await loadStructure(api);
      const activeForms = forms.filter((f) => f.status === 'active' && areas.some((a) => a.id === f.area_id && a.status === 'active'));
      const entries = await api.entries({ formIds: activeForms.map((f) => f.id), from: addDays(today, -59), to: today, limit: 5000 });
      return {
        date: today,
        timezone: tz,
        areas: areas
          .filter((a) => a.status === 'active')
          .sort(byOrder)
          .map((a) => ({
            area: a.slug,
            name: a.name,
            forms: activeForms
              .filter((f) => f.area_id === a.id)
              .sort(byOrder)
              .map((f) => {
                const s = summarizeForm(f, fields, entries, today);
                return {
                  form: f.slug,
                  name: f.name,
                  cadence: f.cadence,
                  done: s.status.done,
                  period: s.status.label || undefined,
                  last_entry: s.status.last,
                  entries_30d: s.count30,
                  indicators: s.fields.map((x) => ({
                    key: x.field.key,
                    label: x.field.label,
                    unit: x.field.unit || undefined,
                    last: x.last,
                    avg7: x.avg7 === null ? null : Math.round(x.avg7 * 100) / 100,
                    days_with_data_7d: x.n7,
                    change_vs_prev_week: x.delta7 === null ? null : Math.round(x.delta7 * 100) / 100,
                  })),
                };
              }),
          })),
      };
    },
  },
  {
    name: 'lifeos_week',
    title: 'Semana entre áreas',
    description: 'Semana de lunes a domingo con TODAS las áreas: cumplimiento de cada cuestionario según su cadencia y los indicadores numéricos día a día (sueño, energía, estrés, peso, duración del entreno…), con su media y el cambio frente a la semana anterior. Úsalo para la revisión semanal y para buscar relaciones entre áreas (p. ej. noches malas y rendimiento). Para el detalle de un registro, usa lifeos_entries.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Cualquier día de la semana, YYYY-MM-DD (por defecto, la semana actual en su zona horaria).' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args, { api, now }) {
      const tz = await api.timezone();
      const today = localDate(now, tz);
      const date = str(args.date, 'date') ?? today;
      if (!isDate(date)) throw new ToolError('"date" debe ser YYYY-MM-DD.');
      const { areas, forms, fields } = await loadStructure(api);
      const { fetchFrom, end } = weekRange(date);
      const active = forms.filter((f) => f.status === 'active');
      const entries = await api.entries({ formIds: active.map((f) => f.id), from: fetchFrom, to: end, limit: 5000 });
      const w = summarizeWeek(areas, forms, fields, entries, date, today);
      const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
      return {
        week: { start: w.start, end: w.end, days: w.dates, days_elapsed: w.elapsed },
        timezone: tz,
        compliance: w.forms.map((f) => ({
          area: f.area.slug, form: f.form.slug, name: f.form.name, cadence: f.form.cadence,
          entries: f.count, days_with_entries: f.days, expected_so_far: f.expected,
        })),
        indicators: w.indicators.map((i) => ({
          area: i.area.slug, form: i.form.slug, key: i.field.key, label: i.field.label, unit: i.field.unit || undefined,
          type: i.field.type, by_day: i.days, avg: r2(i.avg), prev_week_avg: r2(i.prevAvg), change: r2(i.delta), days_with_data: i.n,
        })),
      };
    },
  },
  {
    name: 'lifeos_entries',
    title: 'Leer registros',
    description: 'Devuelve los registros vigentes (sin versiones corregidas ni borradas) de un área o formulario y un rango de fechas, con valores en bruto y legibles.',
    inputSchema: {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'Slug del área (p. ej. "sueno"). Opcional.' },
        form: { type: 'string', description: 'Slug del formulario dentro del área. Requiere "area".' },
        from: { type: 'string', description: 'Desde YYYY-MM-DD (por defecto, hace 14 días).' },
        to: { type: 'string', description: 'Hasta YYYY-MM-DD (por defecto, hoy).' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Máximo de registros (por defecto 100).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args, { api, now }) {
      const tz = await api.timezone();
      const to = str(args.to, 'to') ?? localDate(now, tz);
      const from = str(args.from, 'from') ?? addDays(to, -13);
      if (!isDate(from) || !isDate(to)) throw new ToolError('"from" y "to" deben ser YYYY-MM-DD.');
      const limit = Math.min(Math.max(Number(args.limit ?? 100) || 100, 1), 500);
      const { areas, forms, fields } = await loadStructure(api);
      let formIds: string[] | undefined;
      const areaSlug = str(args.area, 'area');
      const formSlug = str(args.form, 'form');
      if (formSlug && !areaSlug) throw new ToolError('"form" requiere "area".');
      if (areaSlug) {
        const area = areas.find((a) => a.slug === areaSlug);
        if (!area) throw new ToolError(`No existe el área "${areaSlug}".`);
        formIds = forms.filter((f) => f.area_id === area.id && (!formSlug || f.slug === formSlug)).map((f) => f.id);
        if (formSlug && !formIds.length) throw new ToolError(`No existe el formulario "${formSlug}" en "${areaSlug}".`);
      }
      const entries = await api.entries({ formIds, from, to, limit });
      return {
        from,
        to,
        count: entries.length,
        truncated: entries.length >= limit,
        entries: entries.map((e) => {
          const form = forms.find((f) => f.id === e.form_id);
          const area = areas.find((a) => a.id === form?.area_id);
          return {
            entry_id: e.id,
            area: area?.slug,
            form: form?.slug,
            local_date: e.local_date,
            occurred_at: e.occurred_at,
            data: e.data,
            readable: readableEntry(e, fields),
            note: e.note || undefined,
            source: e.source,
            quality: e.quality,
          };
        }),
      };
    },
  },
  {
    name: 'lifeos_add_entry',
    title: 'Registrar datos',
    description: 'Guarda un registro nuevo en un formulario. La base de datos valida tipos, rangos y obligatorios y rechaza claves desconocidas. Usa las claves de lifeos_structure.',
    inputSchema: {
      type: 'object',
      properties: {
        area: { type: 'string' },
        form: { type: 'string' },
        data: { type: 'object', description: 'Valores por clave de campo. Tablas: lista de objetos por columna.' },
        local_date: { type: 'string', description: 'Día al que pertenece (YYYY-MM-DD). Por defecto, hoy.' },
        occurred_at: { type: 'string', description: 'Momento ISO 8601. Por defecto, ahora.' },
        note: { type: 'string' },
        quality: { type: 'string', enum: ['manual', 'estimated'], description: 'manual (lo dijo él) o estimated (estimación).' },
        request_id: { type: 'string', description: 'UUID para reintentos seguros: el mismo request_id nunca duplica.' },
      },
      required: ['area', 'form', 'data'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, { api, newId }) {
      const { form } = await resolveForm(api, str(args.area, 'area', true)!, str(args.form, 'form', true)!);
      if (!args.data || typeof args.data !== 'object' || Array.isArray(args.data)) throw new ToolError('"data" debe ser un objeto.');
      const requestId = str(args.request_id, 'request_id') ?? newId();
      if (!isUuid(requestId)) throw new ToolError('"request_id" debe ser un UUID.');
      const localDateArg = str(args.local_date, 'local_date');
      if (localDateArg && !isDate(localDateArg)) throw new ToolError('"local_date" debe ser YYYY-MM-DD.');
      const id = await api.rpc<string>('add_entry', {
        p_form_id: form.id,
        p_values: args.data,
        p_request_id: requestId,
        p_occurred_at: str(args.occurred_at, 'occurred_at') ?? null,
        p_local_date: localDateArg ?? null,
        p_note: str(args.note, 'note') ?? '',
        p_quality: str(args.quality, 'quality') ?? 'manual',
        p_supersedes_id: null,
      });
      return { saved: true, entry_id: id, request_id: requestId };
    },
  },
  {
    name: 'lifeos_correct_entry',
    title: 'Corregir un registro',
    description: 'Sustituye un registro por una versión nueva con todos sus valores (los que no envíes desaparecen de la versión vigente). La versión anterior queda en el historial.',
    inputSchema: {
      type: 'object',
      properties: {
        entry_id: { type: 'string' },
        data: { type: 'object', description: 'Valores completos de la nueva versión.' },
        note: { type: 'string' },
        quality: { type: 'string', enum: ['manual', 'estimated'] },
        request_id: { type: 'string' },
      },
      required: ['entry_id', 'data'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, { api, newId }) {
      const entryId = str(args.entry_id, 'entry_id', true)!;
      if (!isUuid(entryId)) throw new ToolError('"entry_id" debe ser un UUID.');
      const [prev] = await api.entries({ ids: [entryId], limit: 1 });
      if (!prev) throw new ToolError('Ese registro no existe o ya no es la versión vigente.');
      const requestId = str(args.request_id, 'request_id') ?? newId();
      const id = await api.rpc<string>('add_entry', {
        p_form_id: prev.form_id,
        p_values: args.data,
        p_request_id: requestId,
        p_occurred_at: prev.occurred_at,
        p_local_date: prev.local_date,
        p_note: str(args.note, 'note') ?? prev.note,
        p_quality: str(args.quality, 'quality') ?? (prev.quality === 'measured' ? 'manual' : prev.quality),
        p_supersedes_id: entryId,
      });
      return { saved: true, entry_id: id, replaces: entryId };
    },
  },
  {
    name: 'lifeos_delete_entry',
    title: 'Borrar un registro',
    description: 'Anula un registro (deja de contar; queda en el historial). Solo si él lo pide.',
    inputSchema: {
      type: 'object',
      properties: { entry_id: { type: 'string' }, note: { type: 'string' }, request_id: { type: 'string' } },
      required: ['entry_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async run(args, { api, newId }) {
      const entryId = str(args.entry_id, 'entry_id', true)!;
      if (!isUuid(entryId)) throw new ToolError('"entry_id" debe ser un UUID.');
      await api.rpc('void_entry', { p_entry_id: entryId, p_request_id: str(args.request_id, 'request_id') ?? newId(), p_note: str(args.note, 'note') ?? '' });
      return { deleted: true, entry_id: entryId };
    },
  },
  {
    name: 'lifeos_propose_change',
    title: 'Proponer un cambio de estructura',
    description:
      'Crea una propuesta que él aprueba o rechaza en el dashboard; nada cambia hasta entonces. Usa los identificadores de lifeos_structure (slugs y claves); si lo indicado ya existe, la propuesta lo modifica. '
      + 'kind y payload: '
      + 'area.save {slug, name, description?, icon?, sort_order?}; '
      + 'form.save {area, slug, name, description?, cadence (daily|weekly|biweekly|monthly|per_session|free), sort_order?, fields?: [campo…]} crea o modifica el cuestionario y sus campos de una vez; '
      + 'field.save {area, form, key, label, type, help?, unit?, min?, max?, step?, options? [{value,label}], columns? [{key,label,type,unit?,min?,max?,required?,options?}], required?, on_overview?, sort_order?}; '
      + 'form.archive {area, form}; field.archive {area, form, key}; note {text} para una recomendación sin cambios. '
      + 'Tipos: number, integer, scale, boolean, text, choice, multi, date, time, duration (minutos), table. Las claves son minúsculas con guiones bajos. La clave y el tipo de un campo existente no cambian: archívalo y crea otro.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['area.save', 'form.save', 'field.save', 'form.archive', 'field.archive', 'note'] },
        payload: { type: 'object' },
        rationale: { type: 'string', description: 'Por qué, en una o dos frases, para que él decida.' },
      },
      required: ['kind', 'payload', 'rationale'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(args, { api }) {
      const id = await api.rpc<string>('create_proposal', {
        p_kind: str(args.kind, 'kind', true),
        p_payload: args.payload,
        p_rationale: str(args.rationale, 'rationale', true),
      });
      return { proposal_id: id, status: 'pending', next: 'martagon la aprueba o rechaza en el dashboard (Propuestas).' };
    },
  },
  {
    name: 'lifeos_proposals',
    title: 'Ver propuestas',
    description: 'Lista propuestas y su estado (pending, applied, rejected, failed, expired).',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['pending', 'applied', 'rejected', 'failed', 'expired'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args, { api }) {
      const list = await api.proposals({ status: str(args.status, 'status'), limit: Math.min(Number(args.limit ?? 20) || 20, 100) });
      return list.map((p) => ({ proposal_id: p.id, kind: p.kind, status: p.status, rationale: p.rationale, payload: p.payload, created_at: p.created_at, result: p.result }));
    },
  },
];

function ok(id: JsonRpcResponse['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}
function fail(id: JsonRpcResponse['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Traduce los errores de la base de datos (en inglés) para que Claude se los explique bien a él. */
export function explainDbError(message: string): string {
  const m = message.replace(/^.*?ERROR:\s*/, '');
  if (/use api\.create_proposal/.test(m)) return 'No permitido para Claude: cambia la estructura con lifeos_propose_change.';
  if (/not authorized/.test(m)) return 'Sin permiso: la cuenta conectada no es la del dueño.';
  return `La base de datos rechazó el registro: ${m}`;
}

async function callTool(params: Record<string, unknown> | undefined, ctx: Ctx) {
  const name = params?.name;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw Object.assign(new Error(`Unknown tool: ${String(name)}`), { rpcCode: -32602 });
  const args = (params?.arguments ?? {}) as Record<string, unknown>;
  try {
    const result = await tool.run(args, ctx);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: Array.isArray(result) ? { items: result } : (result as Json),
      isError: false,
    };
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : explainDbError(e instanceof Error ? e.message : String(e));
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
}

export async function handleMessage(msg: JsonRpcRequest, ctx: Ctx): Promise<JsonRpcResponse | null> {
  const isNotification = msg.id === undefined;
  if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return isNotification ? null : fail(msg?.id ?? null, -32600, 'Invalid Request');
  }
  if (isNotification) return null;
  const id = msg.id ?? null;
  try {
    switch (msg.method) {
      case 'initialize': {
        const requested = String(msg.params?.protocolVersion ?? '');
        return ok(id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, {
          tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
        });
      case 'tools/call':
        return ok(id, await callTool(msg.params, ctx));
      default:
        return fail(id, -32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    const code = (e as { rpcCode?: number }).rpcCode ?? -32603;
    return fail(id, code, e instanceof Error ? e.message : 'Internal error');
  }
}

/** Procesa el cuerpo de un POST (mensaje único o lote). Devuelve null si no hay respuesta (solo notificaciones). */
export async function handleBody(body: unknown, ctx: Ctx): Promise<unknown | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(m as JsonRpcRequest, ctx)))).filter(Boolean);
    return out.length ? out : null;
  }
  return handleMessage(body as JsonRpcRequest, ctx);
}
