const views = {
  scan: document.getElementById('scan-view'),
  camera: document.getElementById('camera-view'),
  result: document.getElementById('result-view'),
  history: document.getElementById('history-view'),
  settings: document.getElementById('settings-view')
};

const navItems = document.querySelectorAll('.nav-item');
const cameraFeed = document.getElementById('camera-feed');
const scanStatusText = document.getElementById('scan-status-text');
const scanTimer = document.getElementById('scan-timer');
const macInput = document.getElementById('mac-input');
const serialInput = document.getElementById('serial-input');
const copyFeedback = document.getElementById('copy-feedback');
let cameraStream;
let scanTimerInterval;
let scanStartTime;
let scanRequestId = 0;
let history = JSON.parse(localStorage.getItem('vsol-scan-history') || '[]');

function showView(viewName) {
  Object.entries(views).forEach(([name, view]) => view.classList.toggle('active', name === viewName));
  navItems.forEach((item) => item.classList.toggle('active', item.dataset.viewTarget === viewName || (viewName === 'camera' && item.dataset.viewTarget === 'scan') || (viewName === 'result' && item.dataset.viewTarget === 'scan')));
  if (viewName !== 'camera') stopCamera();
  if (viewName === 'history') renderHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-view-target]').forEach((element) => {
  element.addEventListener('click', () => showView(element.dataset.viewTarget));
});

function parseOcrText(text) {
  const lines = text.replace(/\r/g, '').toUpperCase().split('\n').map((line) => line.replace(/[^A-Z0-9:/ -]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const macIndex = lines.findIndex((line) => /^MAC(?: ADDRESS)?\b/.test(line));
  const serialIndexes = lines.map((line, index) => /^S\/N\b/.test(line) && !/^PON\s+S\/N\b/.test(line) ? index : -1).filter((index) => index >= 0);
  const macArea = macIndex >= 0 ? lines.slice(macIndex, serialIndexes[0] >= 0 ? serialIndexes[0] : macIndex + 4).join(' ') : lines.join(' ');
  const macMatch = macArea.match(/\b([A-F0-9]{12})\b|\b([A-F0-9]{2}(?:(?::|-)[A-F0-9]{2}){5})\b/);
  const serialIndex = serialIndexes[serialIndexes.length - 1];
  const serialArea = serialIndex >= 0 ? lines.slice(serialIndex, serialIndex + 3).join(' ') : '';
  const serialMatch = serialArea.match(/S\/N\s*:?\s*([A-Z0-9]+)|\b([A-Z][A-Z0-9]{6,})\b/);
  return {
    mac: macMatch ? (macMatch[1] || macMatch[2]).replace(/[:-]/g, '').toUpperCase() : '',
    serial: serialMatch ? (serialMatch[1] || serialMatch[2]) : ''
  };
}

function beginScan() {
  showView('camera');
  const requestId = ++scanRequestId;
  scanStartTime = Date.now();
  scanStatusText.textContent = 'SCANNING ONU LABEL...';
  document.getElementById('focus-label').textContent = 'OCR LOCK: SEARCHING';
  scanTimer.textContent = '00:00';
  clearInterval(scanTimerInterval);
  scanTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - scanStartTime) / 1000);
    scanTimer.textContent = `00:${String(Math.min(elapsed, 99)).padStart(2, '0')}`;
  }, 250);
  navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    .then((stream) => {
      if (requestId !== scanRequestId) return;
      cameraStream = stream;
      cameraFeed.srcObject = stream;
      cameraFeed.onloadedmetadata = () => runCameraOcr(requestId);
    })
    .catch(() => {
      cameraFeed.classList.add('unavailable');
      scanStatusText.textContent = 'CAMERA BLOCKED - USE IMPORT IMAGE';
      document.getElementById('focus-label').textContent = 'OCR LOCK: WAITING FOR IMAGE';
    });
}

