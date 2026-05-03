import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';

// ── MOCK DATA ───────────────────────────────────────────

const mockProjects = [
  {
    id: '1',
    name: '23 Harbour View Towers',
    address: 'Auckland CBD, Auckland',
    client_name: 'Harbour Developments Ltd',
    project_number: '2026-047',
    status: 'ACTIVE',
    description: 'Structural inspection of 24-storey residential tower. Focus on column-beam connections and slab integrity on levels 1-8.',
    last_inspection: '28 Apr 2026',
    engineer: 'Sarah Chen CPEng',
    drawings: [
      { id: 'd1', title: 'Ground Floor Plan', revision: 'C', zones: 4 },
      { id: 'd2', title: 'Level 2 Structural', revision: 'B', zones: 6 },
      { id: 'd3', title: 'Column Schedule', revision: 'A', zones: 2 },
    ],
    past_inspections: [
      {
        id: 'i1',
        date: '28 Apr 2026',
        engineer: 'Sarah Chen',
        observations: 3,
        status: 'REPORT_ISSUED',
      },
      {
        id: 'i2',
        date: '15 Mar 2026',
        engineer: 'Sarah Chen',
        observations: 2,
        status: 'REPORT_ISSUED',
      },
      {
        id: 'i3',
        date: '10 Feb 2026',
        engineer: 'James Wilson',
        observations: 5,
        status: 'REPORT_ISSUED',
      },
    ],
  },
  {
    id: '2',
    name: 'Queens Wharf Apartments',
    address: 'Wellington Waterfront, Wellington',
    client_name: 'QW Holdings Ltd',
    project_number: '2026-031',
    status: 'ACTIVE',
    description: 'Post-earthquake assessment of waterfront apartment complex. Checking foundation integrity and shear wall performance.',
    last_inspection: '22 Apr 2026',
    engineer: 'James Wilson CPEng',
    drawings: [
      { id: 'd4', title: 'Foundation Plan', revision: 'D', zones: 5 },
      { id: 'd5', title: 'Shear Wall Layout', revision: 'B', zones: 3 },
      { id: 'd6', title: 'Level 1 Plan', revision: 'A', zones: 4 },
      { id: 'd7', title: 'Roof Structure', revision: 'A', zones: 2 },
      { id: 'd8', title: 'Section Details', revision: 'C', zones: 6 },
    ],
    past_inspections: [
      {
        id: 'i4',
        date: '22 Apr 2026',
        engineer: 'James Wilson',
        observations: 4,
        status: 'REPORT_ISSUED',
      },
    ],
  },
  {
    id: '3',
    name: 'Christchurch Office Tower',
    address: 'Cathedral Square, Christchurch',
    client_name: 'South Island Developments',
    project_number: '2026-019',
    status: 'ON_HOLD',
    description: 'New construction monitoring. Currently on hold pending resource consent approval.',
    last_inspection: '10 Mar 2026',
    engineer: 'Sarah Chen CPEng',
    drawings: [
      { id: 'd9', title: 'Structural Overview', revision: 'A', zones: 3 },
      { id: 'd10', title: 'Foundation Details', revision: 'A', zones: 2 },
    ],
    past_inspections: [],
  },
  {
    id: '4',
    name: 'Takapuna Beach Resort',
    address: 'Takapuna, Auckland',
    client_name: 'North Shore Hospitality',
    project_number: '2025-098',
    status: 'COMPLETED',
    description: 'Final completion inspection of beachfront resort development.',
    last_inspection: '15 Jan 2026',
    engineer: 'Sarah Chen CPEng',
    drawings: [
      { id: 'd11', title: 'Ground Floor', revision: 'E', zones: 6 },
      { id: 'd12', title: 'Level 1', revision: 'D', zones: 5 },
      { id: 'd13', title: 'Level 2', revision: 'C', zones: 4 },
      { id: 'd14', title: 'Roof Plan', revision: 'B', zones: 3 },
    ],
    past_inspections: [
      {
        id: 'i5',
        date: '15 Jan 2026',
        engineer: 'Sarah Chen',
        observations: 8,
        status: 'REPORT_ISSUED',
      },
      {
        id: 'i6',
        date: '20 Dec 2025',
        engineer: 'Sarah Chen',
        observations: 6,
        status: 'REPORT_ISSUED',
      },
    ],
  },
];

// ── STATUS CONFIG ───────────────────────────────────────

const statusConfig = {
  ACTIVE:    { colour: '#34D399', bg: '#0D3B2E', label: 'Active' },
  ON_HOLD:   { colour: '#FBBF24', bg: '#3B2E0D', label: 'On Hold' },
  COMPLETED: { colour: '#60A5FA', bg: '#1E3A5F', label: 'Completed' },
};

const inspectionStatusConfig = {
  REPORT_ISSUED: { colour: '#34D399', label: 'Report Issued' },
  IN_PROGRESS:   { colour: '#FBBF24', label: 'In Progress' },
  DRAFT:         { colour: '#8899AA', label: 'Draft' },
};

