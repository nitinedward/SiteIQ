import { Tabs } from 'expo-router'
import { View, Text } from 'react-native'
import { theme } from '../../lib/theme'

const T = theme.colors

export default function TabLayout() {
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
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 14, fontWeight: '700' }}>Proj</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 14, fontWeight: '700' }}>Me</Text>
          ),
        }}
      />
      <Tabs.Screen name="capture" options={{ href: null }} />
    </Tabs>
  )
}