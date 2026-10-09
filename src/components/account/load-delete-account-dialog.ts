import type DeleteAccountDialog from "./DeleteAccountDialog";

export async function loadDeleteAccountDialog(): Promise<
  typeof DeleteAccountDialog
> {
  return (await import("./DeleteAccountDialog")).default;
}
