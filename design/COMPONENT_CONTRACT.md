# Component Contract

Every reusable production UI component should define enough behaviour that agents do not recreate it differently per screen.

For each component document/encode:
- semantic purpose;
- content slots and priority;
- variants/sizes;
- responsive composition rules;
- default/pressed/selected/disabled/loading/error/offline states as applicable;
- empty content behaviour;
- accessible role/name/focus/keyboard behaviour;
- touch target minimums;
- light/dark/night tokens;
- reduced motion/haptic behaviour;
- truncation/wrapping/long-text policy;
- analytics hooks only when product measurement requires them.

## Code rules
- Prefer typed variants over arbitrary class overrides.
- Use semantic tokens rather than hard-coded colours/spacing/radii.
- Separate visual components from data fetching when it improves testability/reuse.
- Avoid components whose only purpose is one screenshot composition.

## Tablet rule
Large screens may change layout composition, but the component should not silently expose extra sensitive data simply because more space exists.

## Visual verification
Canonical variants/states belong in the development state gallery and visual regression fixtures once implemented.