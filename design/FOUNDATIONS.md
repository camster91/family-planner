# Woven Grove foundations source map

Status: editable review source prepared from `e0c7dac`, 2026-10-07. See [the review frame](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=3-2). The source-of-truth order in `docs/START_HERE.md` still applies.

## Inventory and mapping

The machine-readable [review inventory](tokens/woven-grove-review.json) records all 61 color declarations in the comment-free root CSS block (including compatibility aliases), both resolved light/dark values, primitive references, picker scopes and original web code syntax. It also records six CSS radii, five approved spacing values and 15 type styles. This is a review/export inventory, not a second runtime token loader.

| Figma collection/style                      | Production source                                              | Mapping                                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Woven Grove / Primitives (52 colors)        | `src/app/globals.css` literal hex/RGBA values                  | Exact colors, including alpha; six approved brand swatches keep original names. Primitive pickers are hidden.                                                    |
| Woven Grove / Color (61 semantic variables) | Root / `.dark` color declarations in `globals.css`             | Light/Dark aliases to primitives. `WEB` syntax uses each original `var(--name)`. Source comments are excluded before parsing.                                    |
| Woven Grove / Dimensions (11)               | Six `--radius-*` declarations; spacing from `DESIGN.md`        | Radius 8/12/16/24/28/full and spacing 4/8/16/24/32. CSS radius names are preserved; spacing syntax is an explicit pixel value, not a fictional runtime variable. |
| Runtime / text-* (11 styles)                | `.text-large-title` through `.text-caption-2` in `globals.css` | Exact Newsreader/Manrope families, source weight, size, line height and tracking.                                                                                |
| Brand / Display, Heading, Body, Label (4)   | `DESIGN.md` editorial type specifications                      | Kept separate from the operational scale rather than overwriting existing UI text styles.                                                                        |
| Original symbol                             | `public/brand/woven-grove/logos/herewoven-symbol.svg`          | Editable original vector geometry, unchanged fills, Chalk backing; no tracing or regeneration.                                                                   |

Color pickers are scoped to text, fill or stroke roles, and geometry to gap or radius. All specimen text has a shared style and bound color. Both mode specimens bind to the same semantic variables with explicit mode selection. Original web aliases remain in production; this handoff removes or renames no runtime token.

## Validation

Figma read-back confirmed 124 variables, three collections and 15 styles. Expected values, mode aliases, scopes, web syntax and type metrics match the source inventory. The 68 specimen text nodes have styles and color bindings; child bounds show no overflow. The final composition was visually reviewed. A parser audit caught and repaired omission of `--accent-text` and its `--accent` alias caused by CSS comment text; no application source changed in that repair.

## Remaining acceptance

This slice does not cover effect/motion variables, adaptive layout primitives, fridge-night contrast or the full production component library. These are still required by #150/#152. Reduced-motion, focus and minimum target rules remain in `AGENTS.md`, `globals.css`, source components and their runtime checks; prose annotations do not replace rendered acceptance. The web symbol does not fulfill #163's native adaptive/monochrome icon deliverable.
