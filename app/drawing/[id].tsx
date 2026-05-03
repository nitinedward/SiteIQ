import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── MOCK DATA ──────────────────────────────────────────
// Mock drawings with their inspection zones
// Later this comes from GET /api/drawings/:id

const mockDrawings: {
  id: string;
  title: string;
  drawing_number: string;
  revision: string;
  project_id: string;
  project_name: string;
  zones: Zone[];
}[] = [
  {
    id: 'd1',
    title: 'Ground Floor Plan',
    drawing_number: 'SK-001',
    revision: 'C',
    project_id: '1',
    project_name: '23 Harbour View Towers',
    zones: [
      {
        id: 'z1',
        label: 'Column C3 — Level 1',
        zone_type: 'COLUMN',
        status: 'PENDING',
        priority: 'HIGH',
        notes: 'Check for cracking at base. Previous inspection noted minor hairline cracks.',
      },
      {
        id: 'z2',
        label: 'Beam B2 — Grid 4',
        zone_type: 'BEAM',
        status: 'COMPLETE',
        priority: 'MEDIUM',
        notes: 'Inspect soffit for spalling. Check bearing condition.',
      },
      {
        id: 'z3',
        label: 'Connection J1 — East Wall',
        zone_type: 'CONNECTION',
        status: 'FLAGGED',
        priority: 'CRITICAL',
        notes: 'URGENT: Previous inspection flagged movement in beam-column connection. Requires immediate assessment.',
      },
      {
        id: 'z4',
        label: 'Slab S1 — Bay 2',
        zone_type: 'SLAB',
        status: 'PENDING',
        priority: 'LOW',
        notes: 'Routine check of slab soffit condition.',
      },
    ],
  },
  {
    id: 'd2',
    title: 'Level 2 Structural',
    drawing_number: 'SK-002',
    revision: 'B',
    project_id: '1',
    project_name: '23 Harbour View Towers',
    zones: [
      {
        id: 'z5',
        label: 'Column D4 — Level 2',
        zone_type: 'COLUMN',
        status: 'PENDING',
        priority: 'MEDIUM',
        notes: 'Standard inspection. Check for surface defects.',
      },
      {
        id: 'z6',
        label: 'Shear Wall SW1',
        zone_type: 'WALL',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        notes: 'Inspect full height of shear wall. Note any diagonal cracking.',
      },
      {
        id: 'z7',
        label: 'Foundation Pad FP2',
        zone_type: 'FOUNDATION',
        status: 'PENDING',
        priority: 'HIGH',
        notes: 'Check settlement. Measure any differential movement.',
      },
      {
        id: 'z8',
        label: 'Beam B5 — North Face',
        zone_type: 'BEAM',
        status: 'COMPLETE',
        priority: 'LOW',
        notes: 'Previously inspected. Confirm no change.',
      },
      {
        id: 'z9',
        label: 'Column C5 — Level 2',
        zone_type: 'COLUMN',
        status: 'PENDING',
        priority: 'MEDIUM',
        notes: 'Check column plumb. Measure any deviation.',
      },
      {
        id: 'z10',
        label: 'Connection J3 — North',
        zone_type: 'CONNECTION',
        status: 'PENDING',
        priority: 'HIGH',
        notes: 'Inspect beam-column connection. Check bolts and welds.',
      },
    ],
  },
  {
    id: 'd3',
    title: 'Column Schedule',
    drawing_number: 'SK-003',
    revision: 'A',
    project_id: '1',
    project_name: '23 Harbour View Towers',
    zones: [
      {
        id: 'z11',
        label: 'Column A1 — All Levels',
        zone_type: 'COLUMN',
        status: 'PENDING',
        priority: 'MEDIUM',
        notes: 'Full height inspection of column A1.',
      },
      {
        id: 'z12',
        label: 'Column A2 — All Levels',
        zone_type: 'COLUMN',
        status: 'PENDING',
        priority: 'MEDIUM',
        notes: 'Full height inspection of column A2.',
      },
    ],
  },
  {
    id: 'd4',
    title: 'Foundation Plan',
    drawing_number: 'SK-004',
    revision: 'D',
    project_id: '2',
    project_name: 'Queens Wharf Apartments',
    zones: [
      {
        id: 'z13',
        label: 'Pad Foundation PF1',
        zone_type: 'FOUNDATION',
        status: 'PENDING',
        priority: 'HIGH',
        notes: 'Check for settlement and cracking around foundation.',
      },
      {
        id: 'z14',
        label: 'Strip Foundation SF2',
        zone_type: 'FOUNDATION',
        status: 'COMPLETE',
        priority: 'MEDIUM',
        notes: 'Previously inspected. No issues found.',
      },
      {
        id: 'z15',
        label: 'Pile Cap PC1',
        zone_type: 'FOUNDATION',
        status: 'FLAGGED',
        priority: 'CRITICAL',
        notes: 'Signs of movement detected. Requires urgent assessment.',
      },
      {
        id: 'z16',
        label: 'Ground Slab GS1',
        zone_type: 'SLAB',
        status: 'PENDING',
        priority: 'LOW',
        notes: 'Check for cracking and settlement.',
      },
      {
        id: 'z17',
        label: 'Retaining Wall RW1',
        zone_type: 'WALL',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        notes: 'Inspect for lateral movement and cracking.',
      },
    ],
  },
];

