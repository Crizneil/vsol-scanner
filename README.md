# VSOL Quick Scanner

A mobile-first, browser-only live barcode scanner for VSOL ONU labels. Point the phone's rear camera at a sticker to continuously decode its MAC address and device S/N. PON S/N values are ignored.

## Run locally

```sh
npm install
npm run dev
```

Open the `/index.source.html` path at the local Vite URL on the phone or computer and allow camera access. Camera access requires a secure context: use `localhost` for local development or HTTPS when deployed.

## Deploy

Build with `npm run build`, then publish the repository's `main` branch from the root directory with GitHub Pages. The build writes the compiled, self-contained app to `index.html` and `assets/`, so the project works at the GitHub Pages subpath. The app is hosted at `https://crizneil.github.io/vsol-scanner/`.

## Scanning and privacy

- ZXing decodes barcodes directly from the live camera stream; no photo or upload is needed.
- Barcode values identify MAC addresses and device serial numbers. `VSOL...` PON S/N values are ignored.
- If a barcode cannot be classified by its value, the scanner attempts to associate it with a nearby printed label using OCR. You can also choose **USE OCR** to read the current live frame.
- Scan history is stored in this browser's local storage. It is not sent to an application backend.
- **COPY ALL** creates tab-separated MAC/S/N rows for Google Sheets.
