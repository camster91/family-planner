import { BrandIllustration } from "@/components/ui/brand-illustration";
import { ILLUSTRATIONS } from "@/lib/brand-illustrations";

/**
 * The Get started card's original Woven Grove art. Rendered by the Today
 * server page and handed to the lazy card as a prop, so the illustration
 * registry never ships in the card's browser chunk (initial JS budget, #413).
 */
export function GetStartedArt() {
  return (
    <BrandIllustration
      source={ILLUSTRATIONS.wovenGrove}
      className="woven-grove-art hidden h-auto w-16 shrink-0 rounded-[var(--radius-md)] sm:block"
    />
  );
}
