import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import Pdf from 'react-native-pdf';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../lib/theme';
import { reportForViewing, savedReport, removeSavedReport } from '../../lib/reports';

const T = theme.colors;

/**
 * A finalised site report, as issued: the PDF the office finalised
 * (lib/reports). Opened from the phone's copy when there is one — so with
 * no signal too — otherwise downloaded and kept.
 */
export default function ReportPdfScreen() {
  const { id, title, subtitle } = useLocalSearchParams<{ id: string; title?: string; subtitle?: string }>();
  const [path, setPath]       = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [page, setPage]       = useState({ at: 1, of: 0 });
  const [kept, setKept]       = useState(true);

  useEffect(() => {
    reportForViewing(String(id))
      .then(p => {
        if (p) setPath(p);
        else setProblem('This report was finalised before reports were saved as PDFs. Open it on the web.');
      })
      .catch(err => setProblem(err?.message ?? 'Could not open the report.'));
  }, [id]);

  const forget = () => Alert.alert('Remove from this phone?', 'The report stays on the web; it downloads again next time you open it.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { await removeSavedReport(String(id)); setKept(false); router.back(); } },
  ]);

  useEffect(() => { savedReport(String(id)).then(s => setKept(!!s)).catch(() => {}); }, [path]);

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={T.indigo} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.title} numberOfLines={1}>{title || 'Site report'}</Text>
          <Text style={S.sub} numberOfLines={1}>
            {subtitle ? `${subtitle}` : ''}{page.of ? `${subtitle ? ' · ' : ''}Page ${page.at} of ${page.of}` : ''}
          </Text>
        </View>
        {!!path && kept && (
          <TouchableOpacity style={S.iconBtn} onPress={forget} accessibilityLabel="Remove from this phone">
            <Ionicons name="trash-outline" size={20} color={T.mid} />
          </TouchableOpacity>
        )}
      </View>

      {problem ? (
        <View style={S.centred}>
          <Ionicons name="document-text-outline" size={36} color={T.mid} />
          <Text style={S.problem}>{problem}</Text>
        </View>
      ) : !path ? (
        <View style={S.centred}>
          <ActivityIndicator size="large" color={T.indigo} />
          <Text style={S.loading}>Getting the report…</Text>
        </View>
      ) : (
        <Pdf
          source={{ uri: path }}
          style={S.pdf}
          trustAllCerts={false}
          enableDoubleTapZoom
          onLoadComplete={(pages) => setPage(p => ({ ...p, of: pages }))}
          onPageChanged={(at, of) => setPage({ at, of })}
          onError={(err) => setProblem(`Could not show the report: ${String((err as any)?.message ?? err)}`)}
          // The marked-up drawings link to their photos on the web.
          onPressLink={(url) => { Linking.openURL(url).catch(() => {}); }}
        />
      )}
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.paper },
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12, backgroundColor: T.paper, borderBottomWidth: 1, borderBottomColor: T.line },
  backBtn:   { width: 44, height: 44, borderRadius: 22, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, alignItems: 'center', justifyContent: 'center' },
  iconBtn:   { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title:     { fontSize: 18, fontWeight: '800', color: T.indigo },
  sub:       { fontSize: 12, color: T.mid, marginTop: 1 },
  pdf:       { flex: 1, backgroundColor: '#E8E6E1' },
  centred:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  problem:   { fontSize: 14, color: T.ink, textAlign: 'center', lineHeight: 20 },
  loading:   { fontSize: 13, color: T.mid },
});
