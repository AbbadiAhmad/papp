"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LibraryCirculationModule = void 0;
const common_1 = require("@nestjs/common");
// The REAL core module/service, imported from apps/api's BUILT output
// (D57/D64 exception category — not @Global(), so it must be imported
// explicitly). This is the ONLY file in this module allowed to import from
// `apps/api/dist/...` for notifications — see `notifications-sender.ts`'s
// own docblock for why `circulation.service.ts`/`fines.service.ts`
// themselves must NOT (breaks their Jest unit tests, root D68 item 3).
// eslint-disable-next-line import/no-unresolved
const notifications_module_1 = require("../../../apps/api/dist/core/notifications/notifications.module");
// eslint-disable-next-line import/no-unresolved
const notifications_service_1 = require("../../../apps/api/dist/core/notifications/notifications.service");
const circulation_controller_1 = require("./circulation.controller");
const circulation_service_1 = require("./circulation.service");
const dashboard_controller_1 = require("./dashboard.controller");
const fines_controller_1 = require("./fines.controller");
const fines_service_1 = require("./fines.service");
const notifications_sender_1 = require("./notifications-sender");
const settings_controller_1 = require("./settings.controller");
const settings_service_1 = require("./settings.service");
const students_controller_1 = require("./students.controller");
const students_service_1 = require("./students.service");
/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`library-circulation.module.js`, via this module's own
 * `tsconfig.json`) — same pattern as every other module, see
 * `modules/template/backend/template.module.ts`'s own docblock.
 */
let LibraryCirculationModule = class LibraryCirculationModule {
};
exports.LibraryCirculationModule = LibraryCirculationModule;
exports.LibraryCirculationModule = LibraryCirculationModule = __decorate([
    (0, common_1.Module)({
        imports: [notifications_module_1.NotificationsModule],
        controllers: [students_controller_1.StudentsController, circulation_controller_1.CirculationController, fines_controller_1.FinesController, settings_controller_1.SettingsController, dashboard_controller_1.DashboardController],
        providers: [
            students_service_1.StudentsService,
            circulation_service_1.CirculationService,
            fines_service_1.FinesService,
            settings_service_1.SettingsService,
            { provide: notifications_sender_1.NOTIFICATIONS_SENDER, useExisting: notifications_service_1.NotificationsService },
        ],
    })
], LibraryCirculationModule);
