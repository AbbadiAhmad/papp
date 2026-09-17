"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplateModule = void 0;
const common_1 = require("@nestjs/common");
const items_controller_1 = require("./items.controller");
const items_service_1 = require("./items.service");
const public_items_controller_1 = require("./public-items.controller");
const settings_controller_1 = require("./settings.controller");
const settings_service_1 = require("./settings.service");
/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`template.module.js`, via this module's own `tsconfig.json`) —
 * see modules/library_catalog/backend/library-catalog.module.ts's docblock
 * for what `module-loader.ts` expects. Deliberately imports NOTHING from
 * another core module (no `NotificationsModule`, unlike `survey`) — most
 * modules don't need cross-module notification wiring; see `survey`'s own
 * `survey.module.ts`/DOCUMENTATION.md if yours does.
 */
let TemplateModule = class TemplateModule {
};
exports.TemplateModule = TemplateModule;
exports.TemplateModule = TemplateModule = __decorate([
    (0, common_1.Module)({
        controllers: [items_controller_1.ItemsController, public_items_controller_1.PublicItemsController, settings_controller_1.SettingsController],
        providers: [items_service_1.ItemsService, settings_service_1.SettingsService],
    })
], TemplateModule);
