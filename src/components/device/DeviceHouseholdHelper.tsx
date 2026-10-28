"use client";

import * as React from "react";
import { MessageCircle } from "lucide-react";
import type { TodayBoardData } from "@/app/dashboard/today/today-board-data";
import { Dialog } from "@/components/ui/dialog";
import { useCoreI18n } from "@/i18n/core";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import {
  choresDueTodayByPerson,
  dinnerOn,
  dinnerTitle,
  eventsLeftToday,
  formatTime,
  localDayKey,
} from "@/components/fridge/board-model";
import {
  deviceHelperQuestion,
  MAX_DEVICE_HELPER_QUESTION,
  type DeviceHelperTopic,
} from "@/lib/device-helper-question";
import { secondaryButtonClass } from "./styles";

const messages = {
  en: {
    title: "Household helper",
    question: "Ask about today’s shared plan",
    placeholder: "For example: What’s for dinner?",
    ask: "Show answer",
    unsupported:
      "Try one of the questions below. This helper answers about today’s schedule, dinner, chores and groceries; it cannot make changes.",
    description:
      "Quick answers from this tablet’s board. This helper does not make changes or use AI.",
    schedule: "What’s next today?",
    dinner: "What’s for dinner?",
    chores: "Which chores are left?",
    groceries: "What do we need to buy?",
    empty: "Nothing to show here yet.",
    off: "This section is turned off.",
    saved: "Showing a saved plan. Reconnect to get the latest information.",
    snapshot: "Board updated",
    close: "Close",
    more: "This preview does not show every item.",
    now: "Now",
  },
  es: {
    title: "Ayuda del hogar",
    question: "Pregunta sobre el plan compartido de hoy",
    placeholder: "Por ejemplo: ¿Qué hay para cenar?",
    ask: "Mostrar respuesta",
    unsupported:
      "Prueba una de las preguntas de abajo. Esta ayuda responde sobre la agenda de hoy, la cena, las tareas y las compras; no puede hacer cambios.",
    description:
      "Respuestas rápidas del tablero de esta tableta. Esta ayuda no hace cambios ni usa IA.",
    schedule: "¿Qué sigue hoy?",
    dinner: "¿Qué hay para cenar?",
    chores: "¿Qué tareas quedan?",
    groceries: "¿Qué necesitamos comprar?",
    empty: "Todavía no hay nada que mostrar aquí.",
    off: "Esta sección está desactivada.",
    saved:
      "Se muestra un plan guardado. Conéctate para obtener la información más reciente.",
    snapshot: "Tablero actualizado",
    close: "Cerrar",
    more: "Esta vista previa no muestra todos los elementos.",
    now: "Ahora",
  },
};
type Topic = DeviceHelperTopic;
const topics: Topic[] = ["schedule", "dinner", "chores", "groceries"];

/** Device-audience DTO only. No person requests, provider, storage or write path. */
export default function DeviceHouseholdHelper({
  data,
  cached,
  active,
}: {
  data: TodayBoardData;
  cached: boolean;
  active: boolean;
}) {
  const { locale } = useCoreI18n();
  const text = messages[locale];
  const displayLocale = useDisplayLocale();
  const [topic, setTopic] = React.useState<Topic | null>(null);
  const [question, setQuestion] = React.useState("");
  const [unsupported, setUnsupported] = React.useState(false);
  const questionId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [now, setNow] = React.useState(() => new Date());
  const close = React.useCallback(() => {
    setOpen(false);
    setTopic(null);
    setQuestion("");
    setUnsupported(false);
  }, []);
  React.useEffect(() => {
    if (!active) close();
  }, [active, close]);
  React.useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") close();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", close);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", close);
    };
  }, [close]);
  React.useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [open]);
  let rows: string[] = [];
  let more = false;
  let disabledSection = false;
  if (topic === "schedule") {
    const events = eventsLeftToday(data.events, now);
    rows = events
      .slice(0, 5)
      .map(
        (event) =>
          `${event.happeningNow ? text.now : formatTime(event.start, displayLocale)} · ${event.title}`,
      );
    more = events.length > rows.length;
  } else if (topic === "dinner") {
    disabledSection = data.dinners === null;
    const title = dinnerTitle(dinnerOn(data.dinners, localDayKey(now)));
    if (title) rows = [title];
  } else if (topic === "chores") {
    const chores = choresDueTodayByPerson(
      data.chores,
      data.members,
      now,
    ).flatMap((person) =>
      person.open.map((chore) => `${person.member.name} · ${chore.title}`),
    );
    rows = chores.slice(0, 5);
    more = chores.length > rows.length;
  } else if (topic === "groceries") {
    disabledSection = data.shopping === null;
    rows =
      data.shopping?.items
        .slice(0, 5)
        .map((item) => `${item.content} × ${item.quantity}`) ?? [];
    more = (data.shopping?.total ?? 0) > rows.length;
  }
  return (
    <>
      <button
        type="button"
        className={secondaryButtonClass}
        disabled={!active}
        aria-haspopup="dialog"
        onClick={() => {
          setNow(new Date());
          setOpen(true);
        }}
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        {text.title}
      </button>
      <Dialog
        open={open && active}
        onClose={close}
        title={text.title}
        description={text.description}
        closeLabel={text.close}
        variant="form"
      >
        {cached && (
          <p role="status" className="mb-4 text-body text-label-secondary">
            {text.saved}
          </p>
        )}
        <p className="mb-4 text-footnote text-label-secondary">
          {text.snapshot}:{" "}
          {new Date(data.generatedAt).toLocaleString(displayLocale)}
        </p>
        <form
          className="mb-4 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const next = deviceHelperQuestion(question);
            setNow(new Date());
            setTopic(next);
            setUnsupported(next === null);
          }}
        >
          <label htmlFor={questionId} className="block text-body font-semibold">
            {text.question}
          </label>
          <input
            id={questionId}
            type="text"
            className="input-apple w-full"
            maxLength={MAX_DEVICE_HELPER_QUESTION}
            value={question}
            autoComplete="off"
            placeholder={text.placeholder}
            onChange={(event) => {
              setQuestion(event.target.value);
              setUnsupported(false);
              setTopic(null);
            }}
          />
          <button
            type="submit"
            className="btn-primary min-h-[44px]"
            disabled={!question.trim()}
          >
            {text.ask}
          </button>
          {unsupported && (
            <p role="status" className="text-body text-label-secondary">
              {text.unsupported}
            </p>
          )}
        </form>
        <div className="flex flex-wrap gap-2">
          {topics.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={topic === value}
              className={`btn-tinted min-h-[44px] border-2 ${topic === value ? "border-[var(--accent-text)]" : "border-transparent"}`}
              onClick={() => {
                setNow(new Date());
                setTopic(value);
                setQuestion("");
                setUnsupported(false);
              }}
            >
              {text[value]}
            </button>
          ))}
        </div>
        <div
          role="status"
          aria-live="polite"
          className="mt-4 space-y-3 text-body text-label-primary"
        >
          {topic && (
            <>
              <h3 className="font-semibold">{text[topic]}</h3>
              {rows.length ? (
                <ul className="space-y-3">
                  {rows.map((row, i) => (
                    <li key={i} className="break-words">
                      {row}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{disabledSection ? text.off : text.empty}</p>
              )}
              {more && (
                <p className="text-footnote text-label-secondary">
                  {text.more}
                </p>
              )}
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
