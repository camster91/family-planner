"use client";

import * as React from "react";

// Households without chore pictures do not need the full drawing catalogue.
const Picture = React.lazy(async () => {
  const module = await import("@/components/chores/RoutineIcon");
  return { default: module.RoutineIcon };
});

const pictureClass =
  "mr-2 inline-block h-6 w-6 align-[-4px] text-label-secondary";

function Placeholder() {
  return <span aria-hidden="true" className={pictureClass} />;
}

/** A decorative picture download must never disable the labelled chore action. */
class PictureBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <Placeholder /> : this.props.children;
  }
}

export function BoardRoutineIcon({ icon }: { icon: string }) {
  return (
    <PictureBoundary>
      <React.Suspense fallback={<Placeholder />}>
        <Picture icon={icon} className={pictureClass} />
      </React.Suspense>
    </PictureBoundary>
  );
}
