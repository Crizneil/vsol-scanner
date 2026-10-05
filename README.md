# VSOL Quick Scanner

A mobile-first, browser-only live label scanner for VSOL ONU labels. Point the phone's rear camera at the whole sticker to continuously OCR its printed MAC address and device S/N together. PON S/N values are ignored.

## Run locally

```sh
npm install
npm run dev
```

Open the `/index.source.html` path at the local Vite URL on the phone or computer and allow camera access. Camera access requires a secure context: use `localhost` for local development or HTTPS when deployed.

## Deploy

Build with `npm run build`, then publish the repository's `main` branch from the root directory with GitHub Pages. The build writes the compiled, self-contained app to `index.html` and `assets/`, so the project works at the GitHub Pages subpath. The app is hosted at `https://crizneil.github.io/vsol-scanner/`.

## Scanning and privacy

- Tesseract OCR reads the printed MAC and device S/N from each live camera frame; no photo or upload is needed.
- ZXing continuously decodes barcodes from the same live camera as an additional scanning method.
- OCR associates the printed values with the nearby MAC and S/N labels, and rejects `VSOL...` PON S/N values.
- **READ LABEL NOW** immediately OCRs the current camera frame.
- Scan history is stored in this browser's local storage. It is not sent to an application backend.
- **COPY ALL** creates tab-separated MAC/S/N rows for Google Sheets.
