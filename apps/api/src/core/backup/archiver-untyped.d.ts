// `archiver` (pinned to v7 — see backup.service.ts's docblock) and
// `archiver-zip-encrypted` ship no type declarations compatible with that
// pinned version (`@types/archiver` on npm only types the newer v8 API).
// backup.service.ts already defines its own minimal, accurate local types
// (`ArchiverFactory`) for what it actually calls — these ambient
// declarations exist only to let `import('archiver')` resolve at all
// instead of erroring as an untyped module; they intentionally stay `any`.
declare module 'archiver';
declare module 'archiver-zip-encrypted';
