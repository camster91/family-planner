# Build-only CSS dependencies

`tailwindcss-animate` is required only by `tailwind.config.js` while Tailwind compiles CSS. It belongs in `devDependencies` alongside Tailwind and PostCSS. Docker's dependency/builder stages install these packages; the runner copies Next.js standalone output and compiled static CSS. No application route imports the plugin.

Keep `npm audit --omit=dev --audit-level=high` as the production dependency gate. Do not suppress advisories or raise its severity threshold. Also review `npm audit` for build tooling: moving a build package into the correct section does not patch its transitive dependencies.

On 2026-10-03 the production audit started reporting [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) through Tailwind's pattern tooling. The advisory lists no patched `braces` version. The deployed standalone container at revision `66655786ed02e8156b61e7fe6307da75f2da71c5` could not resolve `braces`, `micromatch`, `fast-glob`, `tailwindcss`, or `tailwindcss-animate`. This is runtime package-presence evidence, not a claim that the build dependency advisory is fixed.

Build patterns must remain trusted repository configuration. Do not feed user input into build pattern/glob APIs. Review upstream remediation before accepting untrusted build patterns or upgrading this tooling. Recheck both audits and runtime package presence when the dependency graph changes.
