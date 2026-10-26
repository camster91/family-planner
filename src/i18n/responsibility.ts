import { responsibilityShellMessages } from "./responsibility-shell";
import { useTranslation } from "@/i18n";
const en = {
  ...responsibilityShellMessages.en,
  ownerChanged:
    "Your account or household changed. Close and reopen this sheet before continuing.",
  snapshot: "Last checked preview · open to refresh or change",
  previewUnavailable:
    "Answers could not be loaded. Open to retry; this is not an empty plan.",
  title: "Who’s handling this?",
  openTarget: "Open canonical item",
  close: "Close responsibility",
  intro:
    "Confirm the plan together. Naming someone does not mean they have agreed.",
  error:
    "Could not confirm the latest plan. Saved requests are kept. Reload before making another change.",
  reload: "Reload current plan",
  primary: "Primary",
  coordinator: "Household coordinator",
  backup: "Backup",
  none: "Not named",
  coordinatorHint:
    "The household coordinator is separate from the sitter. This does not change or contact the sitter.",
  awaiting: "Awaiting an answer",
  accepted: "Accepted",
  declined: "Cannot do it",
  self: "Confirmed on their own account",
  recorded: "Recorded by a parent",
  accept: "I can do this",
  decline: "I can’t do this",
  recordAccept: "Record that they can",
  recordDecline: "Record that they can’t",
  reset: "Return to awaiting",
  recordHint:
    "This profile has no separate account. Your answer will be labelled as parent-recorded.",
  chooseBackup: "Choose a backup",
  chooseCoordinator: "Choose a coordinator",
  search: "Search people",
  searchLabel: "Find a household member",
  more: "More people are available. Search by name.",
  noChoices: "No eligible people found.",
  clearBackup: "Remove backup",
  clearCoordinator: "Remove coordinator",
  preview: "Review this change",
  confirm: "Save this answer",
  cancel: "Cancel",
  namingHint:
    "This only names a person. They still need to answer. It does not reassign the task, activate a backup or send a message.",
  resetHint:
    "This clears the recorded answer. It does not say the person declined.",
  paused:
    "Changes are paused. You can read the current plan and check saved requests.",
  closed: "This item is no longer active. No new answers can be recorded.",
  changed:
    "The task or people changed. Previous answers no longer confirm this plan.",
  pending: "Saved requests",
  pendingHint:
    "Check a saved request before retrying. A past receipt does not confirm the current plan.",
  check: "Check request",
  retry: "Retry exact request",
  other: "Open the saved item",
  forget: "Forget locally",
  forgetHint:
    "Forget this saved request? This does not undo any change already saved on the server.",
  forgetConfirm: "Yes, forget locally",
  storage:
    "Saved-request storage needs attention. No new change can be sent until it is recovered.",
  repair: "Recover saved requests",
  unknown:
    "The result is uncertain. Keep the saved request and check it before retrying.",
  refused:
    "The server did not confirm this request. Check it or forget it locally before making a new change.",
  proof:
    "The server confirmed that request. The current plan below is a separate, fresh read.",
  states: {
    ready: "Not recorded yet. You can retry the exact request.",
    pending: "The outcome is still pending. You can retry the exact request.",
    committed: "The server has a receipt for this request.",
    expired:
      "This request is too old to retry. Review the current plan before making a new choice.",
    conflict: "The plan changed. Do not retry this request.",
    paused: "Changes are paused. Keep this request for later review.",
    unavailable: "The request could not be checked.",
  },
  kinds: { chore: "Chore", pickup: "Pickup", handoff: "Handoff" },
};
const es: typeof en = {
  ...responsibilityShellMessages.es,
  ownerChanged:
    "Tu cuenta u hogar cambió. Cierra y vuelve a abrir este panel antes de continuar.",
  snapshot: "Última vista consultada · abre para actualizar o cambiar",
  previewUnavailable:
    "No se pudieron cargar las respuestas. Abre para reintentar; no indica un plan vacío.",
  title: "¿Quién se encarga?",
  openTarget: "Abrir elemento principal",
  close: "Cerrar responsabilidad",
  intro:
    "Confirmen el plan juntos. Nombrar a alguien no significa que haya aceptado.",
  error:
    "No se pudo confirmar el plan actual. Las solicitudes guardadas se conservan. Vuelve a cargar antes de cambiar algo.",
  reload: "Cargar el plan actual",
  primary: "Responsable principal",
  coordinator: "Coordinador del hogar",
  backup: "Suplente",
  none: "Sin nombrar",
  coordinatorHint:
    "El coordinador del hogar es distinto del cuidador. Esto no cambia ni contacta al cuidador.",
  awaiting: "Esperando una respuesta",
  accepted: "Aceptado",
  declined: "No puede hacerlo",
  self: "Confirmado desde su propia cuenta",
  recorded: "Registrado por un padre o madre",
  accept: "Puedo hacerlo",
  decline: "No puedo hacerlo",
  recordAccept: "Registrar que puede",
  recordDecline: "Registrar que no puede",
  reset: "Volver a esperar respuesta",
  recordHint:
    "Este perfil no tiene una cuenta propia. Tu respuesta se marcará como registrada por un padre o madre.",
  chooseBackup: "Elegir suplente",
  chooseCoordinator: "Elegir coordinador",
  search: "Buscar personas",
  searchLabel: "Buscar un miembro del hogar",
  more: "Hay más personas. Busca por nombre.",
  noChoices: "No se encontraron personas elegibles.",
  clearBackup: "Quitar suplente",
  clearCoordinator: "Quitar coordinador",
  preview: "Revisar este cambio",
  confirm: "Guardar esta respuesta",
  cancel: "Cancelar",
  namingHint:
    "Esto solo nombra a una persona. Aún debe responder. No reasigna la tarea, activa un suplente ni envía mensajes.",
  resetHint:
    "Esto borra la respuesta registrada. No indica que la persona haya rechazado.",
  paused:
    "Los cambios están pausados. Puedes leer el plan y consultar solicitudes guardadas.",
  closed:
    "Este elemento ya no está activo. No se pueden registrar nuevas respuestas.",
  changed:
    "La tarea o las personas cambiaron. Las respuestas anteriores ya no confirman este plan.",
  pending: "Solicitudes guardadas",
  pendingHint:
    "Consulta una solicitud antes de reintentar. Un recibo anterior no confirma el plan actual.",
  check: "Consultar solicitud",
  retry: "Reintentar solicitud exacta",
  other: "Abrir el elemento guardado",
  forget: "Olvidar localmente",
  forgetHint:
    "¿Olvidar esta solicitud? No deshace ningún cambio ya guardado en el servidor.",
  forgetConfirm: "Sí, olvidar localmente",
  storage:
    "El almacenamiento de solicitudes necesita atención. Recupera las solicitudes antes de enviar cambios.",
  repair: "Recuperar solicitudes",
  unknown:
    "El resultado es incierto. Conserva la solicitud y consúltala antes de reintentar.",
  refused:
    "El servidor no confirmó la solicitud. Consúltala u olvídala localmente antes de hacer un cambio nuevo.",
  proof:
    "El servidor confirmó esa solicitud. El plan actual se obtiene por separado.",
  states: {
    ready: "Aún no registrada. Puedes reintentar la solicitud exacta.",
    pending:
      "El resultado sigue pendiente. Puedes reintentar la solicitud exacta.",
    committed: "El servidor tiene un recibo para esta solicitud.",
    expired:
      "La solicitud es demasiado antigua. Revisa el plan antes de elegir de nuevo.",
    conflict: "El plan cambió. No reintentes esta solicitud.",
    paused:
      "Los cambios están pausados. Conserva esta solicitud para revisarla después.",
    unavailable: "No se pudo consultar la solicitud.",
  },
  kinds: { chore: "Tarea", pickup: "Recogida", handoff: "Relevo" },
};
export function useResponsibilityText() {
  return useTranslation().locale === "es" ? es : en;
}

export const responsibilityMessages = { en, es };
