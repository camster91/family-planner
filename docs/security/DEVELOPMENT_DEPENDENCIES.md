# Development dependency overrides

## Istanbul YAML configuration

`@istanbuljs/load-nyc-config@1.1.0` is used by Jest's coverage tools. Its
`js-yaml@3` dependency brings in `argparse@1` and `sprintf-js@1.0.3`, affected by
[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). The
advisory lists no patched `sprintf-js` version as of 2026-10-07.

The package override applies `js-yaml@^4.3.2` only to this consumer. Istanbul
calls the retained `load` API, rather than the removed `safeLoad` API. The
parser is already used elsewhere in the development dependency tree. This
removes the vulnerable dependency without changing the Jest major version or
the application dependencies.

`coverage-config-compatibility.test.ts` exercises actual Istanbul YAML loading,
extended configurations, coverage settings, and malformed-input rejection.
Coverage-enabled Jest checks exercise instrumentation as well. Do not remove
the override until the upstream dependency tree no longer includes the affected
package; recheck the consumer and coverage tests when changing it.

This change addresses this advisory only. It does not imply that all development
dependencies are free of advisories or that a new revision is deployed.
