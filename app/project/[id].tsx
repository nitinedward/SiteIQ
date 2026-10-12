import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useState, useCallback, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../lib/theme'
import { latestRevisions, revisionCount } from '../../lib/drawingRevisions';
import { FooterNav } from '../../components/FooterNav';
import { SyncStatus } from '../../components/SyncStatus';
import {
  discardInspection, getProject, listDrawings, listInspections, myId, projectStats,
} from '../../lib/offline/store';
import {
  downloadProject, offlineProjects, onOfflineProjectsChange, removeOfflineProject, type OfflineProject,
} from '../../lib/offline/download';
import { isOnline } from '../../lib/offline/net';
import { loadProjectDocs, canLabel, sketchSource, sketchViewerParams, type CanItem, type SketchItem, type DrawingRow } from '../../lib/projectDocs';

const T = theme.colors;
const R = theme.radius;

type Project = {
  id: string; name: string; address: string; client_name: string;
  project_number: string; status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
  description: string; drawing_count: number; created_at: string;
};
type Drawing = {
  id: string; title: string; number: string; revision: string;
  file_url: string; preview_url: string | null; created_at: string;
};
type Inspection = {
  id: string; date: string; report_no: string; weather: string;
  site_contact: string; status: string; created_at: string;
  created_by?: string | null; _pending?: boolean;
};

const statusConfig = {
  ACTIVE:    { colour: '#5B9279', bg: '#E7F0EB', label: 'Active' },
  ON_HOLD:   { colour: '#92400E', bg: '#FEF3C7', label: 'On Hold' },
  COMPLETED: { colour: '#3A4A63', bg: '#EEF1F6', label: 'Completed' },
};

