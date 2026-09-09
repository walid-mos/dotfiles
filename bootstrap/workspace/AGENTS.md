# Studio workspace manager

Read `ARCHITECTURE.md` before architectural changes and `README.md` before operating the manager. The Desktop architecture document links to this authoritative copy. Apple Container is mandatory; never add a second lifecycle owner inside Pi.

`src/lifecycle.ts` owns workspace transitions under the repository lock; `src/store.ts` owns persistent records. Runtime IDs are exact, and project configuration is explicitly trusted by digest before execution. Tests must use disposable repositories/state and must never target an existing user's workspace for removal.

Run `npm test` and the TypeScript check before installation. See `README.md` for real-runtime acceptance tests and privileged gateway setup. Never restart the active Herdr server during development.
