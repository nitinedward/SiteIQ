import { supabase } from './supabase';
import { getMeta, setMeta } from './offline/db';
import { isOnline, withTimeout } from './offline/net';

/**
 * A project's documents, split the way the web app splits them:
 *
 *  - drawings  uploaded drawing sheets
 *  - CANs      Consultant Advice Notices, each a whole PDF; the sketches
 *              found in it are listed under it
 *  - sketches  every sketch on the project — from a CAN, or dropped onto a
 *              site note or report in the office
 *
 * A sketch is opened and marked up with the same viewer as a drawing: on the
 * web each one is given a hidden row in `drawings` (kind 'sketch'), which is
 * what the viewer opens. Those rows are kept out of the drawings list here.
 * See web/sql/cans.sql.
 */

export type DrawingRow = {
  id: string; title: string; number: string; revision: string;
  file_url: string; preview_url: string | null; created_at: string;
  kind?: string | null; sketch_id?: string | null;
};

export type SketchItem = {
  /** The drawing row the viewer opens. */
  drawing: DrawingRow;
  title: string;
  canId: string | null;
  canPage: number | null;
  observationId: string | null;
};

export type CanItem = {
  id: string;
  number: string;
  title: string;
  revision: string;
  issuedOn: string | null;
  summary: string;
  fileUrl: string;
  pageCount: number;
  status: 'current' | 'superseded';
  createdAt: string;
  sketches: SketchItem[];
};

export const isSketchRow = (d: { kind?: string | null }) => (d.kind ?? 'drawing') === 'sketch';

/** "CAN-003 Rev A" */
export const canLabel = (c: { number: string; revision: string }) =>
  `${c.number}${c.revision ? ` Rev ${c.revision}` : ''}`;

/** Splits a project's drawing rows and loads its CANs and sketches. A
 *  database without the CAN tables yet simply has none. */
export async function loadProjectDocs(projectId: string, drawingRows: DrawingRow[]): Promise<{
  drawings: DrawingRow[];
  cans: CanItem[];
  sketches: SketchItem[];
}> {
  const drawings = drawingRows.filter(d => !isSketchRow(d));
  const sketchRows = drawingRows.filter(isSketchRow);

  const { canRows, sketchMeta } = await fetchCansAndSketches(projectId, sketchRows);

  const metaById = new Map((sketchMeta ?? []).map((s: any) => [s.id, s]));
  const sketches: SketchItem[] = sketchRows.map(d => {
    const m: any = d.sketch_id ? metaById.get(d.sketch_id) : null;
    return {
      drawing: d,
      title: m?.title || d.title,
      canId: m?.can_id ?? null,
      canPage: m?.can_page ?? null,
      observationId: m?.observation_id ?? null,
    };
  });

  const cans: CanItem[] = (canRows ?? []).map((r: any) => ({
    id: r.id,
    number: r.number,
    title: r.title ?? '',
    revision: r.revision ?? '',
    issuedOn: r.issued_on ?? null,
    summary: r.summary ?? '',
    fileUrl: r.file_url,
    pageCount: r.page_count ?? 0,
    status: r.status === 'superseded' ? 'superseded' : 'current',
    createdAt: r.created_at,
    sketches: sketches
      .filter(s => s.canId === r.id)
      .sort((a, b) => (a.canPage ?? 0) - (b.canPage ?? 0)),
  }));
  // Current first, then by number.
  cans.sort((a, b) =>
    (a.status === b.status ? 0 : a.status === 'current' ? -1 : 1) ||
    a.number.localeCompare(b.number, undefined, { numeric: true }) ||
    b.createdAt.localeCompare(a.createdAt));

  return { drawings, cans, sketches };
}

/** The project's CANs and its sketches' details, from the server when there
 *  is a connection (and remembered), from the phone's copy when not. */
async function fetchCansAndSketches(projectId: string, sketchRows: DrawingRow[]): Promise<{ canRows: any[]; sketchMeta: any[] }> {
  const key = `projectDocs:${projectId}`;
  if (isOnline()) {
    try {
      const [cans, meta] = await withTimeout(Promise.all([
        supabase.from('cans').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
        supabase.from('sketches').select('id, title, can_id, can_page, observation_id').eq('project_id', projectId),
      ]), 12_000);
      if (!cans.error && !meta.error) {
        const fresh = { canRows: cans.data ?? [], sketchMeta: meta.data ?? [] };
        await setMeta(key, fresh);
        return fresh;
      }
      // A database without the CAN tables yet simply has none.
      if (/relation .* does not exist|schema cache/i.test(`${cans.error?.message} ${meta.error?.message}`)) return { canRows: [], sketchMeta: [] };
    } catch { /* no usable signal: the phone's copy */ }
  }
  const cached = await getMeta<{ canRows: any[]; sketchMeta: any[] }>(key);
  if (cached) return cached;
  return { canRows: [], sketchMeta: [] };
}

/** Where a sketch came from, for a list row. */
export function sketchSource(s: SketchItem, cans: CanItem[]): string {
  if (s.canId) {
    const can = cans.find(c => c.id === s.canId);
    if (can) return `${canLabel(can)} · page ${s.canPage}${can.status === 'superseded' ? ' · superseded' : ''}`;
    return 'From a CAN';
  }
  return s.observationId ? 'Sketch on a site note' : 'Sketch';
}

/** Opens a sketch in the drawing viewer — to look at, or with an
 *  inspection to mark up. */
export function sketchViewerParams(s: SketchItem, projectId: string, extra: Record<string, string> = {}) {
  const d = s.drawing;
  return {
    id: d.id, title: s.title, number: d.number, revision: d.revision,
    file_url: d.file_url, preview_url: d.preview_url ?? '', project_id: projectId,
    view_only: 'true', ...extra,
  };
}
