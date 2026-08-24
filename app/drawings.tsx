import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { theme } from '../lib/theme';

const T = theme.colors;
const R = theme.radius;

// Mock drawings per project — legacy placeholder, not connected to real data
const projectDrawingsMap: Record<string, {
  id: string;
  title: string;
  number: string;
  revision: string;
  zones: number;
}[]> = {
  '1': [
    { id: 'd1', title: 'Ground Floor Plan', number: 'SK-001', revision: 'C', zones: 4 },
    { id: 'd2', title: 'Level 2 Structural', number: 'SK-002', revision: 'B', zones: 6 },
    { id: 'd3', title: 'Column Schedule', number: 'SK-003', revision: 'A', zones: 2 },
  ],
  '2': [
    { id: 'd4', title: 'Foundation Plan', number: 'SK-001', revision: 'D', zones: 5 },
    { id: 'd5', title: 'Shear Wall Layout', number: 'SK-002', revision: 'B', zones: 3 },
    { id: 'd6', title: 'Level 1 Plan', number: 'SK-003', revision: 'A', zones: 4 },
    { id: 'd7', title: 'Roof Structure', number: 'SK-004', revision: 'A', zones: 2 },
    { id: 'd8', title: 'Section Details', number: 'SK-005', revision: 'C', zones: 6 },
  ],
  '3': [
    { id: 'd9', title: 'Structural Overview', number: 'SK-001', revision: 'A', zones: 3 },
    { id: 'd10', title: 'Foundation Details', number: 'SK-002', revision: 'A', zones: 2 },
  ],
  '4': [
    { id: 'd11', title: 'Ground Floor', number: 'SK-001', revision: 'E', zones: 6 },
    { id: 'd12', title: 'Level 1', number: 'SK-002', revision: 'D', zones: 5 },
    { id: 'd13', title: 'Level 2', number: 'SK-003', revision: 'C', zones: 4 },
    { id: 'd14', title: 'Roof Plan', number: 'SK-004', revision: 'B', zones: 3 },
  ],
};

export default function DrawingsPickerScreen() {
  const { project_id, project_name } = useLocalSearchParams();
  const drawings = projectDrawingsMap[String(project_id)] || [];

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backArrow}>{'‹'}</Text>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Drawing</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
      >

        {/* Project name */}
        <View style={styles.projectBanner}>
          <Text style={styles.projectBannerName}>{project_name}</Text>
          <Text style={styles.projectBannerSub}>
            Select a drawing to inspect
          </Text>
        </View>

        {/* Drawings list */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Available Drawings ({drawings.length})
          </Text>

          {drawings.map(drawing => (
            <TouchableOpacity
              key={drawing.id}
              style={styles.drawingCard}
              onPress={() => router.push({
                pathname: `/drawing/${drawing.id}`,
              })}
              activeOpacity={0.7}
            >
              <View style={styles.drawingIconBox}>
                <Text style={styles.drawingIcon}>📐</Text>
              </View>
              <View style={styles.drawingInfo}>
                <Text style={styles.drawingTitle}>{drawing.title}</Text>
                <Text style={styles.drawingMeta}>
                  {drawing.number} - Rev {drawing.revision}
                </Text>
                <Text style={styles.drawingZones}>
                  {drawing.zones} inspection zones
                </Text>
              </View>
              <Text style={styles.drawingArrow}>{'›'}</Text>
            </TouchableOpacity>
          ))}

          {drawings.length === 0 && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>📐</Text>
              <Text style={styles.emptyTitle}>No drawings uploaded</Text>
              <Text style={styles.emptySub}>
                Drawings are uploaded via the desktop web app
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: T.paper },
  header:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: T.line, backgroundColor: T.surface },
  backButton:        { flexDirection: 'row', alignItems: 'center', gap: 4, width: 60 },
  backArrow:         { fontSize: 28, color: T.indigo, lineHeight: 32 },
  backText:          { fontSize: 16, color: T.indigo },
  headerTitle:       { fontSize: 18, fontWeight: '600', color: T.ink },
  scroll:            { flex: 1 },
  projectBanner:     { backgroundColor: T.indigoSoft, margin: 20, borderRadius: R.md, padding: 16, borderWidth: 1, borderColor: T.line, borderLeftWidth: 4, borderLeftColor: T.marigold },
  projectBannerName: { fontSize: 16, fontWeight: '700', color: T.ink, marginBottom: 4 },
  projectBannerSub:  { fontSize: 13, color: T.mid },
  section:           { paddingHorizontal: 20, paddingBottom: 16 },
  sectionTitle:      { fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  drawingCard:       { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: R.md, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: T.line, gap: 12, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  drawingIconBox:    { width: 44, height: 44, borderRadius: R.sm, backgroundColor: T.indigoSoft, alignItems: 'center', justifyContent: 'center' },
  drawingIcon:       { fontSize: 20 },
  drawingInfo:       { flex: 1, gap: 2 },
  drawingTitle:      { fontSize: 14, fontWeight: '600', color: T.ink },
  drawingMeta:       { fontSize: 12, color: T.mid },
  drawingZones:      { fontSize: 12, color: T.indigo, marginTop: 2, fontWeight: '500' },
  drawingArrow:      { fontSize: 22, color: T.mid },
  emptyCard:         { backgroundColor: T.surface, borderRadius: R.md, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: T.line, borderStyle: 'dashed', gap: 8, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 1 },
  emptyIcon:         { fontSize: 36 },
  emptyTitle:        { fontSize: 16, fontWeight: '600', color: T.ink },
  emptySub:          { fontSize: 13, color: T.mid, textAlign: 'center', lineHeight: 18 },
});
