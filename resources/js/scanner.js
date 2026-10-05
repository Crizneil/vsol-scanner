import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { createWorker } from 'tesseract.js';

const STORAGE_KEY = 'vsol-quick-scanner.records.v1';
const COOLDOWN_MS = 1500;
const video = document.querySelector('#camera-preview');
const videoWrap = document.querySelector('#video-wrap');
const scanButton = document.querySelector('#scan-button');
const ocrButton = document.querySelector('#ocr-button');
const autoAdd = document.querySelector('#auto-add');
const cameraStatus = document.querySelector('#camera-status');
const liveBadge = document.querySelector('#live-badge');
const captureState = document.querySelector('#capture-state');
const macValue = document.querySelector('#mac-value');
const serialValue = document.querySelector('#serial-value');
const candidatePanel = document.querySelector('#candidate-panel');
const candidateValue = document.querySelector('#candidate-value');
const candidateMessage = document.querySelector('#candidate-message');
const inlineMessage = document.querySelector('#inline-message');
const addButton = document.querySelector('#add-button');
const candidateButtons = document.querySelectorAll('.candidate-actions button');
const recordsBody = document.querySelector('#records-body');
const recordCount = document.querySelector('#record-count');
const emptyState = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');

const reader = new BrowserMultiFormatReader(new Map([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.ITF, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417, BarcodeFormat.CODE_93, BarcodeFormat.CODABAR, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
]));

let cameraControls = null;
let ocrWorker = null;
let ocrWorkerPromise = null;
let toastTimer = null;
let resetTimer = null;
let processingBarcode = false;
let lastProcessedText = '';
let cooldownUntil = 0;
let recentlyAddedBarcodeValues = new Set();
let lastBlockedBarcode = '';
let records = loadRecords();
let current = { mac: '', serial: '' };
let candidate = null;

function loadRecords() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        if (!Array.isArray(stored)) throw new Error('Saved scan history has an invalid format.');
        return stored.filter((record) =>
            record && typeof record.mac === 'string' && typeof record.serial === 'string'
            && /^[0-9A-F]{12}$/.test(record.mac) && /^V[A-Z0-9]+$/.test(record.serial)
            && !/^VSOL/i.test(record.serial));
    } catch (error) {
        window.setTimeout(() => showToast(`Could not read saved scans: ${error.message}`, true), 0);
        return [];
    }
}

function persistRecords() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
        return true;
    } catch (error) {
        showToast(`Could not save scans to this device: ${error.message}`, true);
        return false;
    }
}

function renderRecords() {
    recordsBody.replaceChildren();
    for (const [index, record] of records.entries()) {
        const row = document.createElement('tr');
        for (const value of [String(index + 1), record.mac, record.serial]) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
        }
        recordsBody.append(row);
    }
    recordCount.textContent = String(records.length);
    emptyState.hidden = records.length > 0;
}

function showToast(message, isError = false) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle('is-error', isError);
    toast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2300);
}

function setCameraStatus(message, isError = false) {
    cameraStatus.textContent = message;
    cameraStatus.classList.toggle('is-error', isError);
}

function updateCapture() {
    macValue.textContent = current.mac || '—';
    serialValue.textContent = current.serial || '—';
    addButton.disabled = !current.mac || !current.serial;
    captureState.textContent = current.mac && current.serial ? 'READY TO ADD' : current.mac || current.serial ? 'PARTIAL' : 'WAITING';
}

function clearCurrent() {
    current = { mac: '', serial: '' };
    candidate = null;
    candidatePanel.hidden = true;
    inlineMessage.textContent = '';
    inlineMessage.className = 'inline-message';
    updateCapture();
}

function normalizeValue(value) {
    return value.trim().replace(/[\s:.-]/g, '').toUpperCase();
}

function valueType(value) {
    const normalized = normalizeValue(value);
    if (/^VSOL/i.test(normalized)) return 'ignore';
    if (/^[0-9A-F]{12}$/.test(normalized)) return 'mac';
    if (/^V[A-Z0-9]{1,23}$/.test(normalized)) return 'serial';
    return null;
}

