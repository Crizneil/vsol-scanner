import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
    base: './',
    build: {
        rollupOptions: {
            input: {
                index: resolve(process.cwd(), 'index.source.html'),
            },
        },
    },
});
