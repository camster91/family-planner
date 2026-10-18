"use client";
import { useTranslation } from "@/i18n";
const en = {
  title: "Help",
  intro: "Quick answers and a clear next step.",
  start: "Getting started",
  plan: "Calendar, meals and lists",
  chores: "Chores and rewards",
  account: "Trouble signing in",
  data: "Your data",
  diagnostics: "Connection and app details",
  contact: "Contact support",
  create: "Create your household",
  createHelp:
    "After signing up and confirming your email, choose a household name. The person creating it becomes a parent.",
  invite: "Add everyone",
  inviteHelp:
    "Invite someone by email for their own login, or add a name-only profile for a shared household screen when supported. A profile does not create an account or grant parent access. Inviting an account does not link an existing profile.",
  join: "Join with a family code",
  joinHelp:
    "Open ‘In person instead’ on the Invite page. The other person signs in with their own account and enters the code on Join a family. Codes join people as a child or teen.",
  choresHelp:
    "Choose a person, a one-off date or repeating days. A completed chore waits for a parent to check. Repeating chores can be grouped as a series; routines keep related steps together.",
  rewards: "Rewards",
  rewardsHelp:
    "Parents choose rewards and their point costs. Children can claim the rewards they can afford. Quiet view hides extra progress decoration without changing earned points or rewards.",
  calendar: "Calendar",
  calendarHelp:
    "Choose Day, Week or Agenda. Add an event with a start time and duration. The calendar connections menu shows available provider connections and read-only subscription links.",
  meals: "Meals",
  mealsHelp:
    "Plan the week, explore recipes or save a recipe to reuse. Prep sessions group several dishes; track portions eaten, portions left and the next prep date.",
  lists: "Lists",
  listsHelp:
    "Keep groceries, to-dos, wishlists and custom lists together. The Groceries shortcut opens grocery lists. Item changes show their sync state when you are offline.",
  password: "Forgot your password",
  passwordHelp:
    "Ask for a reset link by email. If you know your current password, use Settings → Your account → Change Password.",
  verification: "The confirmation email did not arrive",
  verificationHelp:
    "Check spam or junk. On sign-in, ask for a new confirmation email. Use the newest link.",
  export: "Download your data",
  exportHelp:
    "Use Settings → Privacy & data → Data Export. Each family member downloads their own copy.",
  deletion: "Delete your account or household",
  deletionHelp:
    "Use Delete Account under Settings → Privacy & data. The last parent can delete the household. Deleted data remains in backups for up to about five weeks.",
  privacy: "Privacy Policy",
  privacyHelp: "Read how your household information is handled.",
  supportHelp:
    "Describe what happened and what you were trying to do. Avoid sending passwords, family codes or private medical details.",
  supportPending: "Support email coming soon",
  supportFallback:
    "Until then, contact the person who invited you to the beta.",
  privacyIncident:
    "If you see another family’s information, stop and tell us. Do not share screenshots of it.",
} as const;
export type HelpMessage = keyof typeof en;
const es: Record<HelpMessage, string> = {
  title: "Ayuda",
  intro: "Respuestas rápidas y un próximo paso claro.",
  start: "Primeros pasos",
  plan: "Calendario, comidas y listas",
  chores: "Tareas y recompensas",
  account: "Problemas para iniciar sesión",
  data: "Tus datos",
  diagnostics: "Conexión y detalles de la app",
  contact: "Contactar con soporte",
  create: "Crea tu hogar",
  createHelp:
    "Después de registrarte y confirmar tu correo, elige un nombre para el hogar. Quien lo crea se convierte en padre o madre.",
  invite: "Añade a todos",
  inviteHelp:
    "Invita por correo a quien necesite su propia cuenta o añade un perfil con solo nombre para una pantalla compartida cuando esté disponible. Un perfil no crea una cuenta ni concede acceso de padre o madre. Invitar una cuenta no vincula un perfil existente.",
  join: "Unirse con un código familiar",
  joinHelp:
    "Abre «En persona» en Invitaciones. La otra persona inicia sesión con su propia cuenta e introduce el código en Unirse a una familia. Los códigos permiten unirse como niño o niña o adolescente.",
  choresHelp:
    "Elige una persona, una fecha única o días de repetición. Una tarea completada espera la revisión de un padre o una madre. Las tareas repetidas se agrupan como una serie y las rutinas reúnen pasos relacionados.",
  rewards: "Recompensas",
  rewardsHelp:
    "Los padres eligen recompensas y su coste en puntos. Los niños pueden reclamar las que puedan pagar. La vista tranquila oculta adornos del progreso sin cambiar los puntos ni las recompensas.",
  calendar: "Calendario",
  calendarHelp:
    "Elige Día, Semana o Agenda. Añade un evento con hora de inicio y duración. El menú de conexiones muestra los proveedores disponibles y enlaces de suscripción de solo lectura.",
  meals: "Comidas",
  mealsHelp:
    "Planifica la semana, explora recetas o guárdalas para reutilizarlas. Las sesiones de preparación agrupan varios platos; registra porciones consumidas, restantes y la próxima preparación.",
  lists: "Listas",
  listsHelp:
    "Reúne compras, tareas, deseos y listas personalizadas. El acceso Compras abre las listas de alimentos. Los cambios muestran su estado de sincronización cuando estás sin conexión.",
  password: "Olvidaste tu contraseña",
  passwordHelp:
    "Pide un enlace por correo para restablecerla. Si conoces la contraseña actual, usa Ajustes → Tu cuenta → Cambiar contraseña.",
  verification: "No llegó el correo de confirmación",
  verificationHelp:
    "Revisa spam o correo no deseado. Pide otro correo en la pantalla de inicio de sesión. Usa el enlace más reciente.",
  export: "Descargar tus datos",
  exportHelp:
    "Usa Ajustes → Privacidad y datos → Exportar datos. Cada familiar descarga su propia copia.",
  deletion: "Eliminar tu cuenta o tu hogar",
  deletionHelp:
    "Usa Eliminar cuenta en Ajustes → Privacidad y datos. El último padre o madre puede eliminar el hogar. Los datos eliminados permanecen en las copias de seguridad hasta unas cinco semanas.",
  privacy: "Política de privacidad",
  privacyHelp: "Consulta cómo se trata la información de tu hogar.",
  supportHelp:
    "Describe qué ocurrió y qué intentabas hacer. Evita enviar contraseñas, códigos familiares o datos médicos privados.",
  supportPending: "El correo de soporte estará disponible pronto",
  supportFallback: "Mientras tanto, contacta con quien te invitó a la beta.",
  privacyIncident:
    "Si ves información de otra familia, detente y avísanos. No compartas capturas de esa información.",
};
export function useHelpText() {
  const { locale } = useTranslation();
  return (key: keyof typeof en) => (locale === "es" ? es : en)[key];
}
