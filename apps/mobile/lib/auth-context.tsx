import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import * as SecureStore from 'expo-secure-store'
import { apiPost, setStoredToken, clearStoredToken, getStoredToken, setOn401 } from './api'

interface User {
  id: string
  name: string
  email: string
  tenantId: string
  role: string
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

const USER_KEY = 'nuatis_user'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const logout = useCallback(async () => {
    await clearStoredToken()
    await SecureStore.deleteItemAsync(USER_KEY)
    setUser(null)
  }, [])

  useEffect(() => {
    setOn401(() => {
      logout()
    })
    ;(async () => {
      try {
        const token = await getStoredToken()
        const userJson = await SecureStore.getItemAsync(USER_KEY)
        if (token && userJson) {
          setUser(JSON.parse(userJson) as User)
        }
      } catch (e) {
        console.error('[auth] Restore failed:', e)
      } finally {
        setIsLoading(false)
      }
    })()
  }, [logout])

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiPost<{ token: string; user: User }>('/api/auth/mobile/login', {
      email,
      password,
    })
    await setStoredToken(res.token)
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(res.user))
    setUser(res.user)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
