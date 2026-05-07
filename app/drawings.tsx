import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

// Mock drawings per project
// Later: GET /api/projects/:id/drawings
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
          <Text style={styles.backArrow}>←</Text>
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
                  {drawing.number} · Rev {drawing.revision}
                </Text>
                <Text style={styles.drawingZones}>
                  {drawing.zones} inspection zones
                </Text>
              </View>
              <Text style={styles.drawingArrow}>›</Text>
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
  container: {
    flex: 1,
    backgroundColor: '#0A1628',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1C2E44',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 60,
  },
  backArrow: {
    fontSize: 20,
    color: '#2563EB',
  },
  backText: {
    fontSize: 16,
    color: '#2563EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  scroll: {
    flex: 1,
  },
  projectBanner: {
    backgroundColor: '#112240',
    margin: 20,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1C2E44',
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB',
  },
  projectBannerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  projectBannerSub: {
    fontSize: 13,
    color: '#8899AA',
  },
  section: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8899AA',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  drawingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#112240',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1C2E44',
    gap: 12,
  },
  drawingIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#1C2E44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawingIcon: {
    fontSize: 22,
  },
  drawingInfo: {
    flex: 1,
    gap: 2,
  },
  drawingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  drawingMeta: {
    fontSize: 12,
    color: '#8899AA',
  },
  drawingZones: {
    fontSize: 11,
    color: '#2563EB',
    marginTop: 2,
  },
  drawingArrow: {
    fontSize: 20,
    color: '#4A5568',
  },
  emptyCard: {
    backgroundColor: '#112240',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1C2E44',
    borderStyle: 'dashed',
    gap: 8,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptySub: {
    fontSize: 13,
    color: '#4A5568',
    textAlign: 'center',
    lineHeight: 18,
  },
});