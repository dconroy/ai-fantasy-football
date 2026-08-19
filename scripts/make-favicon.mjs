import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = path.join(root, "image (14).png");
const appDir = path.join(root, "src", "app");

// The badge is 1024×1024; the helmet sits in the middle. Crop a square around
// it so the mark still reads at 16–32px instead of an unreadable full badge.
const CROP = { left: 300, top: 288, width: 412, height: 412 };

const helmet = sharp(await readFile(source))
  .extract(CROP)
  .png();

async function pngBuffer(size) {
  return helmet
    .clone()
    .resize(size, size, { fit: "cover" })
    .png()
    .toBuffer();
}

// App-router picks these up automatically and injects the <link> tags.
await writeFile(path.join(appDir, "icon.png"), await pngBuffer(512));
await writeFile(path.join(appDir, "apple-icon.png"), await pngBuffer(180));

// Build a real multi-size .ico that embeds PNGs (modern browsers read PNG-in-ICO).
const sizes = [16, 32, 48];
const images = await Promise.all(
  sizes.map(async (size) => ({ size, data: await pngBuffer(size) })),
);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

const entries = [];
let offset = 6 + images.length * 16;
for (const { size, data } of images) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += data.length;
}

const ico = Buffer.concat([
  header,
  ...entries,
  ...images.map((image) => image.data),
]);
await writeFile(path.join(appDir, "favicon.ico"), ico);

console.log(
  `Wrote icon.png, apple-icon.png, favicon.ico (${sizes.join("/")}) from the helmet crop.`,
);
