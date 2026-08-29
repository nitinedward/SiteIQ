import { Tabs } from 'expo-router'
import { FooterNav, type FooterTab } from '../../components/FooterNav'

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => {
        const activeName = state.routes[state.index].name
        const active: FooterTab | null = activeName === 'projects' ? 'projects' : activeName === 'profile' ? 'profile' : null
        return (
          <FooterNav
            active={active}
            onPress={(tab) => navigation.navigate(tab)}
          />
        )
      }}
    >
      <Tabs.Screen name="projects" options={{ title: 'Projects' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="capture" options={{ href: null }} />
    </Tabs>
  )
}