"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_INPUT_PIXELS = exports.THUMB_SIDE = void 0;
exports.thumbnailFor = thumbnailFor;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
/** Longest side of a thumbnail, in px (LIBRARY_CATALOG-D39). Big enough for a card at 2x density. */
exports.THUMB_SIDE = 400;
/**
 * Refuse to decode pictures larger than this many pixels (~40 MP; a phone photo is 12-50 MP). A 5 MB upload can
 * be a tiny compressed file that expands to billions of pixels ("decompression bomb"), and the thumbnail route is
 * public, so the decoder must never be allowed to allocate that. Such a picture is simply served as-is.
 */
exports.MAX_INPUT_PIXELS = 40_000_000;
/** At most this many thumbnails are being generated at once; the rest wait. Bounds CPU/memory on a public route. */
const MAX_PARALLEL = 2;
let running = 0;
const waiting = [];
/** Same picture requested many times at once (a page of cards, a refresh storm) is generated once. */
const inFlight = new Map();
async function slot(work) {
    if (running >= MAX_PARALLEL)
        await new Promise((resolve) => waiting.push(resolve));
    running += 1;
    try {
        return await work();
    }
    finally {
        running -= 1;
        waiting.shift()?.();
    }
}
/**
 * Returns the path of a small WebP copy of `original`, creating it on first use and caching it in a
 * `thumbs/` folder next to the picture. The cache name carries the original's size and mtime, so a
 * replaced picture gets a fresh thumbnail. Returns null whenever a thumbnail cannot be made (animated GIF,
 * oversize or unreadable file, sharp unavailable) — the caller then serves the original, so this never breaks a page.
 * `original` always comes from a database row, never from the request.
 */
async function thumbnailFor(original, mime) {
    if (mime === 'image/gif')
        return null; // may be animated; keep as is
    try {
        const stat = await fs_1.promises.stat(original);
        const dir = (0, path_1.join)((0, path_1.dirname)(original), 'thumbs');
        const name = `${(0, path_1.parse)(original).name}-${stat.size}-${Math.round(stat.mtimeMs)}.webp`;
        const target = (0, path_1.join)(dir, name);
        if (await fs_1.promises.stat(target).then((s) => s.isFile(), () => false))
            return target;
        const pending = inFlight.get(target) ?? slot(() => generate(original, dir, name, target)).finally(() => inFlight.delete(target));
        inFlight.set(target, pending);
        return await pending;
    }
    catch {
        return null;
    }
}
async function generate(original, dir, name, target) {
    const temp = (0, path_1.join)(dir, `${(0, crypto_1.randomUUID)()}.tmp`); // unique, so two workers can never write the same temp file
    try {
        const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
        await fs_1.promises.mkdir(dir, { recursive: true });
        await sharp(original, { failOn: 'error', limitInputPixels: exports.MAX_INPUT_PIXELS })
            .rotate() // honour the EXIF orientation of phone photos
            .resize({ width: exports.THUMB_SIDE, height: exports.THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 78 })
            .toFile(temp);
        await fs_1.promises.rename(temp, target);
        // Drop thumbnails of earlier versions of the same picture.
        const prefix = `${(0, path_1.parse)(original).name}-`;
        for (const file of await fs_1.promises.readdir(dir))
            if (file.startsWith(prefix) && file !== name && file.endsWith('.webp'))
                await fs_1.promises.rm((0, path_1.join)(dir, file), { force: true });
        return target;
    }
    catch {
        await fs_1.promises.rm(temp, { force: true });
        return null;
    }
}