function videoSnapshot() {
    if (!video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
}

async function getOcrWorker() {
    if (!ocrWorkerPromise) {
        ocrWorkerPromise = createWorker('eng').then((worker) => {
            ocrWorker = worker;
            return worker;
        }).catch((error) => {
            ocrWorkerPromise = null;
            throw error;
        });
    }
    return ocrWorkerPromise;
}

function barcodeCenter(result, canvas) {
    const points = result.getResultPoints?.() || [];
    if (!points.length || !video.videoWidth || !video.videoHeight) return null;
    const center = points.reduce((total, point) => ({
        x: total.x + point.getX(),
        y: total.y + point.getY(),
    }), { x: 0, y: 0 });
    return {
        x: (center.x / points.length) * (canvas.width / video.videoWidth),
        y: (center.y / points.length) * (canvas.height / video.videoHeight),
    };
}

async function labelNearBarcode(result, canvas) {
    const center = barcodeCenter(result, canvas);
    if (!center) return null;
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(canvas);
    const labels = [];
    for (const line of data.lines || []) {
        const text = line.text.toUpperCase().replace(/[^A-Z/ ]/g, ' ').replace(/\s+/g, ' ').trim();
        const type = /PON\s*\/?\s*S\s*\/?\s*N/.test(text) ? 'ignore'
            : /\bMAC\b/.test(text) ? 'mac'
                : /(^|\s)S\s*\/?\s*N($|\s)/.test(text) ? 'serial' : null;
        if (!type) continue;
        const box = line.bbox;
        const x = (box.x0 + box.x1) / 2;
        const y = (box.y0 + box.y1) / 2;
        labels.push({ type, distance: Math.hypot((center.x - x) / canvas.width, (center.y - y) / canvas.height) });
    }
    labels.sort((a, b) => a.distance - b.distance);
    return labels[0] && labels[0].distance < 0.2 ? labels[0].type : null;
}

function assignValue(type, value) {
    const normalized = normalizeValue(value);
    if (type === 'ignore') {
        inlineMessage.textContent = 'PON S/N barcode ignored.';
        inlineMessage.className = 'inline-message';
        return;
    }
    if (type === 'mac') {
        if (!/^[0-9A-F]{12}$/.test(normalized)) {
            showCandidate(normalized, 'This barcode is not a 12-character MAC address.');
            return;
        }
        current.mac = normalized;
    } else if (type === 'serial') {
        if (!/^V[A-Z0-9]{1,23}$/.test(normalized) || /^VSOL/i.test(normalized)) {
            if (/^VSOL/i.test(normalized)) {
                inlineMessage.textContent = 'PON S/N barcode ignored.';
                inlineMessage.className = 'inline-message';
            } else {
                showCandidate(normalized, 'This barcode does not look like a VSOL device S/N.');
            }
            return;
        }
        current.serial = normalized;
    }
    candidate = null;
    candidatePanel.hidden = true;
    inlineMessage.textContent = `${type === 'mac' ? 'MAC' : 'S/N'} detected.`;
    inlineMessage.className = 'inline-message is-success';
    updateCapture();
    if (current.mac && current.serial && autoAdd.checked) addRecord(true);
}

function showCandidate(value, message = 'Barcode label unclear. Select its type, or ignore it.') {
    candidate = value;
    candidateValue.textContent = value;
    candidateMessage.textContent = message;
    candidatePanel.hidden = false;
    inlineMessage.textContent = 'Barcode decoded. Confirm its label before saving.';
    inlineMessage.className = 'inline-message';
}

async function processBarcode(result) {
    const text = result.getText().trim();
    const normalized = normalizeValue(text);
    if (!normalized) return;
    if (recentlyAddedBarcodeValues.has(normalized)) {
        if (lastBlockedBarcode !== normalized) {
            setCameraStatus('Already scanned. Aim at the next ONU barcode.');
            lastBlockedBarcode = normalized;
        }
        return;
    }
    if (recentlyAddedBarcodeValues.size && valueType(text) !== 'ignore') {
        recentlyAddedBarcodeValues.clear();
        lastBlockedBarcode = '';
    }
    if (processingBarcode || normalized === lastProcessedText) return;
    processingBarcode = true;
    lastProcessedText = normalized;
    window.clearTimeout(resetTimer);
    setCameraStatus(`Decoded ${text} — identifying barcode…`);
    showCandidate(text, 'Decoded live from the camera. Checking the printed label…');
    candidateButtons.forEach((button) => { button.disabled = true; });
    const previousRecordCount = records.length;
    let labelOcrFailed = false;

    try {
        let type = valueType(text);
        if (!type) {
            const snapshot = videoSnapshot();
            if (snapshot) {
                try {
                    type = await labelNearBarcode(result, snapshot);
                } catch (error) {
                    console.warn('Barcode label OCR unavailable; using barcode value format.', error);
                    labelOcrFailed = true;
                }
            }
        }
        if (type === 'ignore') {
            candidatePanel.hidden = true;
            assignValue('ignore', text);
            setCameraStatus('PON S/N ignored. Keep aiming at the MAC or device S/N barcode.');
        } else if (type) {
            candidatePanel.hidden = true;
            assignValue(type, text);
            setCameraStatus(records.length > previousRecordCount
                ? 'Saved. Camera is still live — scan the next device.'
                : labelOcrFailed
                    ? 'Label OCR unavailable. Barcode needs manual classification.'
                    : current.mac && current.serial
                        ? 'Both device values detected.'
                        : 'Keep aiming at the other device barcode.');
        } else {
            showCandidate(text, labelOcrFailed
                ? 'Printed label could not be read. Select MAC, S/N, or IGNORE.'
                : undefined);
            setCameraStatus(labelOcrFailed
                ? 'Barcode decoded, but label OCR failed. Choose its type or ignore it.'
                : 'Barcode decoded. Choose MAC, S/N, or IGNORE.');
        }
    } finally {
        processingBarcode = false;
        candidateButtons.forEach((button) => { button.disabled = false; });
        if (!autoAdd.checked) {
            resetTimer = window.setTimeout(() => { lastProcessedText = ''; }, COOLDOWN_MS);
        }
    }
}

function hasDuplicate(mac, serial) {
    return records.some((record) => record.mac === mac || record.serial === serial);
}

function addRecord(automatic = false) {
    if (!current.mac || !current.serial) return;
    const mac = current.mac;
    const serial = current.serial;
    if (hasDuplicate(mac, serial)) {
        inlineMessage.textContent = 'Already scanned — duplicate MAC or S/N.';
        inlineMessage.className = 'inline-message is-error';
        showToast('Already scanned', true);
        clearCurrent();
        lastProcessedText = '';
        return;
    }
    const nextRecords = [...records, { mac, serial }];
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
    } catch (error) {
        inlineMessage.textContent = `Could not save scans to this device: ${error.message}`;
        inlineMessage.className = 'inline-message is-error';
        showToast('Could not save scan to this device', true);
        return;
    }
    records = nextRecords;
    renderRecords();
    clearCurrent();
    recentlyAddedBarcodeValues = new Set([mac, serial]);
    lastBlockedBarcode = '';
    cooldownUntil = Date.now() + COOLDOWN_MS;
    lastProcessedText = '';
    setCameraStatus('Saved. Camera is still live — scan the next device.');
    if (automatic) {
        showToast(`ADDED #${records.length}`);
        liveBadge.lastChild.textContent = ` ADDED #${records.length}`;
        liveBadge.classList.add('is-live');
        window.setTimeout(() => { liveBadge.lastChild.textContent = ' LIVE'; }, 1700);
    } else {
        showToast(`Added device #${records.length}`);
    }
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => { lastProcessedText = ''; }, COOLDOWN_MS);
}

