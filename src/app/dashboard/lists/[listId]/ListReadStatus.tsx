"use client";
import { useRouter } from "next/navigation";
import { useListDetailText } from "@/i18n/list-detail";
export function ListReadStatus({ failed }: { failed: boolean }) {
  const text = useListDetailText();
  const router = useRouter();
  return (
    <section
      className="card-apple p-6 space-y-3"
      role={failed ? "alert" : "status"}
    >
      <h1 className="text-title-3 text-label-primary">
        {text(failed ? "readFailed" : "notFound")}
      </h1>
      {failed && (
        <button
          type="button"
          className="btn-tinted min-h-11"
          onClick={() => router.refresh()}
        >
          {text("retry")}
        </button>
      )}
    </section>
  );
}