// ── STATUS CONFIG ───────────────────────────────────────

type ZoneStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'FLAGGED';
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const statusConfig = {
  PENDING: {
    colour: '#8899AA',
    bg: '#1C2E44',
    label: 'Pending',
    icon: '⏳',
  },
  IN_PROGRESS: {
    colour: '#FBBF24',
    bg: '#3B2E0D',
    label: 'In Progress',
    icon: '🔄',
  },
  COMPLETE: {
    colour: '#34D399',
    bg: '#0D3B2E',
    label: 'Complete',
    icon: '✅',
  },
  FLAGGED: {
    colour: '#F87171',
    bg: '#3B1A1A',
    label: 'Flagged',
    icon: '🚨',
  },
};

const priorityConfig = {
  LOW:      { colour: '#8899AA', label: 'Low' },
  MEDIUM:   { colour: '#FBBF24', label: 'Medium' },
  HIGH:     { colour: '#F97316', label: 'High' },
  CRITICAL: { colour: '#F87171', label: 'Critical' },
};

// ── ZONE CARD COMPONENT ─────────────────────────────────

type Zone = {
  id: string;
  label: string;
  zone_type: string;
  status: ZoneStatus;
  priority: Priority;
  notes: string;
};

function ZoneCard({
  zone,
  drawingId,
}: {
  zone: Zone;
  drawingId: string;
}) {
  const status = statusConfig[zone.status];
  const priority = priorityConfig[zone.priority];

  const handlePress = () => {
    // Navigate to capture screen passing zone and drawing IDs
    router.push({
      pathname: '/(tabs)/capture',
      params: {
        zone_id: zone.id,
        zone_label: zone.label,
        drawing_id: drawingId,
      },
    });
  };

  return (
    <TouchableOpacity
      style={[styles.zoneCard, { borderLeftColor: status.colour }]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      {/* Zone header */}
      <View style={styles.zoneHeader}>
        <Text style={styles.zoneIcon}>{status.icon}</Text>
        <Text style={styles.zoneLabel} numberOfLines={1}>
          {zone.label}
        </Text>
        <View style={[
          styles.priorityBadge,
          { backgroundColor: priorityConfig[zone.priority].colour + '20' }
        ]}>
          <Text style={[
            styles.priorityText,
            { color: priority.colour }
          ]}>
            {priority.label}
          </Text>
        </View>
      </View>

      {/* Zone type and status */}
      <View style={styles.zoneMeta}>
        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusText, { color: status.colour }]}>
            {status.label}
          </Text>
        </View>
        <Text style={styles.zoneType}>
          {zone.zone_type.charAt(0) +
            zone.zone_type.slice(1).toLowerCase()}
        </Text>
      </View>

      {/* Notes preview */}
      {zone.notes && (
        <Text style={styles.zoneNotes} numberOfLines={2}>
          {zone.notes}
        </Text>
      )}

      {/* Start inspection arrow */}
      <View style={styles.zoneFooter}>
        <Text style={styles.inspectText}>
          Tap to start inspection
        </Text>
        <Text style={styles.zoneArrow}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── SUMMARY BAR ─────────────────────────────────────────

function ZoneSummaryBar({ zones }: { zones: Zone[] }) {
  const counts = {
    PENDING: zones.filter(z => z.status === 'PENDING').length,
    IN_PROGRESS: zones.filter(z => z.status === 'IN_PROGRESS').length,
    COMPLETE: zones.filter(z => z.status === 'COMPLETE').length,
    FLAGGED: zones.filter(z => z.status === 'FLAGGED').length,
  };

  return (
    <View style={styles.summaryBar}>
      {Object.entries(counts).map(([status, count]) => {
        const config = statusConfig[status as ZoneStatus];
        if (count === 0) return null;
        return (
          <View key={status} style={styles.summaryItem}>
            <Text style={styles.summaryIcon}>{config.icon}</Text>
            <Text style={[styles.summaryCount, { color: config.colour }]}>
              {count}
            </Text>
            <Text style={styles.summaryLabel}>{config.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ── MAIN SCREEN ─────────────────────────────────────────

export default function DrawingZonesScreen() {
  const { id } = useLocalSearchParams();
  const drawing = mockDrawings.find(d => d.id === id);

  if (!drawing) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Drawing not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const flaggedZones = drawing.zones.filter(z => z.status === 'FLAGGED');
  const otherZones = drawing.zones.filter(z => z.status !== 'FLAGGED');
  const sortedZones = [...flaggedZones, ...otherZones];

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
        <View style={styles.headerInfo}>
          <Text style={styles.drawingNumber}>
            {drawing.drawing_number}
          </Text>
          <Text style={styles.revisionBadge}>Rev {drawing.revision}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
      >

        {/* Drawing title */}
        <View style={styles.titleBlock}>
          <Text style={styles.drawingTitle}>{drawing.title}</Text>
          <Text style={styles.projectName}>{drawing.project_name}</Text>
        </View>

        {/* Drawing placeholder image */}
        <View style={styles.drawingImageContainer}>
          <View style={styles.drawingImagePlaceholder}>
            <Text style={styles.drawingImageIcon}>📐</Text>
            <Text style={styles.drawingImageText}>
              {drawing.title}
            </Text>
            <Text style={styles.drawingImageSub}>
              Drawing preview will show here
            </Text>
          </View>
        </View>

        {/* Zone summary */}
        <ZoneSummaryBar zones={drawing.zones} />

        {/* Flagged zones warning */}
        {flaggedZones.length > 0 && (
          <View style={styles.flaggedWarning}>
            <Text style={styles.flaggedWarningIcon}>🚨</Text>
            <Text style={styles.flaggedWarningText}>
              {flaggedZones.length} zone
              {flaggedZones.length > 1 ? 's' : ''} flagged
              for urgent attention — shown first below
            </Text>
          </View>
        )}

        {/* Section title */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Inspection Zones ({drawing.zones.length})
          </Text>
        </View>

        {/* Zone cards */}
        <View style={styles.zoneList}>
          {sortedZones.map(zone => (
            <ZoneCard
              key={zone.id}
              zone={zone}
              drawingId={drawing.id}
            />
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
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  drawingNumber: {
    fontSize: 13,
    color: '#8899AA',
    fontWeight: '500',
  },
  revisionBadge: {
    fontSize: 11,
    color: '#2563EB',
    backgroundColor: '#1C2E44',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  scroll: {
    flex: 1,
  },
  titleBlock: {
    padding: 20,
    paddingBottom: 12,
  },
  drawingTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  projectName: {
    fontSize: 13,
    color: '#8899AA',
  },
  drawingImageContainer: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  drawingImagePlaceholder: {
    width: '100%',
    height: 160,
    backgroundColor: '#112240',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1C2E44',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  drawingImageIcon: {
    fontSize: 32,
  },
  drawingImageText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  drawingImageSub: {
    fontSize: 12,
    color: '#4A5568',
  },
  summaryBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 16,
    backgroundColor: '#112240',
    marginHorizontal: 20,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1C2E44',
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  summaryIcon: {
    fontSize: 14,
  },
  summaryCount: {
    fontSize: 15,
    fontWeight: '600',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#8899AA',
  },
  flaggedWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: '#3B1A1A',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F87171',
  },
  flaggedWarningIcon: {
    fontSize: 18,
  },
  flaggedWarningText: {
    fontSize: 13,
    color: '#F87171',
    flex: 1,
    lineHeight: 18,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8899AA',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  zoneList: {
    paddingHorizontal: 20,
    gap: 10,
  },
  zoneCard: {
    backgroundColor: '#112240',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1C2E44',
    borderLeftWidth: 4,
    gap: 8,
  },
  zoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  zoneIcon: {
    fontSize: 18,
    width: 24,
  },
  zoneLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  priorityText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  zoneMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
  },
  zoneType: {
    fontSize: 12,
    color: '#4A5568',
  },
  zoneNotes: {
    fontSize: 12,
    color: '#8899AA',
    lineHeight: 18,
  },
  zoneFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  inspectText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '500',
  },
  zoneArrow: {
    fontSize: 20,
    color: '#2563EB',
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