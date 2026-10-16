"use strict";
/**
 * Survey images (modules/survey/ROADMAP.md, phase D). Framework-free like the other rule files:
 * the server validates uploads with it (the reference shape, `parseImageRef`, lives in question-rules.ts
 * so the builder can share it).
 *
 * An image is referenced from three places — the survey header (`settings.headerImage`), a
 * section (`survey_sections.image`) and a question (`config.image`) — always as
 * `{ mediaId, alt }`. The bytes live in a disk volume (SURVEY-D18), never in the database.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_IMAGES_PER_SURVEY = exports.MAX_IMAGE_BYTES = void 0;
exports.detectImageMime = detectImageMime;
exports.extensionForMime = extensionForMime;
exports.mimeForExtension = mimeForExtension;
exports.validateImageUpload = validateImageUpload;
exports.collectMediaIds = collectMediaIds;
const question_rules_1 = require("./question-rules");
Object.defineProperty(exports, "MAX_IMAGE_BYTES", { enumerable: true, get: function () { return question_rules_1.MAX_IMAGE_BYTES; } });
exports.MAX_IMAGES_PER_SURVEY = 100;
/**
 * The type is decided from the file's own first bytes — never from the file name or the
 * browser-declared type, which a caller controls. SVG is deliberately not accepted (it can carry
 * scripts); only PNG, JPEG and WebP.
 */
function detectImageMime(bytes) {
    const at = (i) => bytes[i];
    if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) {
        return 'image/png';
    }
    if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff)
        return 'image/jpeg';
    if (bytes.length >= 12 &&
        at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && // RIFF
        at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50 // WEBP
    ) {
        return 'image/webp';
    }
    return null;
}
function extensionForMime(mime) {
    return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
}
function mimeForExtension(ext) {
    const e = ext.toLowerCase();
    return e === 'png' ? 'image/png' : e === 'jpg' || e === 'jpeg' ? 'image/jpeg' : e === 'webp' ? 'image/webp' : null;
}
/** English text of the first problem with an uploaded file, or null when it is acceptable. */
function validateImageUpload(bytes) {
    if (!bytes || bytes.length === 0)
        return { error: 'No image was uploaded' };
    if (bytes.length > question_rules_1.MAX_IMAGE_BYTES)
        return { error: `The image is too large (at most ${question_rules_1.MAX_IMAGE_BYTES / (1024 * 1024)} MB)` };
    const mime = detectImageMime(bytes);
    if (!mime)
        return { error: 'Only PNG, JPEG or WebP images are accepted' };
    return { mime };
}
/** Every media id referenced by a structure/settings tree (for ownership checks and cleanup). */
function collectMediaIds(parts) {
    const ids = new Set();
    const add = (v) => {
        const parsed = (0, question_rules_1.parseImageRef)(v);
        if ('ref' in parsed && parsed.ref)
            ids.add(parsed.ref.mediaId);
    };
    add(parts.headerImage);
    for (const s of parts.sections ?? []) {
        add(s.image);
        for (const q of s.questions ?? [])
            add(q.config?.image);
    }
    return [...ids];
}
