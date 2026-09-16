import { Module } from '@nestjs/common';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';
import { PublicBooksController } from './public.controller';

/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`library-catalog.module.js`, via this module's own
 * `tsconfig.json`) — see `module-loader.ts`'s docblock for what it expects
 * (`await import(entryPath)`, then a default export or the first exported
 * function/class) and this module's `backend/platform.ts` for why a plain
 * compiled `.js` file, not the MODULE_SPEC.md illustrative example's literal
 * `.ts`, is what actually loads under plain Node.
 *
 * `PublicBooksController` is registered BEFORE `BooksController` only for
 * readability here — they own disjoint route prefixes
 * (`api/library/public/books` vs `api/library/books`) so registration order
 * between the two controllers themselves doesn't matter; ordering only
 * matters WITHIN `BooksController` (see its own docblock).
 */
@Module({
  controllers: [PublicBooksController, BooksController],
  providers: [BooksService],
})
export class LibraryCatalogModule {}
