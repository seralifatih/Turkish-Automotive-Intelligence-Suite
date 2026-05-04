export type FuelType = 'benzin' | 'dizel' | 'lpg' | 'hybrid' | 'elektrik' | 'benzin_lpg';
export type TransmissionType = 'manuel' | 'otomatik' | 'yarı_otomatik';
export type BodyType =
  | 'sedan'
  | 'hatchback'
  | 'station_wagon'
  | 'suv'
  | 'coupe'
  | 'cabrio'
  | 'minivan'
  | 'pickup';

export interface PaintConditionResult {
  originalText: string;
  paintedPanels: number;
  replacedPanels: number;
  isOriginal: boolean;
}

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1970;

function parseTurkishInt(text: string): number | null {
  const clean = text.trim().replace(/\s+/g, '');
  if (!clean) return null;

  if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    return parseInt(clean.replace(/\./g, ''), 10);
  }

  if (/^\d+,\d+$/.test(clean)) {
    return null;
  }

  if (/^\d+$/.test(clean)) {
    return parseInt(clean, 10);
  }

  return null;
}

function normalizeLookupText(text: string): string {
  return text
    .trim()
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ');
}

function turkishLower(text: string): string {
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
}

export function parseMileage(text: string | null | undefined): number | null {
  if (!text) return null;

  const clean = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const withoutUnit = clean.replace(/\s*km\s*$/i, '').trim();
  if (!withoutUnit) return null;

  const turkishInt = parseTurkishInt(withoutUnit);
  if (turkishInt !== null) {
    return turkishInt === 0 ? null : turkishInt;
  }

  if (/^\d{1,3}(,\d{3})*$/.test(withoutUnit)) {
    const value = parseInt(withoutUnit.replace(/,/g, ''), 10);
    return value === 0 ? null : value;
  }

  if (/^\d+$/.test(withoutUnit)) {
    const value = parseInt(withoutUnit, 10);
    return value === 0 ? null : value;
  }

  return null;
}

export function parseEngineSize(text: string | null | undefined): number | null {
  if (!text) return null;

  const clean = text.trim().toLowerCase();

  const rangeMatch = clean.match(/^(\d+)\s*[-–]\s*(\d+)\s*(?:cc|cm3|cm\^3)?/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    return Math.round((lo + hi) / 2);
  }

  const ccMatch = clean.match(/^(\d+)\s*(?:cc|cm3|cm\^3)/);
  if (ccMatch) return parseInt(ccMatch[1], 10);

  const litreCommaMatch = clean.match(/^(\d+),(\d+)\s*[lL]/);
  if (litreCommaMatch) {
    return Math.round(parseFloat(`${litreCommaMatch[1]}.${litreCommaMatch[2]}`) * 1000);
  }

  const litreDotMatch = clean.match(/^(\d+)\.(\d+)\s*[lL]/);
  if (litreDotMatch) {
    return Math.round(parseFloat(`${litreDotMatch[1]}.${litreDotMatch[2]}`) * 1000);
  }

  const engineCodeMatch = clean.match(/^(\d+)\.(\d+)\s+[a-z]/);
  if (engineCodeMatch) {
    return Math.round(parseFloat(`${engineCodeMatch[1]}.${engineCodeMatch[2]}`) * 1000);
  }

  const engineCodeCommaMatch = clean.match(/^(\d+),(\d+)\s+[a-z]/);
  if (engineCodeCommaMatch) {
    return Math.round(parseFloat(`${engineCodeCommaMatch[1]}.${engineCodeCommaMatch[2]}`) * 1000);
  }

  const bareDecimalDot = clean.match(/^(\d+)\.(\d+)$/);
  if (bareDecimalDot) {
    return Math.round(parseFloat(`${bareDecimalDot[1]}.${bareDecimalDot[2]}`) * 1000);
  }

  const bareDecimalComma = clean.match(/^(\d+),(\d+)$/);
  if (bareDecimalComma) {
    return Math.round(parseFloat(`${bareDecimalComma[1]}.${bareDecimalComma[2]}`) * 1000);
  }

  return null;
}

export function parseModelYear(text: string | null | undefined): number | null {
  if (!text) return null;

  const yearMatch = text.match(/\b(19[7-9]\d|20\d{2})\b/);
  if (!yearMatch) return null;

  const year = parseInt(yearMatch[1], 10);
  if (year < MIN_YEAR || year > CURRENT_YEAR) return null;

  return year;
}

const FUEL_MAP: [RegExp, FuelType][] = [
  [/benzin\s*(?:&|ve)\s*lpg|lpg\s*(?:&|ve)\s*benzin|benzin\/lpg/, 'benzin_lpg'],
  [/benzin|gasoline|petrol|premium\s*benzin/, 'benzin'],
  [/dizel|diesel/, 'dizel'],
  [/\blpg\b/, 'lpg'],
  [/hibrit|hybrid|elektrik\s*&\s*benzin/, 'hybrid'],
  [/elektrik|electric\b|bev\b/, 'elektrik'],
];

