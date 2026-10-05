const MAC_PATTERN = /^[0-9A-F]{12}$/;
const SERIAL_PATTERN = /^V[A-Z0-9]{6,24}$/;
const MAX_LABEL_GAP = 0.16;

function normalizeText(value) {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function getOcrLines(blocks) {
    return (blocks || []).flatMap((block) =>
        (block.paragraphs || []).flatMap((paragraph) =>
            (paragraph.lines || []).map((line) => ({
                text: line.text,
                normalized: normalizeText(line.text),
                bbox: line.bbox,
            }))));
}

export function extractVsolLabelValues(blocks, frameHeight) {
    const lines = getOcrLines(blocks);
    const macCandidates = lines
        .map((line) => ({ ...line, value: line.normalized.match(/[0-9A-F]{12}/)?.[0] }))
        .filter((line) => line.value && MAC_PATTERN.test(line.value));
    const mac = macCandidates.length === 1 ? macCandidates[0].value : '';

    const serialLabels = lines
        .filter((line) => line.normalized.startsWith('SN') && !line.normalized.startsWith('PON'))
        .sort((first, second) => first.bbox.y0 - second.bbox.y0);
    const ponLabels = lines
        .filter((line) => line.normalized.startsWith('PON'))
        .sort((first, second) => first.bbox.y0 - second.bbox.y0);
    const serialCandidates = lines.flatMap((line) => {
        const match = line.normalized.match(/V[A-Z0-9]{6,24}/);
        if (!match || !SERIAL_PATTERN.test(match[0]) || match[0].startsWith('VSOL')) return [];
        return [{ ...line, value: match[0] }];
    });

    const serialMatches = serialCandidates.filter((candidate) => {
        const label = serialLabels
            .filter((entry) => entry.bbox.y0 <= candidate.bbox.y0)
            .at(-1);
        if (!label) return false;
        const gap = Math.max(0, candidate.bbox.y0 - label.bbox.y1);
        if (gap > frameHeight * MAX_LABEL_GAP) return false;
        const labelCenter = (label.bbox.x0 + label.bbox.x1) / 2;
        const valueCenter = (candidate.bbox.x0 + candidate.bbox.x1) / 2;
        if (Math.abs(labelCenter - valueCenter) > frameHeight * 0.5) return false;
        const ponLabel = ponLabels
            .filter((entry) => entry.bbox.y0 <= candidate.bbox.y0)
            .at(-1);
        return !ponLabel || ponLabel.bbox.y0 < label.bbox.y0;
    });

    const serialValues = [...new Set(serialMatches.map((line) => line.value))];
    return {
        mac,
        serial: serialValues.length === 1 ? serialValues[0] : '',
    };
}
