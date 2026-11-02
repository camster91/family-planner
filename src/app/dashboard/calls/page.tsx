import { redirect } from "next/navigation";

// Old bookmarks should return to the household app without a dead feature page.
export default function RemovedCallsPage() {
  redirect("/dashboard/today");
}
