import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';

// ── MOCK DATA ──────────────────────────────
// This is fake data that looks like real database data.
// Later we will replace this with a real API call.

const mockProjects: Project[] = [
  {
    id: '1',
    name: '23 Harbour View Towers',
    address: 'Auckland CBD, Auckland',
    client_name: 'Harbour Developments Ltd',
    project_number: '2026-047',
    status: 'ACTIVE',
    drawing_count: 3,
    last_inspection: '28 Apr 2026',
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
  },
];

// ── TYPE DEFINITION ────────────────────────
// This tells TypeScript exactly what shape a Project object is.
// If you try to use a field that doesn't exist here, TypeScript warns you.

type Project = {
  id: string;
  name: string;
  address: string;
  client_name: string;
  project_number: string;
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
  drawing_count: number;
  last_inspection: string;
};

// ── STATUS BADGE COMPONENT ─────────────────
// A small reusable component just for the coloured status badge.
// This is your first custom component inside a screen file.

function StatusBadge({ status }: { status: Project['status'] }) {
  const colours = {
    ACTIVE:    { bg: '#0D3B2E', text: '#34D399', dot: '#34D399' },
    ON_HOLD:   { bg: '#3B2E0D', text: '#FBBF24', dot: '#FBBF24' },
    COMPLETED: { bg: '#1E3A5F', text: '#60A5FA', dot: '#60A5FA' },
  };

  const labels = {
    ACTIVE: 'Active',
    ON_HOLD: 'On Hold',
    COMPLETED: 'Completed',
  };

  const colour = colours[status];

  return (
    <View style={[styles.badge, { backgroundColor: colour.bg }]}>
      <View style={[styles.badgeDot, { backgroundColor: colour.dot }]} />
      <Text style={[styles.badgeText, { color: colour.text }]}>
        {labels[status]}
      </Text>
    </View>
  );
}

// ── PROJECT CARD COMPONENT ─────────────────
// One card for one project. Receives a project object as a prop.

function ProjectCard({ project }: { project: Project }) {
  return (
    <TouchableOpacity
  style={styles.card}
  activeOpacity={0.7}
  onPress={() => router.push(`/project/${project.id}`)}
>
      <View style={styles.cardHeader}>
        <Text style={styles.projectNumber}>{project.project_number}</Text>
        <StatusBadge status={project.status} />
      </View>

      <Text style={styles.projectName}>{project.name}</Text>
      <Text style={styles.projectAddress}>{project.address}</Text>

      <View style={styles.cardDivider} />

      <View style={styles.cardFooter}>
        <View style={styles.footerItem}>
          <Text style={styles.footerLabel}>Client</Text>
          <Text style={styles.footerValue}>{project.client_name}</Text>
        </View>
        <View style={styles.footerItem}>
          <Text style={styles.footerLabel}>Drawings</Text>
          <Text style={styles.footerValue}>{project.drawing_count}</Text>
        </View>
        <View style={styles.footerItem}>
          <Text style={styles.footerLabel}>Last Inspection</Text>
          <Text style={styles.footerValue}>{project.last_inspection}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── MAIN SCREEN ────────────────────────────

export default function ProjectsScreen() {
  const [searchText, setSearchText] = useState('');

  // Filter projects based on search text
  // .filter() goes through every item in the array
  // and keeps only the ones where the condition is true
  const filteredProjects = mockProjects.filter(project =>
    project.name.toLowerCase().includes(searchText.toLowerCase()) ||
    project.address.toLowerCase().includes(searchText.toLowerCase()) ||
    project.client_name.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerGreeting}>Good morning</Text>
          <Text style={styles.headerTitle}>Projects</Text>
        </View>
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>
            {filteredProjects.length}
          </Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search projects, clients, addresses..."
          placeholderTextColor="#4A5568"
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
        />
      </View>

      {/* Project list */}
      <FlatList
        data={filteredProjects}
        renderItem={({ item }) => <ProjectCard project={item} />}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No projects found</Text>
            <Text style={styles.emptySubtext}>
              Try a different search term
            </Text>
          </View>
        }
      />

    </View>
  );
}

// ── STYLES ─────────────────────────────────

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
    paddingBottom: 20,
  },
  headerGreeting: {
    fontSize: 13,
    color: '#8899AA',
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1C2E44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C2E44',
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#2A3F55',
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    color: '#FFFFFF',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  card: {
    backgroundColor: '#112240',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1C2E44',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  projectNumber: {
    fontSize: 11,
    color: '#8899AA',
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    gap: 4,
  },
  badgeDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  projectName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  projectAddress: {
    fontSize: 13,
    color: '#8899AA',
    marginBottom: 12,
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#1C2E44',
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerItem: {
    flex: 1,
  },
  footerLabel: {
    fontSize: 10,
    color: '#4A5568',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  footerValue: {
    fontSize: 12,
    color: '#8899AA',
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#8899AA',
  },
});