export function normalizeFuelType(text: string | null | undefined): FuelType | null {
  if (!text) return null;

  const normalized = normalizeLookupText(text);
  for (const [pattern, value] of FUEL_MAP) {
    if (pattern.test(normalized)) return value;
  }

  return null;
}

const TRANSMISSION_MAP: [RegExp, TransmissionType][] = [
  [/yari\s*otomatik|semi.?auto|tiptronic|dsg|pdk|cvt|s\s*tronic/, 'yarı_otomatik'],
  [/otomatik|automatic|automat/, 'otomatik'],
  [/manuel|manual|duz\s*vites|el\s*vites/, 'manuel'],
];

export function normalizeTransmission(text: string | null | undefined): TransmissionType | null {
  if (!text) return null;

  const normalized = normalizeLookupText(text);
  for (const [pattern, value] of TRANSMISSION_MAP) {
    if (pattern.test(normalized)) return value;
  }

  return null;
}

const BODY_MAP: [RegExp, BodyType][] = [
  [/station\s*wagon|kombi|\bsw\b|estate|touring/, 'station_wagon'],
  [/hatchback|hatch|3\s*kap|5\s*kap/, 'hatchback'],
  [/cabrio|roadster|cabriolet|convertible|ustu\s*acik/, 'cabrio'],
  [/pick.?up|pickup/, 'pickup'],
  [/\bsuv\b|crossover|off.?road/, 'suv'],
  [/\bmpv\b|\bminivan\b|(?:^|[\s/-])van\b|people\s*carrier/, 'minivan'],
  [/coupe|kupe/, 'coupe'],
  [/sedan/, 'sedan'],
];

export function normalizeBodyType(text: string | null | undefined): BodyType | null {
  if (!text) return null;

  const normalized = normalizeLookupText(text);
  for (const [pattern, value] of BODY_MAP) {
    if (pattern.test(normalized)) return value;
  }

  return null;
}

export function vehicleFingerprint(
  make: string,
  model: string,
  year: number,
  fuel: FuelType,
  transmission: TransmissionType,
): string {
  const normalizePart = (value: string) =>
    turkishLower(value.trim())
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9ğıüşöçı_-]/g, '');

  return [
    normalizePart(make),
    normalizePart(model),
    String(year),
    fuel,
    transmission,
  ].join('-');
}

export function parseHorsePower(text: string | null | undefined): number | null {
  if (!text) return null;
  const clean = text.trim().toLowerCase();

  const rangeMatch = clean.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    return Math.round((lo + hi) / 2);
  }

  const singleMatch = clean.match(/(\d+)/);
  return singleMatch ? parseInt(singleMatch[1], 10) : null;
}

export function parsePaintCondition(text: string | null | undefined): PaintConditionResult {
  const originalText = text ?? '';
  const trimmed = originalText.trim();
  const normalized = normalizeLookupText(trimmed);

  const originalPatterns = [
    /^boyasiz$/,
    /tamami\s+orjinal/,
    /tamami\s+orijinal/,
    /^tramsiz$/,
    /tamami\s+boyasiz/,
    /^orjinal$/,
    /^orijinal$/,
  ];

  for (const pattern of originalPatterns) {
    if (pattern.test(normalized)) {
      return {
        originalText,
        paintedPanels: 0,
        replacedPanels: 0,
        isOriginal: true,
      };
    }
  }

  // Sum every "<n> boya/boyali/lokal boyali" occurrence (count lokal as half-painted = +1).
  let paintedPanels = 0;
  const boyaliPattern = /(\d+)\s*(?:lokal\s+)?boya(?:li)?/g;
  let boyaliMatch: RegExpExecArray | null;
  while ((boyaliMatch = boyaliPattern.exec(normalized)) !== null) {
    paintedPanels += parseInt(boyaliMatch[1], 10);
  }

  let replacedPanels = 0;
  const degisenPattern = /(\d+)\s*degisen/g;
  let degisenMatch: RegExpExecArray | null;
  while ((degisenMatch = degisenPattern.exec(normalized)) !== null) {
    replacedPanels += parseInt(degisenMatch[1], 10);
  }

  if (paintedPanels > 0 || replacedPanels > 0) {
    return {
      originalText,
      paintedPanels,
      replacedPanels,
      isOriginal: false,
    };
  }

  if (trimmed.length > 0) {
    return {
      originalText,
      paintedPanels: 0,
      replacedPanels: 0,
      isOriginal: false,
    };
  }

  return {
    originalText: '',
    paintedPanels: 0,
    replacedPanels: 0,
    isOriginal: false,
  };
}
