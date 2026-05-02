import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';

const mockProjects = [
  {
    id: '1',
    name: '23 Harbour View Towers',
    address: 'Auckland CBD, Auckland',
    client_name: 'Harbour Developments Ltd',
    project_number: '2026-047',
    status: 'ACTIVE',
    drawing_count: 3,
    last_inspection: '28 Apr 2026',
    description: 'Structural inspection of 24-storey residential tower. Focus on column-beam connections and slab integrity on levels 1-8.',
    drawings: [
      { id: 'd1', title: 'Ground Floor Plan', revision: 'C', zones: 4 },
      { id: 'd2', title: 'Level 2 Structural', revision: 'B', zones: 6 },
      { id: 'd3', title: 'Column Schedule', revision: 'A', zones: 2 },
    ],
  },
  {
    id: '2',
    name: 'Queens Wharf Apartments',
    address: 'Wellington Waterfront, Wellington',
    client_name: 'QW Holdings Ltd',
    project_number: '2026-031',
    status: 'ACTIVE',
    drawing_count: 5,
    last_inspection: '22 Apr 2026',
    description: 'Post-earthquake assessment of waterfront apartment complex. Checking foundation integrity and shear wall performance.',
    drawings: [
      { id: 'd4', title: 'Foundation Plan', revision: 'D', zones: 5 },
      { id: 'd5', title: 'Shear Wall Layout', revision: 'B', zones: 3 },
      { id: 'd6', title: 'Level 1 Plan', revision: 'A', zones: 4 },
      { id: 'd7', title: 'Roof Structure', revision: 'A', zones: 2 },
      { id: 'd8', title: 'Section Details', revision: 'C', zones: 6 },
    ],
  },
  {
    id: '3',
    name: 'Christchurch Office Tower',
    address: 'Cathedral Square, Christchurch',
    client_name: 'South Island Developments',
    project_number: '2026-019',
    status: 'ON_HOLD',
    drawing_count: 2,
    last_inspection: '10 Mar 2026',
    description: 'New construction monitoring. Currently on hold pending resource consent approval from Christchurch City Council.',
    drawings: [
      { id: 'd9', title: 'Structural Overview', revision: 'A', zones: 3 },
      { id: 'd10', title: 'Foundation Details', revision: 'A', zones: 2 },
    ],
  },
  {
    id: '4',
    name: 'Takapuna Beach Resort',
    address: 'Takapuna, Auckland',
    client_name: 'North Shore Hospitality',
    project_number: '2025-098',
    status: 'COMPLETED',
    drawing_count: 8,
    last_inspection: '15 Jan 2026',
    description: 'Final completion inspection of beachfront resort development. All structural elements signed off.',
    drawings: [
      { id: 'd11', title: 'Ground Floor', revision: 'E', zones: 6 },
      { id: 'd12', title: 'Level 1', revision: 'D', zones: 5 },
      { id: 'd13', title: 'Level 2', revision: 'C', zones: 4 },
      { id: 'd14', title: 'Roof Plan', revision: 'B', zones: 3 },
    ],
  },
];

const statusColours = {
  ACTIVE:    { bg: '#0D3B2E', text: '#34D399' },
  ON_HOLD:   { bg: '#3B2E0D', text: '#FBBF24' },
  COMPLETED: { bg: '#1E3A5F', text: '#60A5FA' },
};

const statusLabels = {
  ACTIVE: 'Active',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
};

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams();
  const project = mockProjects.find(p => p.id === id);

  if (!project) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Project not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const colours = statusColours[project.status as keyof typeof statusColours];
  const label = statusLabels[project.status as keyof typeof statusLabels];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Projects</Text>
        </TouchableOpacity>
        <View style={[styles.statusBadge, { backgroundColor: colours.bg }]}>
          <Text style={[styles.statusText, { color: colours.text }]}>
            {label}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.titleBlock}>
          <Text style={styles.projectNumber}>{project.project_number}</Text>
          <Text style={styles.projectName}>{project.name}</Text>
          <Text style={styles.projectAddress}>{project.address}</Text>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Client</Text>
            <Text style={styles.infoValue}>{project.client_name}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Last Inspection</Text>
            <Text style={styles.infoValue}>{project.last_inspection}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Project Scope</Text>
          <Text style={styles.description}>{project.description}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Drawings ({project.drawings.length})
          </Text>
          {project.drawings.map(drawing => (
            <TouchableOpacity
              key={drawing.id}
              style={styles.drawingCard}
              activeOpacity={0.7}
            >
              <View style={styles.drawingLeft}>
                <Text style={styles.drawingIcon}>📐</Text>
                <View>
                  <Text style={styles.drawingTitle}>{drawing.title}</Text>
                  <Text style={styles.drawingMeta}>
                    Rev {drawing.revision} · {drawing.zones} inspection zones
                  </Text>
                </View>
              </View>
              <Text style={styles.drawingArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.inspectButton}>
          <Text style={styles.inspectButtonText}>Start New Inspection</Text>
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
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
    justifyContent: 'space-between',
    alignItems: 'center',
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
  },
  backArrow: {
    fontSize: 20,
    color: '#2563EB',
  },
  backText: {
    fontSize: 16,
    color: '#2563EB',
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  scroll: {
    flex: 1,
  },
  titleBlock: {
    padding: 20,
    paddingBottom: 16,
  },
  projectNumber: {
    fontSize: 12,
    color: '#8899AA',
    letterSpacing: 1,
    marginBottom: 6,
  },
  projectName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 6,
    lineHeight: 30,
  },
  projectAddress: {
    fontSize: 14,
    color: '#8899AA',
  },
  infoRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 8,
  },
  infoCard: {
    flex: 1,
    backgroundColor: '#112240',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1C2E44',
  },
  infoLabel: {
    fontSize: 10,
    color: '#4A5568',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  section: {
    padding: 20,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8899AA',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 22,
  },
  drawingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#112240',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1C2E44',
  },
  drawingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  drawingIcon: {
    fontSize: 20,
  },
  drawingTitle: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
    marginBottom: 2,
  },
  drawingMeta: {
    fontSize: 12,
    color: '#8899AA',
  },
  drawingArrow: {
    fontSize: 20,
    color: '#4A5568',
  },
  inspectButton: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    padding: 16,
    margin: 20,
    alignItems: 'center',
  },
  inspectButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  bottomPadding: {
    height: 40,
  },
  errorText: {
    fontSize: 18,
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 100,
    marginBottom: 20,
  },
  backLink: {
    fontSize: 16,
    color: '#2563EB',
    textAlign: 'center',
  },
});