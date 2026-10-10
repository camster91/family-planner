# Today controls — issue #462

A wrapping quick-action row sits below Today’s date. Parents get Add event and Add chore when those sections are enabled. Grocery and all-list shortcuts use the canonical grocery resolver and shared list overview. Plan meals opens the existing meal planner. Today controls opens a small native disclosure with Refresh now, parent-only household features, and personal settings. Refresh is disabled offline, with an explanation.

Existing routes, intercepted form sheets and role/household APIs remain authoritative. This introduces no mutations, data models, preferences or new authorization. Only signed-in app boards show the row; fridge and paired-device boards retain their shared-surface controls. Targets are at least 44px, focus visible; Escape closes and returns focus, outside pointer closes. English and Spanish follow the display locale. Existing tile ticking and Undo are unchanged.

Personal tile rearranging/hiding, a family-member filter and density preferences require a separate persisted preference design; these are not represented as working controls here. Rollback: remove TodayControls and its integration.
