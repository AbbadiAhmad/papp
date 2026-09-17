"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsiteModule = void 0;
const common_1 = require("@nestjs/common");
const menus_controller_1 = require("./menus.controller");
const menus_service_1 = require("./menus.service");
const pages_controller_1 = require("./pages.controller");
const pages_service_1 = require("./pages.service");
const public_controller_1 = require("./public.controller");
const settings_controller_1 = require("./settings.controller");
const settings_service_1 = require("./settings.service");
/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`website.module.js`, via this module's own `tsconfig.json`) —
 * same pattern as every other module.
 */
let WebsiteModule = class WebsiteModule {
};
exports.WebsiteModule = WebsiteModule;
exports.WebsiteModule = WebsiteModule = __decorate([
    (0, common_1.Module)({
        controllers: [pages_controller_1.PagesController, menus_controller_1.MenusController, settings_controller_1.SettingsController, public_controller_1.PublicController],
        providers: [pages_service_1.PagesService, menus_service_1.MenusService, settings_service_1.SettingsService],
    })
], WebsiteModule);
