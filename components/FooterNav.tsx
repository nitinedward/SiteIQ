import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../lib/theme';

const T = theme.colors;

export type FooterTab = 'projects' | 'profile';

// Single shared bottom nav rendered both as the real (tabs) tab bar
// (via the `tabBar` prop in app/(tabs)/_layout.tsx) and as a plain
// footer on screens outside the tab navigator (e.g. Project Detail),
// so the two can never visually drift apart again.
export function FooterNav({ active, onPress }: { active: FooterTab | null; onPress: (tab: FooterTab) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[S.footer, { paddingBottom: 0 + insets.bottom }]}>
      <TouchableOpacity style={S.tab} onPress={() => onPress('projects')} activeOpacity={0.7}>
        <Ionicons name="briefcase-outline" size={28} color={active === 'projects' ? T.indigo : T.mid} />
        <Text style={[S.label, { color: active === 'projects' ? T.indigo : T.mid }]}>Projects</Text>
      </TouchableOpacity>
      <TouchableOpacity style={S.tab} onPress={() => onPress('profile')} activeOpacity={0.7}>
        <Ionicons name="person-outline" size={26} color={active === 'profile' ? T.indigo : T.mid} style={{ marginLeft: -3 }} />
        <Text style={[S.label, { color: active === 'profile' ? T.indigo : T.mid }]}>Profile</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  footer: { flexDirection: 'row', backgroundColor: T.surface, borderTopWidth: 1, borderTopColor: T.line, paddingTop: 2 },
  tab:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  label:  { fontSize: 10, fontWeight: '700', textAlign: 'center' },
});