async function startCamera() {
    if (cameraControls) return;
    scanButton.disabled = true;
    scanButton.querySelector('span:last-child').textContent = 'OPENING CAMERA…';
    setCameraStatus('Requesting camera permission…');
    try {
        cameraControls = await reader.decodeFromConstraints({
            audio: false,
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 },
            },
        }, video, (result) => {
            if (result && Date.now() >= cooldownUntil) void processBarcode(result);
        });
        await video.play();
        videoWrap.classList.add('is-active');
        liveBadge.classList.add('is-live');
        liveBadge.querySelector('span').setAttribute('aria-hidden', 'true');
        liveBadge.lastChild.textContent = ' LIVE';
        ocrButton.disabled = false;
        scanButton.querySelector('span:last-child').textContent = 'CAMERA LIVE';
        scanButton.disabled = false;
        setCameraStatus('Camera is live. Point it at one barcode at a time.');
    } catch (error) {
        cameraControls?.stop();
        cameraControls = null;
        video.srcObject?.getTracks().forEach((track) => track.stop());
        scanButton.disabled = false;
        scanButton.querySelector('span:last-child').textContent = 'SCAN';
        setCameraStatus('Camera access is required. Please allow camera access in Safari/Chrome settings.', true);
        showToast(error.name === 'NotAllowedError'
            ? 'Camera access is required. Please allow camera access in Safari/Chrome settings.'
            : `Could not start the camera: ${error.message}`, true);
    }
}

