import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { apiPost } from './api'

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync()
    let status = existing
    if (status !== 'granted') {
      const { status: newStatus } = await Notifications.requestPermissionsAsync()
      status = newStatus
    }
    if (status !== 'granted') return null

    const tokenData = await Notifications.getExpoPushTokenAsync()
    const token = tokenData.data

    await apiPost('/api/push/mobile/register', {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      deviceName: Platform.OS,
    })

    return token
  } catch (err) {
    console.error('[push] Register failed:', err)
    return null
  }
}
