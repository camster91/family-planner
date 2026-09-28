# Original Graphics Pipeline

## Goal
Give Family Planner a distinctive visual personality without mixing stock assets, copied references or inconsistent agent-generated illustrations.

## Asset families
- adaptive/monochrome/app icons;
- onboarding illustrations;
- empty states;
- food/ingredient/category graphics;
- weather/status art;
- offline/sync/recovery art;
- achievement/completion moments.

## Source rules
- Original work only or assets with clearly documented licence/source.
- Never trace/copy Dribbble/competitor/Apple artwork.
- Store/editable source location and export settings in the Figma/design handoff.
- Avoid embedded text unless localized variants exist.
- Avoid holiday-specific assumptions in generic household surfaces.

## Technical exports
- Prefer SVG/vector when safe and appropriate.
- Raster art needs responsive density/size strategy.
- Optimize bytes; large-screen quality must not create slow dashboard startup.
- Define light/dark/night compatibility.
- Decorative art needs appropriate accessibility treatment (usually empty alt/ignored); meaningful icons require accessible names via UI context.

## Chore picture icons (#272)
The first original family in code: about 40 routine pictures for young kids (brush teeth, get dressed, shoes,
backpack, bed, bath, toys, dishes, feed the pet, homework, reading, water the plants, trash, laundry, set the
table, breakfast, lunchbox, coat, wash hands, pyjamas, …).

- Source: drawn for Family Planner as inline SVG in `src/components/chores/RoutineIcon.tsx`; not traced or copied
  from any icon pack (lucide stays for UI chrome only). Keys and labels: `src/lib/routine-icons.ts` (the API
  validates `Chore.icon` against them; add keys, never rename or remove one).
- Grammar: 24×24 grid, content inside 2–22, strokes only in `currentColor`, 2px stroke, round caps and joins, one
  object per picture, no text, no holiday or culture-specific objects. The same drawing works at 16px (chores list
  glyph), 24px (Today board) and 96px (kid home cards).
- Themes: `currentColor`, so light, dark and night follow the surrounding text colour.
- Accessibility: pictures are decorative (`aria-hidden`) inside a control that carries the name (the chore title
  and its state); pass `title` to `RoutineIcon` only when a picture stands alone. Meaning never rests on the
  picture or colour alone: kid cards show the title, "Next" and "Done" as text too.
- Gallery: rendered by the picker on `/dashboard/chores/create` (every picture with its name); a completeness test
  checks every key has a drawing.
- Figma: no Figma source yet; the SVG in code is the editable source until a design handoff exists.

## Motion
Animations derived from graphics must have static/reduced-motion equivalents and must not run continuously on an always-on fridge tablet unless functionally necessary.

## Review
Each new graphic family should be visible in the design-system/state gallery and linked to its issue/Figma source.