const fmt = (d: string) => new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
const ago = (t: number) => {
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} h ago` : fmt(new Date(t).toISOString());
};
const DRAWING_PREVIEW_COUNT = 3;
const REPORT_PREVIEW_COUNT = 3;

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams();
  const [project, setProject]         = useState<Project | null>(null);
  const [drawings, setDrawings]       = useState<Drawing[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [photoCount, setPhotoCount]   = useState(0);
  const [showAllDrawings, setShowAllDrawings] = useState(false);
  // Older revisions of a sheet stay out of the list until asked for, as on
  // the web portal — the current sheet is the one worth opening on site.
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [showAllReports, setShowAllReports] = useState(false);
  // Drawings, CANs and sketches are kept apart, as on the web.
  const [docTab, setDocTab]             = useState<'drawings' | 'cans' | 'sketches'>('drawings');
  const [cans, setCans]                 = useState<CanItem[]>([]);
  const [sketches, setSketches]         = useState<SketchItem[]>([]);

  // Visits started on this phone (or by this engineer) and not completed —
  // continued or thrown away from here, never deleted behind their back.
  const [inProgress, setInProgress] = useState<Inspection[]>([]);
  const [offline, setOffline] = useState<OfflineProject | null>(null);
  const [download, setDownload] = useState<{ fraction: number; what: string } | null>(null);

  const pid = String(id);

  // From the phone's copy at once, refreshed from the server behind it
  // when there's signal (lib/offline/store).
  const fetchData = async () => {
    const me = await myId();
    const showInspections = (rows: Inspection[]) => {
      setInspections(rows.filter(r => r.status === 'COMPLETED'));
      setInProgress(rows.filter(r => r.status !== 'COMPLETED' && (r._pending || r.created_by === me)));
    };
    // A sketch's hidden drawing row (see lib/projectDocs) goes under
    // Sketches, never Drawings; a failure loading CANs leaves them empty.
    const showDrawings = (rows: DrawingRow[]) => {
      setDrawings(rows.filter(r => (r.kind ?? 'drawing') !== 'sketch') as Drawing[]);
      loadProjectDocs(pid, rows)
        .then(docs => { setCans(docs.cans); setSketches(docs.sketches); })
        .catch(err => { console.warn('[project] CANs/sketches:', err); setCans([]); setSketches([]); });
    };
    const [p, d, ins] = await Promise.all([
      getProject(pid, row => row && setProject(row)),
      listDrawings(pid, showDrawings),
      listInspections(pid, showInspections),
    ]);
    if (!p) {
      setError(isOnline()
        ? 'Project not found.'
        : "This project isn't on the phone yet. Open it once with signal, or make it available offline.");
      setLoading(false);
      return;
    }
    setError('');
    setProject(p as Project);
    showDrawings(d as DrawingRow[]);
    showInspections(ins as Inspection[]);
    setLoading(false);

    // Photo count for the stat tile; best-effort.
    const showPhotos = (stats: Record<string, { photos: number }>) => setPhotoCount(stats[pid]?.photos ?? 0);
    projectStats([pid], showPhotos).then(showPhotos).catch(() => {});
  };

  const loadOffline = () => offlineProjects().then(rows => setOffline(rows.find(r => r.project_id === pid) ?? null)).catch(() => {});
  useEffect(() => onOfflineProjectsChange(loadOffline), [pid]);

  const toggleOffline = (on: boolean) => {
    if (on) {
      if (!isOnline()) { Alert.alert('No connection', 'Connect to Wi-Fi or mobile data to download this project.'); return; }
      setDownload({ fraction: 0, what: 'Starting' });
      downloadProject(pid, (fraction, what) => setDownload({ fraction, what }))
        .then(() => { setDownload(null); fetchData(); })
        .catch(err => { setDownload(null); Alert.alert('Download stopped', err?.message ?? 'Please try again.'); });
      return;
    }
    Alert.alert('Remove from this phone?', "The project's drawings are removed from the phone to free space. Anything not yet uploaded stays and still uploads.", [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { removeOfflineProject(pid); } },
    ]);
  };

  const continueVisit = (ins: Inspection) =>
    router.push({ pathname: '/session', params: { project_id: pid, project_name: project?.name ?? '', inspection_id: ins.id } });

  const discardVisit = (ins: Inspection) => Alert.alert(
    'Discard this visit?',
    `SR ${ins.report_no} and all its notes and photos will be deleted. This cannot be undone.`,
    [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: async () => { await discardInspection(ins.id); fetchData(); } },
    ]);

  const openReport = (ins: Inspection) => {
    if (!isOnline()) { Alert.alert('No connection', 'Opening a finished report needs signal.'); return; }
    router.push({ pathname: '/report/[id]', params: { id: ins.id, project_name: project?.name ?? '' } });
  };

  useFocusEffect(useCallback(() => { fetchData(); loadOffline(); }, [id]));

  if (loading) return (
    <View style={S.centred}>
      <ActivityIndicator size="large" color={T.indigo} />
    </View>
  );
  if (error || !project) return (
    <View style={S.centred}>
      <Text style={[S.errText, { textAlign: 'center', paddingHorizontal: 32 }]}>{error || 'Project not found'}</Text>
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={S.link}>Go back</Text>
      </TouchableOpacity>
    </View>
  );

  // Looked up leniently and with a fallback: a status the app doesn't know
  // came back undefined and crashed this screen on the line that reads it,
  // so the project simply would not open.
  const status = statusConfig[(project.status ?? '').toUpperCase() as keyof typeof statusConfig]
    ?? { colour: T.mid, bg: '#EEF0F2', label: project.status || 'Unknown' };

  // Sheets re-issued at a later revision: only the current one is listed,
  // with the superseded ones a tap away.
  const currentDrawings  = latestRevisions(drawings);
  const visibleDrawings  = showSuperseded ? drawings : currentDrawings;
  const supersededCount  = drawings.length - currentDrawings.length;

  return (
    <View style={S.container}>
      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={T.indigo} />
        </TouchableOpacity>
        <View style={S.headerMid}>
          <Text style={S.headerTitle} numberOfLines={1}>{project.name}</Text>
          <Text style={S.headerSub} numberOfLines={1}>#{project.project_number}{project.address ? ` · ${project.address}` : ''}</Text>
        </View>
        <View style={[S.statusPill, { backgroundColor: status.bg }]}>
          <Text style={[S.statusText, { color: status.colour }]}>{status.label}</Text>
        </View>
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>

        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}><SyncStatus /></View>

        {/* VISITS IN PROGRESS */}
        {inProgress.map(ins => (
          <View key={ins.id} style={S.progressCard}>
            <View style={{ flex: 1 }}>
              <Text style={S.progressTitle}>SR {ins.report_no} · in progress</Text>
              <Text style={S.progressSub}>{ins.date}{ins._pending ? ' · not uploaded yet' : ''}</Text>
            </View>
            <TouchableOpacity onPress={() => discardVisit(ins)} style={S.progressDiscard}>
              <Ionicons name="trash-outline" size={18} color={T.clay} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => continueVisit(ins)} style={S.progressContinue} activeOpacity={0.85}>
              <Text style={S.progressContinueText}>Continue</Text>
            </TouchableOpacity>
          </View>
        ))}

        {/* START INSPECTION — hero button */}
        {project.status !== 'COMPLETED' && (
          <View style={S.heroSection}>
            <TouchableOpacity style={S.startBtn}
              onPress={() => router.push({ pathname: '/session', params: { project_id: project.id, project_name: project.name } })}
              activeOpacity={0.85}>
              <View style={S.startLeft}>
                <Text style={S.startTitle}>Start Inspection</Text>
                <Text style={S.startSub}>
                  {inspections.length > 0 ? `Last visit ${inspections[0].date}` : 'No inspections yet'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={T.indigoDeep} />
            </TouchableOpacity>
          </View>
        )}

        {/* STATS */}
        <View style={S.statsRow}>
          <View style={S.statTile}>
            <Text style={S.statNum}>{inspections.length}</Text>
            <Text style={S.statLabel}>Reports</Text>
          </View>
          <View style={S.statTile}>
            <Text style={S.statNum}>{photoCount}</Text>
            <Text style={S.statLabel}>Photos</Text>
          </View>
          <View style={S.statTile}>
            <Text style={S.statNum}>{latestRevisions(drawings).length}</Text>
            <Text style={S.statLabel}>Drawings</Text>
          </View>
        </View>

        {/* AVAILABLE OFFLINE */}
        <View style={S.offlineCard}>
          <Ionicons name={offline ? 'cloud-done-outline' : 'cloud-download-outline'} size={22} color={offline ? T.sage : T.indigo} />
          <View style={{ flex: 1 }}>
            <Text style={S.offlineTitle}>Available offline</Text>
            <Text style={S.offlineSub}>
              {download
                ? `Downloading · ${download.what} · ${Math.round(download.fraction * 100)}%`
                : offline
                  ? `On this phone · updated ${ago(offline.downloaded_at)}${offline.bytes ? ` · ${Math.max(1, Math.round(offline.bytes / 1e6))} MB` : ''}`
                  : 'Download drawings and reports to work with no signal'}
            </Text>
            {!!download && (
              <View style={S.offlineBar}><View style={[S.offlineBarFill, { width: `${Math.round(download.fraction * 100)}%` }]} /></View>
            )}
          </View>
          {download
            ? <ActivityIndicator color={T.indigo} />
            : <Switch value={!!offline} onValueChange={toggleOffline} trackColor={{ true: T.sage, false: T.line }} />}
        </View>

        {/* DRAWINGS · CANs · SKETCHES */}
        <View style={S.section}>
          <View style={S.segment}>
            {([
              ['drawings', `Drawings (${currentDrawings.length})`],
              ['cans', `CANs (${cans.filter(c => c.status === 'current').length})`],
              ['sketches', `Sketches (${sketches.length})`],
            ] as const).map(([key, label]) => (
              <TouchableOpacity key={key} style={[S.segmentBtn, docTab === key && S.segmentBtnActive]}
                onPress={() => setDocTab(key)} activeOpacity={0.8}>
                <Text style={[S.segmentText, docTab === key && S.segmentTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {docTab === 'drawings' && (
            <>
              {visibleDrawings.length > DRAWING_PREVIEW_COUNT && (
                <TouchableOpacity onPress={() => setShowAllDrawings(v => !v)} style={{ alignSelf: 'flex-end', marginBottom: 8 }}>
                  <Text style={S.viewAllText}>{showAllDrawings ? 'Show less' : 'View all'}</Text>
                </TouchableOpacity>
              )}
            {drawings.length === 0 ? (
              <View style={S.emptyCard}>
                <Text style={S.emptyText}>No drawings — admin uploads via web portal</Text>
              </View>
            ) : (showAllDrawings ? visibleDrawings : visibleDrawings.slice(0, DRAWING_PREVIEW_COUNT)).map(d => (
              <TouchableOpacity key={d.id} style={S.row}
                onPress={() => router.push({ pathname: '/drawing/[id]', params: { id: d.id, title: d.title, number: d.number, revision: d.revision, file_url: d.file_url, preview_url: d.preview_url ?? '', project_id: project.id, view_only: 'true' } })}
                activeOpacity={0.7}>
                <View style={S.rowBadge}>
                  <Text style={S.rowBadgeText}>{d.number || '-'}</Text>
                </View>
                <View style={S.rowInfo}>
                  <Text style={S.rowTitle} numberOfLines={1}>{d.title}</Text>
                  <Text style={S.rowMeta}>
                    Rev {d.revision}
                    {!showSuperseded && revisionCount(drawings, d) > 1
                      ? ` · ${revisionCount(drawings, d)} revisions`
                      : ''}
                    {showSuperseded && !currentDrawings.some(c => c.id === d.id) ? ' · superseded' : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={T.mid} />
              </TouchableOpacity>
            ))}
  
            {supersededCount > 0 && (
              <TouchableOpacity onPress={() => setShowSuperseded(v => !v)} activeOpacity={0.7} style={{ paddingVertical: 10 }}>
                <Text style={S.viewAllText}>
                  {showSuperseded
                    ? 'Hide older revisions'
                    : `Show ${supersededCount} older revision${supersededCount === 1 ? '' : 's'}`}
                </Text>
              </TouchableOpacity>
            )}
            </>
          )}

          {/* A CAN is the whole notice: open it in full, and its sketches are listed on its screen. */}
          {docTab === 'cans' && (
            cans.length === 0 ? (
              <View style={S.emptyCard}>
                <Text style={S.emptyText}>No CANs — uploaded via web portal</Text>
              </View>
            ) : cans.map(c => (
              <TouchableOpacity key={c.id} style={[S.row, c.status === 'superseded' && { opacity: 0.6 }]}
                onPress={() => router.push({ pathname: '/can/[id]', params: { id: c.id, project_id: project.id } })}
                activeOpacity={0.7}>
                <View style={S.rowBadge}>
                  <Text style={S.rowBadgeText}>{c.number || 'CAN'}</Text>
                </View>
                <View style={S.rowInfo}>
                  <Text style={S.rowTitle} numberOfLines={1}>{c.title || canLabel(c)}</Text>
                  <Text style={S.rowMeta}>
                    {c.revision ? `Rev ${c.revision}` : 'No revision'}
                    {c.issuedOn ? ` · issued ${fmt(c.issuedOn)}` : ''}
                    {` · ${c.sketches.length} sketch${c.sketches.length === 1 ? '' : 'es'}`}
                    {c.status === 'superseded' ? ' · superseded' : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={T.mid} />
              </TouchableOpacity>
            ))
          )}

          {docTab === 'sketches' && (
            sketches.length === 0 ? (
              <View style={S.emptyCard}>
                <Text style={S.emptyText}>No sketches — added via web portal or found in a CAN</Text>
              </View>
            ) : sketches.map(sk => (
              <TouchableOpacity key={sk.drawing.id} style={S.row}
                onPress={() => router.push({ pathname: '/drawing/[id]', params: sketchViewerParams(sk, project.id) })}
                activeOpacity={0.7}>
                <View style={[S.rowBadge, { backgroundColor: T.goldSoft }]}>
                  <Ionicons name="create-outline" size={14} color={T.indigo} />
                </View>
                <View style={S.rowInfo}>
                  <Text style={S.rowTitle} numberOfLines={1}>{sk.title}</Text>
                  <Text style={S.rowMeta} numberOfLines={1}>{sketchSource(sk, cans)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={T.mid} />
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* PAST REPORTS */}
        <View style={S.section}>
          <View style={S.sectionHeaderRow}>
            <Text style={S.sectionTitleRow}>Site Reports</Text>
            {inspections.length > REPORT_PREVIEW_COUNT && (
              <TouchableOpacity onPress={() => setShowAllReports(v => !v)}>
                <Text style={S.viewAllText}>{showAllReports ? 'Show less' : 'View all'}</Text>
              </TouchableOpacity>
            )}
          </View>
          {inspections.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No reports yet — start an inspection above</Text>
            </View>
          ) : (showAllReports ? inspections : inspections.slice(0, REPORT_PREVIEW_COUNT)).map(ins => (
            <TouchableOpacity key={ins.id} style={S.row} activeOpacity={0.7}
              onPress={() => openReport(ins)}>
              <View style={S.rowBadge}>
                <Text style={S.rowBadgeText}>SR {ins.report_no}</Text>
              </View>
              <View style={S.rowInfo}>
                <Text style={S.rowTitle} numberOfLines={1}>{ins.date}</Text>
                <Text style={S.rowMeta}>{ins.site_contact || 'No contact'} · {ins.weather}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={T.mid} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Footer nav — shared component, same one the real (tabs) bar renders */}
      <FooterNav active={null} onPress={(tab) => router.push(`/(tabs)/${tab}`)} />
    </View>
  );
}

const S = StyleSheet.create({
  container:   { flex: 1, backgroundColor: T.paper },
  centred:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: T.paper },
  errText:     { fontSize: 16, color: T.ink },
  link:        { fontSize: 15, color: T.indigo, marginTop: 8 },
  scroll:      { flex: 1 },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 20, backgroundColor: T.paper, borderBottomWidth: 1, borderBottomColor: T.line, gap: 12 },
  backBtn:     {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
    alignItems: 'center', justifyContent: 'center',
  },
  headerMid:   { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: T.indigo },
  headerSub:   { fontSize: 11, color: T.mid, marginTop: 1 },
  statusPill:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText:  { fontSize: 13, fontWeight: '700' },

  // Hero start button
  heroSection: { padding: 16 },
  startBtn:    {
    backgroundColor: T.marigold,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: T.marigoldDeep,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 20,
    elevation: 6,
  },
  startLeft:   { gap: 4 },
  startTitle:  { fontSize: 20, fontWeight: '800', color: T.indigoDeep },
  startSub:    { fontSize: 13, color: 'rgba(44,57,80,0.72)' },
  startArrow:  { fontSize: 32, color: T.indigoDeep, lineHeight: 36 },

  // Stats
  statsRow:  { flexDirection: 'row', gap: 12, paddingHorizontal: 24, marginTop: 16, marginBottom: 20 },
  statTile:  {
    flex: 1, backgroundColor: T.surface, borderRadius: 18,
    paddingVertical: 22, paddingHorizontal: 8, alignItems: 'center',
    borderWidth: 1, borderColor: T.line,
  },
  statNum:   { fontSize: 22, fontWeight: '800', color: T.indigo },
  statLabel: { fontSize: 13, color: T.mid, marginTop: 4 },

  // Sections
  section:         { paddingHorizontal: 16, paddingBottom: 8 },
  sectionTitle:    { fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, marginTop: 24 },
  sectionHeaderRow:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 24 },
  sectionTitleRow: { fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1 },
  viewAllText:     { fontSize: 11, fontWeight: '700', color: T.indigo },

  // Drawings · CANs · Sketches switch
  segment:          { flexDirection: 'row', backgroundColor: T.surface, borderRadius: R.pill, padding: 4, marginTop: 24, marginBottom: 12, borderWidth: 1, borderColor: T.line },
  segmentBtn:       { flex: 1, paddingVertical: 9, borderRadius: R.pill, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: T.indigo },
  segmentText:      { fontSize: 12, fontWeight: '700', color: T.mid },
  segmentTextActive:{ color: '#FFFFFF' },

  // Rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface,
    borderRadius: R.md,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: T.line,
  },
  rowBadge:    { backgroundColor: T.indigoSoft, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 6, minWidth: 48, alignItems: 'center' },
  rowBadgeText:{ fontSize: 10, color: T.indigo, fontWeight: '700' },
  rowInfo:     { flex: 1 },
  rowTitle:    { fontSize: 15, fontWeight: '700', color: T.ink, marginBottom: 2 },
  rowMeta:     { fontSize: 11, color: T.mid },
  rowArrow:    { fontSize: 22, color: T.mid },

  // Visits in progress
  progressCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 12, padding: 14,
    backgroundColor: T.goldSoft, borderRadius: R.md, borderWidth: 1, borderColor: T.marigold,
  },
  progressTitle:   { fontSize: 15, fontWeight: '800', color: T.indigoDeep },
  progressSub:     { fontSize: 12, color: T.mid, marginTop: 2 },
  progressDiscard: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: T.surface },
  progressContinue:{ backgroundColor: T.indigo, borderRadius: R.pill, paddingHorizontal: 16, paddingVertical: 10 },
  progressContinueText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  // Available offline
  offlineCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 4, padding: 14,
    backgroundColor: T.surface, borderRadius: R.md, borderWidth: 1, borderColor: T.line,
  },
  offlineTitle:   { fontSize: 15, fontWeight: '700', color: T.ink },
  offlineSub:     { fontSize: 12, color: T.mid, marginTop: 2 },
  offlineBar:     { height: 4, backgroundColor: T.line, borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  offlineBarFill: { height: 4, backgroundColor: T.indigo },

  // Empty
  emptyCard: {
    backgroundColor: T.surface,
    borderRadius: R.md,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#2C3950',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  emptyText: { fontSize: 13, color: T.mid, textAlign: 'center' },
});
