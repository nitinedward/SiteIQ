import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Switch, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../lib/theme';
import {
  DEFAULT_KEEP, downloadProject, keepOptions, measureProject, removeOfflineProject,
  type KeepOptions, type ProjectSizes,
} from '../../lib/offline/download';
import { getProject } from '../../lib/offline/store';

const T = theme.colors;
const R = theme.radius;

const mb = (bytes: number) => bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Keep on this phone": what of a project to download for use with no
 * signal — drawings, older revisions, sketches, site-note photos and each
 * finalised report — with real sizes and the phone's free space, so an
 * engineer with little storage can leave the heavy things out
 * (lib/offline/download).
 */
export default function OfflineSetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = String(id);
  const insets = useSafeAreaInsets();
  const [name, setName]       = useState('');
  const [sizes, setSizes]     = useState<ProjectSizes | null>(null);
  const [problem, setProblem] = useState('');
  const [kept, setKept]       = useState(false);
  const [opts, setOpts]       = useState<KeepOptions | null>(null);
  const [progress, setProgress] = useState<{ fraction: number; what: string } | null>(null);

  useEffect(() => {
    getProject(pid).then(p => setName(p?.name ?? '')).catch(() => {});
    (async () => {
      try {
        const [measured, before] = await Promise.all([measureProject(pid), keepOptions(pid)]);
        setSizes(measured);
        setKept(!!before);
        const withPdf = measured.reports.filter(r => r.bytes !== null).map(r => r.id);
        setOpts(before
          ? { ...before, reports: before.reports.filter(r => withPdf.includes(r)) }
          : { ...DEFAULT_KEEP, reports: withPdf });
      } catch (err: any) {
        setProblem(err?.message ?? 'Could not check the project.');
      }
    })();
  }, [pid]);

  const total = useMemo(() => {
    if (!sizes || !opts) return 0;
    return (opts.drawings ? sizes.current.bytes : 0)
      + (opts.older ? sizes.older.bytes : 0)
      + (opts.sketches ? sizes.sketches.bytes : 0)
      + (opts.photos ? sizes.photos.bytes : 0)
      + sizes.reports.filter(r => opts.reports.includes(r.id)).reduce((a, r) => a + (r.bytes ?? 0), 0);
  }, [sizes, opts]);

  const set = (patch: Partial<KeepOptions>) => setOpts(o => o ? { ...o, ...patch } : o);
  const toggleReport = (rid: string) =>
    setOpts(o => o ? { ...o, reports: o.reports.includes(rid) ? o.reports.filter(x => x !== rid) : [...o.reports, rid] } : o);
  const reportsWithPdf = sizes?.reports.filter(r => r.bytes !== null) ?? [];
  const allReportsOn = !!opts && reportsWithPdf.length > 0 && reportsWithPdf.every(r => opts.reports.includes(r.id));

  const tooBig = !!sizes && total > sizes.free - 200e6;

  const start = () => {
    if (!opts) return;
    const go = () => {
      setProgress({ fraction: 0, what: 'Starting' });
      downloadProject(pid, (fraction, what) => setProgress({ fraction, what }), opts)
        .then(() => { setProgress(null); router.back(); })
        .catch(err => { setProgress(null); Alert.alert('Download stopped', err?.message ?? 'Please try again.'); });
    };
    if (tooBig) {
      Alert.alert('Not enough space', `This needs about ${mb(total)} and the phone has ${mb(sizes!.free)} free. Leave some reports or drawings out, or free up space.`);
      return;
    }
    go();
  };

  const stopKeeping = () => Alert.alert('Stop keeping this project?', 'Its drawings, photos and reports are removed from the phone. Anything not yet uploaded stays and still uploads.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { await removeOfflineProject(pid); router.back(); } },
  ]);

  const Row = ({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (v: boolean) => void }) => (
    <View style={S.option}>
      <View style={{ flex: 1 }}>
        <Text style={S.optionLabel}>{label}</Text>
        <Text style={S.optionDetail}>{detail}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: T.sage, false: T.line }} disabled={!!progress} />
    </View>
  );

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()} accessibilityLabel="Back" disabled={!!progress}>
          <Ionicons name="arrow-back" size={22} color={T.indigo} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.title}>Keep on this phone</Text>
          <Text style={S.sub} numberOfLines={1}>{name}</Text>
        </View>
      </View>

      {problem ? (
        <View style={S.centred}><Text style={S.problem}>{problem}</Text></View>
      ) : !sizes || !opts ? (
        <View style={S.centred}>
          <ActivityIndicator size="large" color={T.indigo} />
          <Text style={S.muted}>Checking sizes…</Text>
        </View>
      ) : (
        <>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={S.body}>
            <Text style={S.intro}>
              The project's details, site notes and their history, and small previews of every drawing are always kept (a few hundred KB). Choose the rest:
            </Text>

            <Text style={S.section}>Drawings</Text>
            <View style={S.card}>
              <Row label="Current drawings" detail={`${plural(sizes.current.count, 'sheet', 'sheets')} · ${mb(sizes.current.bytes)}`} value={opts.drawings} onChange={v => set({ drawings: v })} />
              {sizes.older.count > 0 && (
                <Row label="Older revisions" detail={`${plural(sizes.older.count, 'sheet', 'sheets')} · ${mb(sizes.older.bytes)}`} value={opts.older} onChange={v => set({ older: v })} />
              )}
              <Row label="Sketches" detail={sizes.sketches.count ? `${plural(sizes.sketches.count, 'sketch', 'sketches')} · ${mb(sizes.sketches.bytes)}` : 'None on this project'} value={opts.sketches} onChange={v => set({ sketches: v })} />
              <Row label="Site note photos" detail={sizes.photos.count ? `${plural(sizes.photos.count, 'photo', 'photos')} (small copies) · about ${mb(sizes.photos.bytes)}` : 'None yet'} value={opts.photos} onChange={v => set({ photos: v })} />
            </View>

            <View style={S.sectionRow}>
              <Text style={S.section}>Site reports</Text>
              {reportsWithPdf.length > 1 && (
                <TouchableOpacity onPress={() => set({ reports: allReportsOn ? [] : reportsWithPdf.map(r => r.id) })}>
                  <Text style={S.link}>{allReportsOn ? 'None' : 'All'}</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={S.card}>
              {sizes.reports.length === 0 ? (
                <Text style={[S.optionDetail, { padding: 14 }]}>No finalised reports yet</Text>
              ) : sizes.reports.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={S.report}
                  onPress={() => r.bytes !== null && toggleReport(r.id)}
                  disabled={r.bytes === null || !!progress}
                  activeOpacity={0.7}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: opts.reports.includes(r.id), disabled: r.bytes === null }}
                >
                  <Ionicons
                    name={r.bytes === null ? 'remove-circle-outline' : opts.reports.includes(r.id) ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={r.bytes === null ? T.line : opts.reports.includes(r.id) ? T.indigo : T.mid}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={S.optionLabel}>SR {r.report_no} · {r.date}</Text>
                    <Text style={S.optionDetail} numberOfLines={1}>
                      {r.bytes === null ? 'No PDF (finalised before PDFs were kept)' : `${mb(r.bytes)}${r.onPhone ? ' · on this phone' : ''}${r.summary ? ` · ${r.summary}` : ''}`}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              <Row label="Reports finalised from now on" detail="Download each new report when it's finalised" value={opts.newReports} onChange={v => set({ newReports: v })} />
            </View>

            {kept && (
              <TouchableOpacity onPress={stopKeeping} style={{ paddingVertical: 16 }} disabled={!!progress}>
                <Text style={[S.link, { color: T.clay, textAlign: 'center' }]}>Stop keeping this project on the phone</Text>
              </TouchableOpacity>
            )}
            <View style={{ height: 140 }} />
          </ScrollView>

          <View style={[S.footer, { paddingBottom: 16 + Math.max(16, insets.bottom) }]}>
            <Text style={[S.total, tooBig && { color: T.clay }]}>
              Selected: {mb(total)} · Free on this phone: {mb(sizes.free)}
            </Text>
            {progress ? (
              <View style={{ gap: 6 }}>
                <Text style={S.muted}>{progress.what} · {Math.round(progress.fraction * 100)}%</Text>
                <View style={S.bar}><View style={[S.barFill, { width: `${Math.round(progress.fraction * 100)}%` }]} /></View>
              </View>
            ) : (
              <TouchableOpacity style={[S.go, tooBig && { opacity: 0.5 }]} onPress={start} activeOpacity={0.85}>
                <Text style={S.goText}>{kept ? 'Save changes' : 'Download'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.paper },
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 60, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: T.line },
  backBtn:   { width: 44, height: 44, borderRadius: 22, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, alignItems: 'center', justifyContent: 'center' },
  title:     { fontSize: 18, fontWeight: '800', color: T.indigo },
  sub:       { fontSize: 12, color: T.mid, marginTop: 1 },
  centred:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  problem:   { fontSize: 14, color: T.ink, textAlign: 'center' },
  muted:     { fontSize: 13, color: T.mid },
  body:      { padding: 16 },
  intro:     { fontSize: 13, color: T.mid, lineHeight: 19 },
  section:   { fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginTop: 20, marginBottom: 8 },
  sectionRow:{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  link:      { fontSize: 13, fontWeight: '700', color: T.indigo, marginBottom: 8 },
  card:      { backgroundColor: T.surface, borderRadius: R.md, borderWidth: 1, borderColor: T.line, overflow: 'hidden' },
  option:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.line },
  optionLabel: { fontSize: 14, fontWeight: '600', color: T.ink },
  optionDetail:{ fontSize: 12, color: T.mid, marginTop: 2 },
  report:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.line },
  footer:    { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 32, backgroundColor: T.paper, borderTopWidth: 1, borderTopColor: T.line, gap: 10 },
  total:     { fontSize: 13, fontWeight: '600', color: T.ink, textAlign: 'center' },
  go:        { backgroundColor: T.indigo, borderRadius: R.pill, paddingVertical: 15, alignItems: 'center' },
  goText:    { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  bar:       { height: 6, borderRadius: 3, backgroundColor: T.line, overflow: 'hidden' },
  barFill:   { height: 6, backgroundColor: T.indigo },
});
