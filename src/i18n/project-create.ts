import type { Locale } from "./types";

export const projectCreateEnglish = {
  back: "Back to Projects",
  title: "New Project",
  sheetTitle: "New Project",
  closeLabel: "Close and return",
  subtitle: "Organize family goals and tasks together.",
  name: "Project Name",
  namePlaceholder: "e.g., Backyard Garden, Spring Cleaning",
  description: "Description",
  optional: "(optional)",
  descriptionPlaceholder: "What's this project about?",
  characterCount: "{count}/1000",
  color: "Accent Color",
  colorOption: "Color: {color}",
  colorBlue: "Blue",
  colorPink: "Pink",
  colorPurple: "Purple",
  colorGreen: "Green",
  colorAmber: "Amber",
  colorIndigo: "Indigo",
  create: "Create Project",
  creating: "Creating...",
  created: "Project created!",
  createdMessage: '"{name}" is ready.',
  createError: "Failed to create project",
  createFallback: "Please try again.",
  draftDescription: "Close to return. Unsaved changes will be cleared.",
  pendingDescription: "Please wait for saving to finish.",
  tip: "After creating, you can add tasks, assign family members, and track progress.",
} as const;

export type ProjectCreateMessage = keyof typeof projectCreateEnglish;

export const projectCreateSpanish: Record<ProjectCreateMessage, string> = {
  back: "Volver a Proyectos",
  title: "Nuevo proyecto",
  sheetTitle: "Nuevo proyecto",
  closeLabel: "Cerrar y volver",
  subtitle: "Organiza los objetivos y las tareas de tu familia.",
  name: "Nombre del proyecto",
  namePlaceholder: "p. ej., Huerto del patio, limpieza de primavera",
  description: "Descripción",
  optional: "(opcional)",
  descriptionPlaceholder: "¿De qué trata este proyecto?",
  characterCount: "{count}/1000",
  color: "Color de acento",
  colorOption: "Color: {color}",
  colorBlue: "Azul",
  colorPink: "Rosa",
  colorPurple: "Morado",
  colorGreen: "Verde",
  colorAmber: "Ámbar",
  colorIndigo: "Índigo",
  create: "Crear proyecto",
  creating: "Creando...",
  created: "¡Proyecto creado!",
  createdMessage: '"{name}" está listo.',
  createError: "No se pudo crear el proyecto",
  createFallback: "Inténtalo de nuevo.",
  draftDescription: "Cierra para volver. Los cambios sin guardar se borrarán.",
  pendingDescription: "Espera a que termine de guardarse.",
  tip: "Después de crear el proyecto, puedes añadir tareas, asignarlas a familiares y seguir el progreso.",
};

export const projectCreateMessages: Record<
  Locale,
  Record<ProjectCreateMessage, string>
> = {
  en: projectCreateEnglish,
  es: projectCreateSpanish,
};
