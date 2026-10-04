"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LibraryCatalogModule = void 0;
const common_1 = require("@nestjs/common");
const books_controller_1 = require("./books.controller");
const books_service_1 = require("./books.service");
const public_controller_1 = require("./public.controller");
const settings_controller_1 = require("./settings.controller");
const settings_service_1 = require("./settings.service");
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
let LibraryCatalogModule = class LibraryCatalogModule {
};
exports.LibraryCatalogModule = LibraryCatalogModule;
exports.LibraryCatalogModule = LibraryCatalogModule = __decorate([
    (0, common_1.Module)({
        controllers: [public_controller_1.PublicBooksController, books_controller_1.BooksController, settings_controller_1.SettingsController],
        providers: [books_service_1.BooksService, settings_service_1.SettingsService],
    })
], LibraryCatalogModule);
