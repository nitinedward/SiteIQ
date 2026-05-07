import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useState, useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';

// ── TYPE DEFINITION ────────────────────────
// Tells TypeScript exactly what a Project object looks like

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
// Small coloured badge showing project status — unchanged

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
// Now accepts onDelete as a prop so the card knows what to do on long press

function ProjectCard({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: (project: Project) => void; // a function that receives the project
}) {
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => router.push(`/project/${project.id}`)}
      // onLongPress fires when the engineer holds their finger on the card
      // It calls onDelete and passes the project so we know which one to delete
      onLongPress={() => onDelete(project)}
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
          <Text style={styles.footerValue}>{project.last_inspection ?? '—'}</Text>
        </View>
      </View>

      {/* Small hint so engineers know they can long press */}
      <Text style={styles.longPressHint}>Hold to delete</Text>
    </TouchableOpacity>
  );
}

// ── MAIN SCREEN ────────────────────────────

export default function ProjectsScreen() {
  const [searchText, setSearchText]   = useState('');
  const [projects, setProjects]       = useState<Project[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [errorMsg, setErrorMsg]       = useState('');

  // ── FETCH PROJECTS FROM SUPABASE ──────────
  // Reads all projects from the database, newest first
  const fetchProjects = async () => {
    setIsLoading(true);
    setErrorMsg('');

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setErrorMsg('Could not load projects. Please try again.');
      console.error('Supabase error:', error);
    } else {
      setProjects(data as Project[]);
    }

    setIsLoading(false);
  };

  // ── DELETE A PROJECT ──────────────────────
  // Called when engineer long presses a card
  // Shows a confirmation popup before actually deleting
  const handleDelete = (project: Project) => {
    Alert.alert(
      'Delete Project',
      `Are you sure you want to delete "${project.name}"? This cannot be undone.`,
      [
        // Cancel button — does nothing
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive', // makes this button red on iOS
          onPress: async () => {
            // Tell Supabase to delete the row where id matches this project
            // .eq('id', project.id) means "where id equals project.id"
            const { error } = await supabase
              .from('projects')
              .delete()
              .eq('id', project.id);

            if (error) {
              Alert.alert('Error', 'Could not delete project. Please try again.');
              return;
            }

            // Remove it from the local list immediately
            // This means the screen updates instantly without needing to refetch
            // .filter() keeps every project EXCEPT the deleted one
            setProjects(current => current.filter(p => p.id !== project.id));
          },
        },
      ]
    );
  };

  // ── useFocusEffect ────────────────────────
  // Runs fetchProjects every time this screen comes into focus
  // This means when an engineer creates a project and comes back,
  // the new project appears automatically in the list
  // useCallback stops it from running in an infinite loop
  useFocusEffect(
    useCallback(() => {
      fetchProjects();
    }, [])
  );

  // Filter projects based on search text
  const filteredProjects = projects.filter(project =>
    project.name.toLowerCase().includes(searchText.toLowerCase()) ||
    project.address?.toLowerCase().includes(searchText.toLowerCase()) ||
    project.client_name?.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerGreeting}>Good morning</Text>
          <Text style={styles.headerTitle}>Projects</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>
              {filteredProjects.length}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push('/project/create')}
          >
            <Text style={styles.addButtonText}>+ New</Text>
          </TouchableOpacity>
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

      {/* Loading spinner */}
      {isLoading && (
        <View style={styles.centeredMessage}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.loadingText}>Loading projects...</Text>
        </View>
      )}

      {/* Error message */}
      {!isLoading && errorMsg !== '' && (
        <View style={styles.centeredMessage}>
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity onPress={fetchProjects} style={styles.retryButton}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Project list */}
      {!isLoading && errorMsg === '' && (
        <FlatList
          data={filteredProjects}
          renderItem={({ item }) => (
            <ProjectCard
              project={item}
              onDelete={handleDelete}
            />
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No projects yet</Text>
              <Text style={styles.emptySubtext}>
                Tap + New to create your first project
              </Text>
            </View>
          }
        />
      )}

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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  addButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
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
  centeredMessage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#8899AA',
    fontSize: 14,
  },
  errorText: {
    color: '#F87171',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  retryButton: {
    backgroundColor: '#1C2E44',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '500',
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
  longPressHint: {
    fontSize: 10,
    color: '#2A3F55',
    textAlign: 'right',
    marginTop: 8,
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