async function runOcrFallback() {
    if (!cameraControls) {
        showToast('Start the live camera before using OCR.', true);
        return;
    }
    ocrButton.disabled = true;
    ocrButton.textContent = 'READING…';
    setCameraStatus('OCR fallback is reading the current live camera frame…');
    try {
        const snapshot = videoSnapshot();
        if (!snapshot) throw new Error('The camera frame is not ready yet.');
        const worker = await getOcrWorker();
        const { data } = await worker.recognize(snapshot);
        const text = data.text.toUpperCase().replace(/\s/g, '');
        const macMatch = text.match(/(?:MAC[:]?)([0-9A-F]{12})/) || text.match(/\b([0-9A-F]{12})\b/);
        const safeText = text.replace(/PONS\/?N[A-Z0-9]*/g, '');
        const serialMatch = safeText.match(/(?:S\/?N[:]?)(V[A-Z0-9]{2,24})/) || safeText.match(/\b(V[A-Z0-9]{2,24})\b/);
        const serial = serialMatch?.[1] && !/^VSOL/i.test(serialMatch[1]) ? serialMatch[1] : '';
        if (macMatch?.[1]) assignValue('mac', macMatch[1]);
        if (serial) assignValue('serial', serial);
        if (!macMatch && !serial) {
            showCandidate('', 'OCR found no safe MAC or device S/N. PON S/N values are never accepted.');
            candidateValue.textContent = 'No safe value found';
        }
        setCameraStatus('OCR fallback complete. Review detected values before adding.');
    } catch (error) {
        showToast(`OCR could not read the camera frame: ${error.message}`, true);
        setCameraStatus('OCR fallback failed. Keep scanning barcodes or try again.', true);
    } finally {
        ocrButton.disabled = false;
        ocrButton.textContent = 'USE OCR';
    }
}

scanButton.addEventListener('click', () => {
    if (cameraControls) {
        setCameraStatus('Camera remains live. Aim at the next barcode.');
        return;
    }
    void startCamera();
});
addButton.addEventListener('click', () => addRecord(false));
ocrButton.addEventListener('click', () => void runOcrFallback());

document.querySelectorAll('[data-candidate]').forEach((button) => {
    button.addEventListener('click', () => {
        if (button.dataset.candidate === 'ignore') {
            candidatePanel.hidden = true;
            inlineMessage.textContent = 'Barcode ignored.';
            inlineMessage.className = 'inline-message';
            candidate = null;
        } else {
            const type = button.dataset.candidate;
            assignValue(type, candidate || '');
        }
        lastProcessedText = '';
    });
});

document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
        if (!records.length) {
            showToast('No scanned devices to copy.', true);
            return;
        }
        const type = button.dataset.copy;
        const text = type === 'all'
            ? ['MAC\tS/N', ...records.map((record) => `${record.mac}\t${record.serial}`)].join('\n')
            : records.map((record) => type === 'mac' ? record.mac : record.serial).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            showToast(type === 'all' ? 'All scans copied for Google Sheets.' : `${type === 'mac' ? 'MAC' : 'S/N'} values copied.`);
        } catch (error) {
            showToast(`Could not access clipboard: ${error.message}`, true);
        }
    });
});

document.querySelector('#clear-button').addEventListener('click', () => {
    if (!records.length || !window.confirm('Clear all locally saved scans? This cannot be undone.')) return;
    const previous = records;
    records = [];
    if (!persistRecords()) {
        records = previous;
        return;
    }
    renderRecords();
    showToast('All scans cleared.');
});

renderRecords();
updateCapture();
