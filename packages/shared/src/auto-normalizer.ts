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
  /** null when arabam explicitly reports this as unspecified ("Belirtilmemiş") — never a presented-as-fact 0. */
  paintedPanels: number | null;
  replacedPanels: number | null;
  isOriginal: boolean | null;
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

/**
 * Result of a range-aware spec parse. arabam.com sometimes shows engine size
 * and horsepower as a bucketed range (e.g. "1401 - 1600 cm3") rather than an
 * exact value. `min === max` for an exact value; otherwise both are set and
 * the exact value must be treated as unknown (never fabricate a midpoint).
 */
export interface NumericRangeResult {
  min: number;
  max: number;
}

/**
 * Parses an engine-size spec that may be an exact value OR a range.
 * Exact → { min: v, max: v }. Range → { min: lo, max: hi }. Never collapses
 * a range to a single "midpoint" value — that would present an estimate as fact.
 */
export function parseEngineSizeRange(text: string | null | undefined): NumericRangeResult | null {
  if (!text) return null;
  const clean = text.trim().toLowerCase();

  const rangeMatch = clean.match(/^(\d+)\s*[-–]\s*(\d+)\s*(?:cc|cm3|cm\^3)?/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    return { min: lo, max: hi };
  }

  const exact = parseEngineSize(text);
  return exact !== null ? { min: exact, max: exact } : null;
}

export function parseEngineSize(text: string | null | undefined): number | null {
  if (!text) return null;

  const clean = text.trim().toLowerCase();

  // Ranges are not an exact value — callers that need min/max should use
  // parseEngineSizeRange. Returning a midpoint here would fabricate precision
  // the source data doesn't have.
  const rangeMatch = clean.match(/^(\d+)\s*[-–]\s*(\d+)\s*(?:cc|cm3|cm\^3)?/);
  if (rangeMatch) {
    return null;
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

// Audited against arabam.com's "Vites Tipi" spec values. arabam sends the bare
// word ("Düz", "Otomatik", "Yarı Otomatik") as the spec *value* — the key
// ("Vites Tipi") carries the word "vites", not the value — so patterns must
// match the bare word, not just "düz vites"/"el vites" compounds.
//
// IMPORTANT: "el" and "duz" are short Turkish words that are also substrings
// of unrelated words ("elektrik" contains "el"; a hypothetical "duzensiz"
// contains "duz"). They must only ever be recognized as an EXACT whole
// normalized value or an exact whole whitespace-delimited token — never via
// a plain substring/regex match — or values like "Elektrik" risk false-
// matching "manuel". See matchesWholeValueOrToken below and its tests.
const TRANSMISSION_EXACT_MAP: [string[], TransmissionType][] = [
  [['yari otomatik', 'semi auto', 'semi-auto', 'tiptronic', 'dsg', 'pdk', 'cvt', 's tronic'], 'yarı_otomatik'],
  [['otomatik', 'automatic', 'automat'], 'otomatik'],
  [['duz', 'duz vites', 'el', 'el vites', 'manuel', 'manual'], 'manuel'],
];

/**
 * True if `normalized` (already run through normalizeLookupText) equals
 * `keyword` exactly, OR contains `keyword` as one of its whitespace-delimited
 * tokens. Never matches `keyword` as a substring of a longer token — e.g.
 * keyword "el" matches the token "el" but not "elektrik".
 */
function matchesWholeValueOrToken(normalized: string, keyword: string): boolean {
  if (normalized === keyword) return true;
  const keywordTokens = keyword.split(' ');
  const valueTokens = normalized.split(' ');
  if (keywordTokens.length === 1) {
    return valueTokens.includes(keyword);
  }
  // Multi-word keyword ("yari otomatik", "el vites"): check it appears as a
  // contiguous run of whole tokens, not a substring of the joined string.
  for (let i = 0; i <= valueTokens.length - keywordTokens.length; i++) {
    if (keywordTokens.every((kt, j) => valueTokens[i + j] === kt)) return true;
  }
  return false;
}

export function normalizeTransmission(text: string | null | undefined): TransmissionType | null {
  if (!text) return null;

  const normalized = normalizeLookupText(text);
  for (const [keywords, value] of TRANSMISSION_EXACT_MAP) {
    if (keywords.some((keyword) => matchesWholeValueOrToken(normalized, keyword))) return value;
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

/**
 * Parses a horsepower spec that may be an exact value OR a range.
 * Exact → { min: v, max: v }. Range → { min: lo, max: hi }. See parseEngineSizeRange.
 */
export function parseHorsePowerRange(text: string | null | undefined): NumericRangeResult | null {
  if (!text) return null;
  const clean = text.trim().toLowerCase();

  const rangeMatch = clean.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    return { min: lo, max: hi };
  }

  const exact = parseHorsePower(text);
  return exact !== null ? { min: exact, max: exact } : null;
}

export function parseHorsePower(text: string | null | undefined): number | null {
  if (!text) return null;
  const clean = text.trim().toLowerCase();

  // A range is not an exact value — see parseHorsePowerRange for min/max.
  // Returning a midpoint here would fabricate precision the source lacks.
  const rangeMatch = clean.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) {
    return null;
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

  // arabam explicitly marks some listings' paint condition as unspecified
  // ("Belirtilmemiş" / "Belirtilmemis"). That is NOT the same as "0 panels,
  // not original" — it means the seller didn't say. Report it as unknown
  // (null) rather than presenting a guess as a fact.
  const unspecifiedPatterns = [/^belirtilmemis$/, /^bilinmiyor$/, /^belirsiz$/];
  for (const pattern of unspecifiedPatterns) {
    if (pattern.test(normalized)) {
      return {
        originalText,
        paintedPanels: null,
        replacedPanels: null,
        isOriginal: null,
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

  // Text that doesn't match any known pattern (original/unspecified/painted/
  // replaced) is unparseable, not a confirmed "no paint work" — report
  // unknown (null) rather than presenting a guess as 0/false. Same for
  // empty/null input: no information in means no information out.
  if (trimmed.length > 0) {
    return {
      originalText,
      paintedPanels: null,
      replacedPanels: null,
      isOriginal: null,
    };
  }

  return {
    originalText: '',
    paintedPanels: null,
    replacedPanels: null,
    isOriginal: null,
  };
}
