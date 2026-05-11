'use client'

import { createContext, useContext, useState, useCallback } from 'react'
import type { Locale } from './types'

// Inline messages — no external library needed
const messages = {
  en: {
    auth: {
      welcomeBack: 'Welcome Back',
      signInSubtitle: 'Sign in to your Family Planner account',
      email: 'Email Address',
      password: 'Password',
      forgotPassword: 'Forgot your password?',
      signIn: 'Sign In',
      signingIn: 'Signing in...',
      noAccount: "Don't have an account?",
      signUp: 'Sign up',
      createAccount: 'Create Your Account',
      createAccountSubtitle: 'Start organizing your family life with Family Planner',
      fullName: 'Full Name',
      confirmPassword: 'Confirm Password',
      passwordHint: 'Must be at least 8 characters long',
      agreeToTerms: 'I agree to the',
      termsOfService: 'Terms of Service',
      and: 'and',
      privacyPolicy: 'Privacy Policy',
      createAccountBtn: 'Create Account',
      creatingAccount: 'Creating account...',
      alreadyHaveAccount: 'Already have an account?',
      signInLink: 'Sign in',
      bySigningIn: 'By signing in, you agree to our Terms and Privacy Policy',
      freeTrial: '14-day free trial',
      noCreditCard: 'No credit card required',
      forgotPasswordTitle: 'Forgot Password',
      forgotPasswordSubtitle: 'Enter your email to receive a reset link',
      sendResetLink: 'Send Reset Link',
      sendingResetLink: 'Sending...',
      backToSignIn: 'Back to Sign In',
      resetPasswordTitle: 'Reset Password',
      setNewPassword: 'Set your new password below',
      resetPasswordBtn: 'Reset Password',
      resetting: 'Resetting...',
      unexpectedError: 'An unexpected error occurred',
      loginFailed: 'Login failed',
      registrationFailed: 'Registration failed',
      passwordMismatch: 'Passwords do not match',
      passwordTooShort: 'Password must be at least 8 characters long',
    },
    landing: {
      heroTitle: 'Family Planner',
      heroSubtitle: 'Keep your family organized and connected',
      getStarted: 'Get Started',
      learnMore: 'Learn More',
    },
    join: {
      title: 'Join Family',
      enterCode: "Enter your family invite code",
      code: 'Family Code',
      join: 'Join Family',
      joining: 'Joining...',
      invalidCode: 'Invalid family code',
      backToLogin: 'Back to Login',
    },
    common: {
      save: 'Save',
      saving: 'Saving...',
      cancel: 'Cancel',
      delete: 'Delete',
      edit: 'Edit',
      create: 'Create',
      back: 'Back',
      backToDashboard: 'Back to Dashboard',
      loading: 'Loading...',
      error: 'An error occurred',
      success: 'Success',
      confirm: 'Confirm',
      yes: 'Yes',
      no: 'No',
    },
    nav: {
      dashboard: 'Dashboard',
      settings: 'Settings',
      signOut: 'Sign out',
      chores: 'Chores',
      rewards: 'Rewards',
      analytics: 'Analytics',
      lists: 'Lists',
      calendar: 'Calendar',
      messages: 'Messages',
      family: 'Family',
    },
    dashboard: {
      welcomeBack: 'Welcome back, {name}!',
      whatsHappening: "Here's what's happening with your family today.",
      getStarted: 'Get started by creating or joining a family.',
      noFamilyYet: 'No Family Yet',
      noFamilyDesc: 'Create a new family or join an existing one to start using Family Planner.',
      createFamily: 'Create Family',
      joinFamily: 'Join Family',
      completionRate: 'Completion Rate',
      yourPoints: 'Your Points',
      pendingChores: 'Pending Chores',
      upcomingEvents: 'Upcoming Events',
      progressToNext: 'Progress to next reward',
      viewRewards: 'View rewards',
      claimReward: 'Claim reward!',
      viewAllChores: 'View all chores',
      viewCalendar: 'View calendar',
      recentChores: 'Recent Chores',
      viewAll: 'View all',
      noChoresAssigned: 'No chores assigned yet',
      createFirstChore: 'Create your first chore',
      due: 'Due',
      upcomingEventsTitle: 'Upcoming Events',
      noUpcomingEvents: 'No upcoming events',
      addEvent: 'Add an event',
      familyActivity: 'Family Activity',
      trackProgress: "Track Your Family's Progress",
      seeDetailedAnalytics: 'See detailed analytics, trends, and achievements',
      viewAnalytics: 'View Analytics',
      weeklyTrends: 'Weekly Trends',
      weeklyTrendsDesc: 'See chore completion and family activity over time',
      topPerformers: 'Family Members',
      topPerformersDesc: 'See who is most active in your family',
      achievementTracking: 'Engagement Stats',
      achievementTrackingDesc: 'Monitor family participation and streaks',
      quickTips: 'Quick Tips',
      assignChores: 'Assign Chores',
      assignChoresDesc: 'Create age-appropriate chores and assign them to family members to build responsibility.',
      scheduleEvents: 'Schedule Events',
      scheduleEventsDesc: 'Add family events to the shared calendar so everyone knows what\'s happening.',
      communicate: 'Communicate',
      communicateDesc: 'Use the family messaging system to share announcements and stay connected.',
      unreadMessages: 'Unread Messages',
      viewMessages: 'View messages',
    },
  },
  es: {
    nav: {
      dashboard: 'Panel',
      settings: 'Configuracion',
      signOut: 'Cerrar sesion',
      chores: 'Tareas',
      rewards: 'Recompensas',
      analytics: 'Analiticas',
      lists: 'Listas',
      calendar: 'Calendario',
      messages: 'Mensajes',
      family: 'Familia',
    },
    dashboard: {
      welcomeBack: 'Bienvenido de nuevo, {name}!',
      whatsHappening: 'Esto es lo que esta pasando con tu familia hoy.',
      getStarted: 'Comienza creando o uniendo a una familia.',
      noFamilyYet: 'Sin familia todavia',
      noFamilyDesc: 'Crea una nueva familia o unete a una existente para comenzar a usar Family Planner.',
      createFamily: 'Crear familia',
      joinFamily: 'Unirse a familia',
      completionRate: 'Tasa de completado',
      yourPoints: 'Tus puntos',
      pendingChores: 'Tareas pendientes',
      upcomingEvents: 'Proximos eventos',
      viewAllChores: 'Ver todas las tareas',
      viewCalendar: 'Ver calendario',
      recentChores: 'Tareas recientes',
      viewAll: 'Ver todo',
      noChoresAssigned: 'No hay tareas asignadas todavia',
      createFirstChore: 'Crea tu primera tarea',
      due: 'Vence',
      upcomingEventsTitle: 'Proximos eventos',
      noUpcomingEvents: 'No hay eventos proximos',
      addEvent: 'Agregar un evento',
      familyActivity: 'Actividad familiar',
      trackProgress: 'Rastrea el progreso de tu familia',
      seeDetailedAnalytics: 'Ve analisis detallados, tendencias y logros',
      viewAnalytics: 'Ver Analiticas',
      weeklyTrends: 'Tendencias semanales',
      weeklyTrendsDesc: 'Ve el completado de tareas y actividad familiar a lo largo del tiempo',
      topPerformers: 'Miembros de la familia',
      topPerformersDesc: 'Ve quien es mas activo en tu familia',
      achievementTracking: 'Estadisticas de participacion',
      achievementTrackingDesc: 'Monitorea la participacion familiar y rachas',
      quickTips: 'Consejos rapidos',
      assignChores: 'Asignar tareas',
      assignChoresDesc: 'Crea tareas apropiadas para la edad y asignalas a los miembros de la familia.',
      scheduleEvents: 'Programar eventos',
      scheduleEventsDesc: 'Agrega eventos familiares al calendario compartido para que todos sepan que pasa.',
      communicate: 'Comunicarse',
      communicateDesc: 'Usa el sistema de mensajeria familiar para compartir anuncios y mantenerte conectado.',
      unreadMessages: 'Mensajes sin leer',
      viewMessages: 'Ver mensajes',
    },
    auth: {
      welcomeBack: 'Bienvenido de nuevo',
      signInSubtitle: 'Inicia sesion en tu cuenta de Family Planner',
      email: 'Correo electronico',
      password: 'Contrasena',
      forgotPassword: 'Olvidaste tu contrasena?',
      signIn: 'Iniciar sesion',
      signingIn: 'Iniciando sesion...',
      noAccount: 'No tienes una cuenta?',
      signUp: 'Registrate',
      createAccount: 'Crea tu cuenta',
      createAccountSubtitle: 'Comienza a organizar la vida familiar con Family Planner',
      fullName: 'Nombre completo',
      confirmPassword: 'Confirmar contrasena',
      passwordHint: 'Debe tener al menos 8 caracteres',
      agreeToTerms: 'Acepto los',
      termsOfService: 'Terminos de servicio',
      and: 'y la',
      privacyPolicy: 'Politica de privacidad',
      createAccountBtn: 'Crear cuenta',
      creatingAccount: 'Creando cuenta...',
      alreadyHaveAccount: 'Ya tienes una cuenta?',
      signInLink: 'Iniciar sesion',
      bySigningIn: 'Al iniciar sesion, aceptas nuestros terminos y politica de privacidad',
      freeTrial: 'Prueba gratuita de 14 dias',
      noCreditCard: 'Sin tarjeta de credito',
      forgotPasswordTitle: 'Olvidaste tu contrasena',
      forgotPasswordSubtitle: 'Ingresa tu correo para recibir un enlace de recuperacion',
      sendResetLink: 'Enviar enlace',
      sendingResetLink: 'Enviando...',
      backToSignIn: 'Volver a iniciar sesion',
      resetPasswordTitle: 'Restablecer contrasena',
      setNewPassword: 'Establece tu nueva contrasena a continuacion',
      resetPasswordBtn: 'Restablecer contrasena',
      resetting: 'Restableciendo...',
      unexpectedError: 'Ocurrio un error inesperado',
      loginFailed: 'Inicio de sesion fallido',
      registrationFailed: 'Error en el registro',
      passwordMismatch: 'Las contrasenas no coinciden',
      passwordTooShort: 'La contrasena debe tener al menos 8 caracteres',
    },
    landing: {
      heroTitle: 'Family Planner',
      heroSubtitle: 'Mantén a tu familia organizada y conectada',
      getStarted: 'Comenzar',
      learnMore: 'Saber mas',
    },
    join: {
      title: 'Unirse a familia',
      enterCode: 'Ingresa el codigo de invitacion familiar',
      code: 'Codigo familiar',
      join: 'Unirse',
      joining: 'Uniendo...',
      invalidCode: 'Codigo familiar invalido',
      backToLogin: 'Volver al inicio',
    },
    common: {
      save: 'Guardar',
      saving: 'Guardando...',
      cancel: 'Cancelar',
      delete: 'Eliminar',
      edit: 'Editar',
      create: 'Crear',
      back: 'Volver',
      backToDashboard: 'Volver al panel',
      loading: 'Cargando...',
      error: 'Ocurrio un error',
      success: 'Exito',
      confirm: 'Confirmar',
      yes: 'Si',
      no: 'No',
    },
  },
} as const

type Messages = typeof messages.en

interface I18nContextType {
  locale: Locale
  t: (key: string, params?: Record<string, string | number>) => string
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18nContextType>({
  locale: 'en',
  t: (key) => key,
  setLocale: () => {},
})

export function I18nProvider({ children, locale = 'en' }: { children: React.ReactNode; locale?: Locale }) {
  const [currentLocale, setCurrentLocale] = useState<Locale>(locale)

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const keys = key.split('.')
      let value: unknown = messages[currentLocale]
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k]
        } else {
          return key
        }
      }
      if (typeof value !== 'string') return key
      if (!params) return value
      return value.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
    },
    [currentLocale]
  )

  return (
    <I18nContext.Provider value={{ locale: currentLocale, t, setLocale: setCurrentLocale }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useTranslation() {
  const context = useContext(I18nContext)
  return context
}

export type { Locale, Messages }