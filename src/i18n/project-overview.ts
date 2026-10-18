"use client";

import { useCallback } from "react";
import { useTranslation } from "@/i18n";
import type { Locale } from "@/i18n/types";

/** Copy for the project overview, detail, and task interactions. */
export const projectOverviewEnglish = {
  pageTitle: "Projects",
  pageSubtitle: "Keep family goals and the next steps together",
  newProject: "New project",
  backToProjects: "Back to projects",
  active: "Open",
  completed: "Done",
  archived: "Archived",
  noFamilyTitle: "No family set up",
  noFamilyDescription:
    "Create or join a family to start managing projects together.",
  noProjectsTitle: "No projects yet",
  noProjectsDescription:
    "Organize family goals, home projects, or any shared effort.",
  createProject: "Create project",
  tasksCount: "{done} of {total} tasks",
  noTasks: "No tasks yet",
  actions: "Actions",
  projectActions: "Project actions",
  noActions: "No actions available",
  markComplete: "Mark complete",
  archive: "Archive",
  reactivate: "Reactivate",
  projectCompleted: "Project completed",
  projectArchived: "Project archived",
  projectReactivated: "Project reactivated",
  updateProjectError: "Could not update the project",
  progressTasks: "{done} of {total} tasks done",
  progressRemaining: "{count} remaining",
  allDone: "All done",
  tasksHeading: "Tasks",
  openTasks: "Open",
  doneTasks: "Done",
  noTasksDescription: "Break this project into tasks with Add task.",
  noTasksForClosed: "This project has no tasks.",
  taskAssignedTo: "Assigned to {name}",
  taskDue: "Due {date}",
  taskDetails: "{details}",
  addTask: "Add task",
  taskFormLabel: "Add task",
  taskName: "Task",
  taskNameRequired: "Give the task a name.",
  dueDate: "Due date",
  optional: "(optional)",
  whoIsDoingIt: "Who's doing it",
  anyone: "Anyone",
  offline: "You're offline. You can add tasks again when you're back online.",
  addingTask: "Adding…",
  done: "Done",
  taskAdded: "Task added",
  taskAddedMessage: "“{name}” is on the list.",
  taskAddError: "Couldn't add the task.",
  taskAddFallback: "Couldn't add the task. Please try again.",
  taskUpdateError: "Could not update task",
  taskUpdateNetworkError: "Check your connection and try again.",
  taskUpdateFallback: "Please try again.",
  calendarTitle: "Send tasks to calendar",
  calendarDescription: "Add incomplete tasks with due dates as all-day events.",
  sendToCalendar: "Send to Calendar",
  sending: "Sending…",
  calendarAddedOne: "Added 1 task to the calendar",
  calendarAddedMany: "Added {count} tasks to the calendar",
  calendarNothing: "Nothing new to add",
  calendarNothingMessage: "Dated tasks are already on the calendar.",
  calendarError: "Could not send to calendar",
} as const;

export type ProjectOverviewMessage = keyof typeof projectOverviewEnglish;

export const projectOverviewSpanish: Record<ProjectOverviewMessage, string> = {
  pageTitle: "Proyectos",
  pageSubtitle: "Reúne los objetivos familiares y los siguientes pasos",
  newProject: "Nuevo proyecto",
  backToProjects: "Volver a proyectos",
  active: "Abiertos",
  completed: "Completados",
  archived: "Archivados",
  noFamilyTitle: "Aún no hay una familia",
  noFamilyDescription:
    "Crea una familia o únete a una para empezar a gestionar proyectos juntos.",
  noProjectsTitle: "Aún no hay proyectos",
  noProjectsDescription:
    "Organiza objetivos familiares, proyectos del hogar o cualquier tarea compartida.",
  createProject: "Crear proyecto",
  tasksCount: "{done} de {total} tareas",
  noTasks: "Aún no hay tareas",
  actions: "Acciones",
  projectActions: "Acciones del proyecto",
  noActions: "No hay acciones disponibles",
  markComplete: "Marcar como completado",
  archive: "Archivar",
  reactivate: "Reactivar",
  projectCompleted: "Proyecto completado",
  projectArchived: "Proyecto archivado",
  projectReactivated: "Proyecto reactivado",
  updateProjectError: "No se pudo actualizar el proyecto",
  progressTasks: "{done} de {total} tareas completadas",
  progressRemaining: "{count} pendientes",
  allDone: "Todo listo",
  tasksHeading: "Tareas",
  openTasks: "Abiertas",
  doneTasks: "Completadas",
  noTasksDescription: "Divide este proyecto en tareas con Añadir tarea.",
  noTasksForClosed: "Este proyecto no tiene tareas.",
  taskAssignedTo: "Asignada a {name}",
  taskDue: "Vence el {date}",
  taskDetails: "{details}",
  addTask: "Añadir tarea",
  taskFormLabel: "Añadir tarea",
  taskName: "Tarea",
  taskNameRequired: "Escribe un nombre para la tarea.",
  dueDate: "Fecha límite",
  optional: "(opcional)",
  whoIsDoingIt: "¿Quién la hará?",
  anyone: "Cualquiera",
  offline:
    "Estás sin conexión. Podrás añadir tareas cuando vuelvas a conectarte.",
  addingTask: "Añadiendo…",
  done: "Listo",
  taskAdded: "Tarea añadida",
  taskAddedMessage: "«{name}» está en la lista.",
  taskAddError: "No se pudo añadir la tarea.",
  taskAddFallback: "No se pudo añadir la tarea. Inténtalo de nuevo.",
  taskUpdateError: "No se pudo actualizar la tarea",
  taskUpdateNetworkError: "Comprueba la conexión e inténtalo de nuevo.",
  taskUpdateFallback: "Inténtalo de nuevo.",
  calendarTitle: "Enviar tareas al calendario",
  calendarDescription:
    "Añade las tareas pendientes con fecha como eventos de todo el día.",
  sendToCalendar: "Enviar al calendario",
  sending: "Enviando…",
  calendarAddedOne: "Se añadió 1 tarea al calendario",
  calendarAddedMany: "Se añadieron {count} tareas al calendario",
  calendarNothing: "No hay nada nuevo que añadir",
  calendarNothingMessage: "Las tareas con fecha ya están en el calendario.",
  calendarError: "No se pudieron enviar las tareas al calendario",
};

export const projectOverviewMessages: Record<
  Locale,
  Record<ProjectOverviewMessage, string>
> = {
  en: projectOverviewEnglish,
  es: projectOverviewSpanish,
};

export function useProjectOverviewText() {
  const { t } = useTranslation();
  return useCallback(
    (key: ProjectOverviewMessage, params?: Record<string, string | number>) =>
      t(key, params, projectOverviewMessages),
    [t],
  );
}