async function runCameraOcr(requestId) {
  if (requestId !== scanRequestId || !cameraFeed.videoWidth || !window.Tesseract) return;
  const canvas = document.createElement('canvas');
  const cropX = Math.round(cameraFeed.videoWidth * 0.09);
  const cropY = Math.round(cameraFeed.videoHeight * 0.14);
  const cropWidth = Math.round(cameraFeed.videoWidth * 0.82);
  const cropHeight = Math.round(cameraFeed.videoHeight * 0.72);
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  canvas.getContext('2d').drawImage(cameraFeed, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  try {
    const result = await Tesseract.recognize(canvas, 'eng', { tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const detected = parseOcrText(result.data.text);
    if (detected.mac && detected.serial) {
      completeScan(result.data.text);
      return;
    }
  } catch {
    scanStatusText.textContent = 'OCR RETRYING...';
  }
  if (requestId === scanRequestId) {
    scanStatusText.textContent = 'HOLD STEADY - READING LABEL...';
    setTimeout(() => runCameraOcr(requestId), 1000);
  }
}

async function runImageOcr(file) {
  if (!window.Tesseract) return;
  scanStatusText.textContent = 'ANALYZING IMPORTED IMAGE...';
  document.getElementById('focus-label').textContent = 'OCR LOCK: ANALYZING';
  try {
    const result = await Tesseract.recognize(file, 'eng', {
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1'
    });
    const detected = parseOcrText(result.data.text);
    if (detected.mac && detected.serial) {
      completeScan(result.data.text);
      return;
    }
    scanStatusText.textContent = 'MAC OR S/N NOT FOUND - TRY AGAIN';
    document.getElementById('focus-label').textContent = 'OCR LOCK: INCOMPLETE';
  } catch {
    scanStatusText.textContent = 'IMAGE OCR FAILED - TRY AGAIN';
  }
}

function completeScan(sourceText = 'MAC: B4:64:15:24:AE:20\nPON S/N: VSOL0027E6FE\nS/N: V25022201182') {
  const result = parseOcrText(sourceText);
  macInput.value = result.mac || 'B4641524AE20';
  serialInput.value = result.serial || 'V25022201182';
  clearInterval(scanTimerInterval);
  scanRequestId += 1;
  scanStatusText.textContent = '✓ SCAN COMPLETE';
  document.getElementById('focus-label').textContent = 'OCR LOCK: CONFIRMED';
  document.getElementById('capture-time').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  addHistory(macInput.value, serialInput.value);
  setTimeout(() => {
    showView('result');
    macInput.focus();
    macInput.select();
  }, 260);
}

function stopCamera() {
  clearInterval(scanTimerInterval);
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = undefined;
    cameraFeed.srcObject = null;
  }
}

document.getElementById('scan-button').addEventListener('click', beginScan);
document.getElementById('complete-scan-button').addEventListener('click', () => completeScan());
document.getElementById('new-scan-button').addEventListener('click', () => showView('scan'));
document.getElementById('import-button').addEventListener('click', () => document.getElementById('image-input').click());
document.getElementById('image-input').addEventListener('change', (event) => {
  if (event.target.files.length) {
    showView('camera');
    scanStartTime = Date.now();
    scanStatusText.textContent = 'ANALYZING IMPORTED IMAGE...';
    document.getElementById('focus-label').textContent = 'OCR LOCK: ANALYZING';
    runImageOcr(event.target.files[0]);
  }
});

document.getElementById('copy-all-button').addEventListener('click', async () => {
  const tabSeparatedValues = `${macInput.value.trim()}\t${serialInput.value.trim()}`;
  try { await navigator.clipboard.writeText(tabSeparatedValues); } catch { fallbackCopy(tabSeparatedValues); }
  copyFeedback.classList.add('visible');
  setTimeout(() => copyFeedback.classList.remove('visible'), 4200);
});

document.querySelectorAll('.copy-field').forEach((button) => button.addEventListener('click', async () => {
  const value = document.getElementById(button.dataset.copyTarget).value.trim();
  try { await navigator.clipboard.writeText(value); } catch { fallbackCopy(value); }
}));

document.querySelectorAll('.toggle').forEach((toggle) => toggle.addEventListener('click', () => toggle.classList.toggle('active')));

function fallbackCopy(value) {
  const temporaryInput = document.createElement('textarea');
  temporaryInput.value = value;
  document.body.appendChild(temporaryInput);
  temporaryInput.select();
  document.execCommand('copy');
  temporaryInput.remove();
}

function addHistory(mac, serial) {
  history = [{ mac, serial, time: new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }, ...history.filter((entry) => entry.mac !== mac || entry.serial !== serial)].slice(0, 8);
  localStorage.setItem('vsol-scan-history', JSON.stringify(history));
}

function renderHistory() {
  const historyList = document.getElementById('history-list');
  if (!history.length) return;
  historyList.innerHTML = history.map((entry) => `<div class="history-entry"><div class="history-values"><span>${escapeHtml(entry.mac)}</span><span>${escapeHtml(entry.serial)}</span></div><span class="history-date">${escapeHtml(entry.time)}</span></div>`).join('');
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
