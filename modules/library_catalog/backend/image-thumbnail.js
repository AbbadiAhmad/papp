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
exports.THUMB_SIDE = void 0;
exports.thumbnailFor = thumbnailFor;
const fs_1 = require("fs");
const path_1 = require("path");
/** Longest side of a thumbnail, in px (LIBRARY_CATALOG-D39). Big enough for a card at 2x density. */
exports.THUMB_SIDE = 400;
/**
 * Returns the path of a small WebP copy of `original`, creating it on first use and caching it in a
 * `thumbs/` folder next to the picture. The cache name carries the original's size and mtime, so a
 * replaced picture gets a fresh thumbnail. Returns null whenever a thumbnail cannot be made (animated GIF,
 * unreadable file, sharp unavailable) — the caller then serves the original, so this never breaks a page.
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
        const sharp = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
        await fs_1.promises.mkdir(dir, { recursive: true });
        const temp = `${target}.${process.pid}.tmp`;
        await sharp(original, { failOn: 'none' })
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
        return null;
    }
}
