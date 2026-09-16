"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SurveyModule = void 0;
const common_1 = require("@nestjs/common");
// The REAL core module, imported from apps/api's BUILT output (D57/D64
// exception category — see responses.service.ts's own import docblock).
// NOT `@Global()`, so it must be imported explicitly to make
// `NotificationsService`/`NotificationEmailService` injectable into
// ResponsesService.
// eslint-disable-next-line import/no-unresolved
const notifications_module_1 = require("../../../apps/api/dist/core/notifications/notifications.module");
const fill_controller_1 = require("./fill.controller");
const public_survey_controller_1 = require("./public-survey.controller");
const reports_service_1 = require("./reports.service");
const responses_controller_1 = require("./responses.controller");
const responses_service_1 = require("./responses.service");
const surveys_controller_1 = require("./surveys.controller");
const surveys_service_1 = require("./surveys.service");
/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`survey.module.js`, via this module's own `tsconfig.json`) —
 * see modules/library_catalog/backend/library-catalog.module.ts's docblock
 * for what `module-loader.ts` expects.
 */
let SurveyModule = class SurveyModule {
};
exports.SurveyModule = SurveyModule;
exports.SurveyModule = SurveyModule = __decorate([
    (0, common_1.Module)({
        imports: [notifications_module_1.NotificationsModule],
        controllers: [surveys_controller_1.SurveysController, fill_controller_1.FillController, public_survey_controller_1.PublicSurveyController, responses_controller_1.ResponsesController],
        providers: [surveys_service_1.SurveysService, responses_service_1.ResponsesService, reports_service_1.ReportsService],
    })
], SurveyModule);
