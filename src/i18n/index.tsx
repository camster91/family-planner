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
    },
  },
  es: {
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
    nav: {
      dashboard: 'Panel',
      settings: 'Configuracion',
    },
  },
} as const

type Messages = typeof messages.en

interface I18nContextType {
  locale: Locale
  t: (key: string) => string
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
    (key: string): string => {
      const keys = key.split('.')
      let value: unknown = messages[currentLocale]
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k]
        } else {
          return key
        }
      }
      return typeof value === 'string' ? value : key
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