// ── MAIN SCREEN ─────────────────────────────────────────

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

  const status = statusConfig[project.status as keyof typeof statusConfig];
  const totalZones = project.drawings.reduce((sum, d) => sum + d.zones, 0);

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Projects</Text>
        </TouchableOpacity>
        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusText, { color: status.colour }]}>
            {status.label}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
      >

        {/* Project title */}
        <View style={styles.titleBlock}>
          <Text style={styles.projectNumber}>{project.project_number}</Text>
          <Text style={styles.projectName}>{project.name}</Text>
          <Text style={styles.projectAddress}>{project.address}</Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{project.drawings.length}</Text>
            <Text style={styles.statLabel}>Drawings</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{totalZones}</Text>
            <Text style={styles.statLabel}>Zones</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {project.past_inspections.length}
            </Text>
            <Text style={styles.statLabel}>Inspections</Text>
          </View>
        </View>

        {/* Client + engineer info */}
        <View style={styles.infoGrid}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Client</Text>
            <Text style={styles.infoValue}>{project.client_name}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Engineer</Text>
            <Text style={styles.infoValue}>{project.engineer}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Last Inspection</Text>
            <Text style={styles.infoValue}>{project.last_inspection}</Text>
          </View>
        </View>

        {/* Project scope */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Project Scope</Text>
          <Text style={styles.scopeText}>{project.description}</Text>
        </View>

        {/* START INSPECTION — the main action */}
        {project.status !== 'COMPLETED' && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.startButton}
              onPress={() => router.push({
                pathname: '/session',
                params: { project_id: project.id, project_name: project.name },
              })}
              activeOpacity={0.8}
            >
              <Text style={styles.startButtonIcon}>🔍</Text>
              <View style={styles.startButtonText}>
                <Text style={styles.startButtonTitle}>
                  Start Today's Inspection
                </Text>
                <Text style={styles.startButtonSub}>
                  Capture observations, photos and measurements
                </Text>
              </View>
              <Text style={styles.startButtonArrow}>›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Past inspections */}
        {project.past_inspections.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Past Inspections ({project.past_inspections.length})
            </Text>
            {project.past_inspections.map(inspection => {
              const iStatus = inspectionStatusConfig[
                inspection.status as keyof typeof inspectionStatusConfig
              ];
              return (
                <TouchableOpacity
                  key={inspection.id}
                  style={styles.inspectionRow}
                  activeOpacity={0.7}
                >
                  <View style={styles.inspectionLeft}>
                    <Text style={styles.inspectionDate}>
                      {inspection.date}
                    </Text>
                    <Text style={styles.inspectionMeta}>
                      {inspection.engineer} · {inspection.observations} observations
                    </Text>
                  </View>
                  <View style={styles.inspectionRight}>
                    <Text style={[
                      styles.inspectionStatus,
                      { color: iStatus.colour }
                    ]}>
                      {iStatus.label}
                    </Text>
                    <Text style={styles.inspectionArrow}>›</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Drawings — reference only */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Drawings ({project.drawings.length})
          </Text>
          <Text style={styles.drawingsHint}>
            Tap a drawing to view its inspection zones
          </Text>
          {project.drawings.map(drawing => (
            <TouchableOpacity
              key={drawing.id}
              style={styles.drawingRow}
              onPress={() => router.push(`/drawing/${drawing.id}`)}
              activeOpacity={0.7}
            >
              <Text style={styles.drawingIcon}>📐</Text>
              <View style={styles.drawingInfo}>
                <Text style={styles.drawingTitle}>{drawing.title}</Text>
                <Text style={styles.drawingMeta}>
                  Rev {drawing.revision} · {drawing.zones} zones
                </Text>
              </View>
              <Text style={styles.drawingArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── STYLES ──────────────────────────────────────────────

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
    paddingBottom: 12,
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
    marginBottom: 4,
    lineHeight: 30,
  },
  projectAddress: {
    fontSize: 14,
    color: '#8899AA',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#112240',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1C2E44',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: '#8899AA',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoGrid: {
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 4,
  },
  infoCard: {
    backgroundColor: '#112240',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1C2E44',
  },
  infoLabel: {
    fontSize: 10,
    color: '#4A5568',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  infoValue: {
    fontSize: 14,
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
  scopeText: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 22,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 14,
    padding: 18,
    gap: 14,
  },
  startButtonIcon: {
    fontSize: 28,
  },
  startButtonText: {
    flex: 1,
  },
  startButtonTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 3,
  },
  startButtonSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 16,
  },
  startButtonArrow: {
    fontSize: 24,
    color: 'rgba(255,255,255,0.7)',
  },
  inspectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#112240',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1C2E44',
  },
  inspectionLeft: {
    flex: 1,
  },
  inspectionDate: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 3,
  },
  inspectionMeta: {
    fontSize: 12,
    color: '#8899AA',
  },
  inspectionRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  inspectionStatus: {
    fontSize: 11,
    fontWeight: '500',
  },
  inspectionArrow: {
    fontSize: 18,
    color: '#4A5568',
  },
  drawingsHint: {
    fontSize: 12,
    color: '#4A5568',
    marginBottom: 10,
    fontStyle: 'italic',
  },
  drawingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#112240',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1C2E44',
    gap: 12,
  },
  drawingIcon: {
    fontSize: 20,
  },
  drawingInfo: {
    flex: 1,
  },
  drawingTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
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