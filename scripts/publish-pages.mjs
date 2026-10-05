import { readdir, mkdir, copyFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const publicAssets = join(root, 'assets');

await mkdir(publicAssets, { recursive: true });

for (const file of await readdir(publicAssets)) {
    if (/^index-[\w-]+\.(?:css|js)$/.test(file)) {
        await unlink(join(publicAssets, file));
    }
}

for (const file of await readdir(join(dist, 'assets'))) {
    if (!/^index-[\w-]+\.(?:css|js)$/.test(file)) {
        throw new Error(`Unexpected generated asset: ${file}`);
    }
    await copyFile(join(dist, 'assets', file), join(publicAssets, file));
}

await copyFile(join(dist, 'index.source.html'), join(root, 'index.html'));
