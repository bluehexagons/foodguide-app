import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'app/foodguide/html/icon.png');

export async function generateAssets() {
  const { stdout } = await promisify(execFile)(process.execPath, [
    path.join(root, 'app/foodguide/scripts/generate-sprites.js'),
  ]);
  console.log(stdout.trim());

  const directory = path.join(root, '.generated');
  await mkdir(directory, { recursive: true });
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map(size => sharp(source).resize(size, size, { kernel: 'nearest' }).png().toBuffer()),
  );
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); // ICO, followed by the number of PNG entries.
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (const [index, image] of images.entries()) {
    const position = 6 + 16 * index;
    header[position] = sizes[index] === 256 ? 0 : sizes[index];
    header[position + 1] = header[position];
    header.writeUInt16LE(1, position + 4);
    header.writeUInt16LE(32, position + 6);
    header.writeUInt32LE(image.length, position + 8);
    header.writeUInt32LE(offset, position + 12);
    offset += image.length;
  }
  await writeFile(path.join(directory, 'icon.ico'), Buffer.concat([header, ...images]));

  // ICNS supports PNG representations. Use the guide's existing artwork.
  const icnsImage = await sharp(source).resize(512, 512, { kernel: 'nearest' }).png().toBuffer();
  const icnsHeader = Buffer.alloc(16);
  icnsHeader.write('icns');
  icnsHeader.writeUInt32BE(16 + icnsImage.length, 4);
  icnsHeader.write('ic09', 8);
  icnsHeader.writeUInt32BE(8 + icnsImage.length, 12);
  await writeFile(path.join(directory, 'icon.icns'), Buffer.concat([icnsHeader, icnsImage]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  await generateAssets();
}
