import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#8899AA',
        tabBarStyle: {
          backgroundColor: '#0A1628',
          borderTopColor: '#1C2E44',
          borderTopWidth: 1,
          height: 60,
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen name="projects" options={{ title: 'Projects' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen
        name="capture"
        options={{ href: null }}
      />
    </Tabs>
  );
}