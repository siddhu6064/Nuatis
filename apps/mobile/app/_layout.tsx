import { Stack, router } from 'expo-router'
import { AuthProvider, useAuth } from '../lib/auth-context'
import { useEffect } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { colors } from '../lib/colors'

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading) return
    if (isAuthenticated) {
      router.replace('/(tabs)')
    } else {
      router.replace('/(auth)/login')
    }
  }, [isAuthenticated, isLoading])

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.blue} />
      </View>
    )
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  )
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.paper,
  },
})
