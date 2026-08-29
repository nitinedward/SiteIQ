import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { theme } from '../../lib/theme'

const T = theme.colors

export default function TabLayout() {
  const insets = useSafeAreaInsets()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: T.indigo,
        tabBarInactiveTintColor: T.mid,
        tabBarStyle: {
          backgroundColor: T.surface,
          borderTopColor: T.line,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: 0.1 + insets.bottom,
          paddingTop: 2,
        },
        tabBarIconStyle: {
          marginBottom: 6,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          textAlign: 'center',
        },
      }}
    >
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'folder' : 'folder-outline'} size={38} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={38} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="capture" options={{ href: null }} />
    </Tabs>
  )
}