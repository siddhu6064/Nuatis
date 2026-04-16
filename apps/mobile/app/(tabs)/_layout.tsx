import { Tabs } from 'expo-router'
import { useEffect } from 'react'
import { registerForPushNotifications } from '../../lib/push'
import { colors } from '../../lib/colors'

export default function TabLayout() {
  useEffect(() => {
    registerForPushNotifications()
  }, [])

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: colors.ink4,
        headerShown: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarLabel: 'Home' }} />
      <Tabs.Screen name="contacts" options={{ title: 'Contacts', tabBarLabel: 'Contacts' }} />
      <Tabs.Screen
        name="appointments"
        options={{ title: 'Appointments', tabBarLabel: 'Calendar' }}
      />
      <Tabs.Screen name="pipeline" options={{ title: 'Pipeline', tabBarLabel: 'Pipeline' }} />
      <Tabs.Screen
        name="notifications"
        options={{ title: 'Notifications', tabBarLabel: 'Alerts' }}
      />
    </Tabs>
  )
}
