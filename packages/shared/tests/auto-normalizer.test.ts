/**
 * auto-normalizer.test.ts
 * Comprehensive Jest tests for the auto-normalizer module.
 */

import {
  parseMileage,
  parseEngineSize,
  parseModelYear,
  normalizeFuelType,
  normalizeTransmission,
  normalizeBodyType,
  vehicleFingerprint,
  parsePaintCondition,
} from '../src/auto-normalizer';

// ─── parseMileage ────────────────────────────────────────────────────────────

describe('parseMileage', () => {
  describe('Turkish thousands format (dot separator)', () => {
    it('parses "150.000 km"', () => expect(parseMileage('150.000 km')).toBe(150000));
    it('parses "150.000"', () => expect(parseMileage('150.000')).toBe(150000));
    it('parses "1.200.000 km"', () => expect(parseMileage('1.200.000 km')).toBe(1200000));
    it('parses "10.000 km"', () => expect(parseMileage('10.000 km')).toBe(10000));
  });

  describe('English comma-thousands format', () => {
    it('parses "150,000 km"', () => expect(parseMileage('150,000 km')).toBe(150000));
    it('parses "50,000 km"', () => expect(parseMileage('50,000 km')).toBe(50000));
  });

  describe('Plain integer formats', () => {
    it('parses "150000km"', () => expect(parseMileage('150000km')).toBe(150000));
    it('parses "150000 km"', () => expect(parseMileage('150000 km')).toBe(150000));
    it('parses "75000"', () => expect(parseMileage('75000')).toBe(75000));
  });

  describe('Brand new (0 km) returns null', () => {
    it('"0 km" → null', () => expect(parseMileage('0 km')).toBeNull());
    it('"0" → null', () => expect(parseMileage('0')).toBeNull());
    it('"0km" → null', () => expect(parseMileage('0km')).toBeNull());
  });

  describe('Edge cases', () => {
    it('null input → null', () => expect(parseMileage(null)).toBeNull());
    it('undefined input → null', () => expect(parseMileage(undefined)).toBeNull());
    it('empty string → null', () => expect(parseMileage('')).toBeNull());
    it('whitespace only → null', () => expect(parseMileage('   ')).toBeNull());
    it('"km" only → null', () => expect(parseMileage('km')).toBeNull());
    it('non-numeric string → null', () => expect(parseMileage('bilinmiyor')).toBeNull());
    it('handles extra whitespace', () => expect(parseMileage('  150.000  km  ')).toBe(150000));
  });
});

// ─── parseEngineSize ─────────────────────────────────────────────────────────

describe('parseEngineSize', () => {
  describe('Already in cc', () => {
    it('"1600 cc" → 1600', () => expect(parseEngineSize('1600 cc')).toBe(1600));
    it('"1598 cc" → 1598', () => expect(parseEngineSize('1598 cc')).toBe(1598));
    it('"1598cc" → 1598', () => expect(parseEngineSize('1598cc')).toBe(1598));
    it('"2000 cc" → 2000', () => expect(parseEngineSize('2000 cc')).toBe(2000));
  });

  describe('Litre with dot decimal', () => {
    it('"1.6 L" → 1600', () => expect(parseEngineSize('1.6 L')).toBe(1600));
    it('"2.0 L" → 2000', () => expect(parseEngineSize('2.0 L')).toBe(2000));
    it('"1.6L" → 1600', () => expect(parseEngineSize('1.6L')).toBe(1600));
  });

  describe('Litre with Turkish comma decimal', () => {
    it('"1,6 L" → 1600', () => expect(parseEngineSize('1,6 L')).toBe(1600));
    it('"2,0 L" → 2000', () => expect(parseEngineSize('2,0 L')).toBe(2000));
    it('"1,6L" → 1600', () => expect(parseEngineSize('1,6L')).toBe(1600));
  });

  describe('Engine code strings', () => {
    it('"2.0 TDI" → 2000', () => expect(parseEngineSize('2.0 TDI')).toBe(2000));
    it('"1.6 TDI" → 1600', () => expect(parseEngineSize('1.6 TDI')).toBe(1600));
    it('"2.5 V6" → 2500', () => expect(parseEngineSize('2.5 V6')).toBe(2500));
    it('"1,6 TDI" (Turkish comma) → 1600', () => expect(parseEngineSize('1,6 TDI')).toBe(1600));
  });

  describe('Bare decimal values', () => {
    it('"1.6" → 1600', () => expect(parseEngineSize('1.6')).toBe(1600));
    it('"2.0" → 2000', () => expect(parseEngineSize('2.0')).toBe(2000));
    it('"1,6" → 1600', () => expect(parseEngineSize('1,6')).toBe(1600));
  });

  describe('Edge cases', () => {
    it('null → null', () => expect(parseEngineSize(null)).toBeNull());
    it('undefined → null', () => expect(parseEngineSize(undefined)).toBeNull());
    it('empty string → null', () => expect(parseEngineSize('')).toBeNull());
    it('non-engine string → null', () => expect(parseEngineSize('bilinmiyor')).toBeNull());
  });
});

// ─── parseModelYear ──────────────────────────────────────────────────────────

describe('parseModelYear', () => {
  const currentYear = new Date().getFullYear();

  describe('Valid years', () => {
    it('"2019" → 2019', () => expect(parseModelYear('2019')).toBe(2019));
    it('"2019 Model" → 2019', () => expect(parseModelYear('2019 Model')).toBe(2019));
    it('"Model: 2019" → 2019', () => expect(parseModelYear('Model: 2019')).toBe(2019));
    it('"model yılı 2021" → 2021', () => expect(parseModelYear('model yılı 2021')).toBe(2021));
    it('"1990" → 1990 (boundary)', () => expect(parseModelYear('1990')).toBe(1990));
    it('"1970" → 1970 (lower boundary)', () => expect(parseModelYear('1970')).toBe(1970));
    it(`"${currentYear}" → current year`, () => expect(parseModelYear(String(currentYear))).toBe(currentYear));
  });

  describe('Invalid years', () => {
    it('"1969" → null (too old)', () => expect(parseModelYear('1969')).toBeNull());
    it(`"${currentYear + 1}" → null (future)`, () => expect(parseModelYear(String(currentYear + 1))).toBeNull());
    it('"2200" → null (far future)', () => expect(parseModelYear('2200')).toBeNull());
    it('"1800" → null (too old)', () => expect(parseModelYear('1800')).toBeNull());
  });

  describe('Edge cases', () => {
    it('null → null', () => expect(parseModelYear(null)).toBeNull());
    it('undefined → null', () => expect(parseModelYear(undefined)).toBeNull());
    it('empty string → null', () => expect(parseModelYear('')).toBeNull());
    it('"no year here" → null', () => expect(parseModelYear('no year here')).toBeNull());
  });
});

// ─── normalizeFuelType ───────────────────────────────────────────────────────

describe('normalizeFuelType', () => {
  describe('Turkish terms', () => {
    it('"Benzin" → benzin', () => expect(normalizeFuelType('Benzin')).toBe('benzin'));
    it('"benzin" lowercase → benzin', () => expect(normalizeFuelType('benzin')).toBe('benzin'));
    it('"BENZİN" uppercase → benzin', () => expect(normalizeFuelType('BENZİN')).toBe('benzin'));
    it('"Dizel" → dizel', () => expect(normalizeFuelType('Dizel')).toBe('dizel'));
    it('"LPG" → lpg', () => expect(normalizeFuelType('LPG')).toBe('lpg'));
    it('"Hibrit" → hybrid', () => expect(normalizeFuelType('Hibrit')).toBe('hybrid'));
    it('"Elektrik" → elektrik', () => expect(normalizeFuelType('Elektrik')).toBe('elektrik'));
    it('"Benzin & LPG" → benzin_lpg', () => expect(normalizeFuelType('Benzin & LPG')).toBe('benzin_lpg'));
    it('"LPG & Benzin" → benzin_lpg', () => expect(normalizeFuelType('LPG & Benzin')).toBe('benzin_lpg'));
    it('"Benzin/LPG" → benzin_lpg', () => expect(normalizeFuelType('Benzin/LPG')).toBe('benzin_lpg'));
    it('"Premium Benzin" → benzin', () => expect(normalizeFuelType('Premium Benzin')).toBe('benzin'));
  });

  describe('English equivalents', () => {
    it('"Gasoline" → benzin', () => expect(normalizeFuelType('Gasoline')).toBe('benzin'));
    it('"Petrol" → benzin', () => expect(normalizeFuelType('Petrol')).toBe('benzin'));
    it('"Diesel" → dizel', () => expect(normalizeFuelType('Diesel')).toBe('dizel'));
    it('"Hybrid" → hybrid', () => expect(normalizeFuelType('Hybrid')).toBe('hybrid'));
    it('"Electric" → elektrik', () => expect(normalizeFuelType('Electric')).toBe('elektrik'));
  });

  describe('Edge cases', () => {
    it('null → null', () => expect(normalizeFuelType(null)).toBeNull());
    it('undefined → null', () => expect(normalizeFuelType(undefined)).toBeNull());
    it('empty string → null', () => expect(normalizeFuelType('')).toBeNull());
    it('unknown term → null', () => expect(normalizeFuelType('hidrojen')).toBeNull());
  });
});

// ─── normalizeTransmission ───────────────────────────────────────────────────

describe('normalizeTransmission', () => {
  describe('Turkish terms', () => {
    it('"Manuel" → manuel', () => expect(normalizeTransmission('Manuel')).toBe('manuel'));
    it('"Düz Vites" → manuel', () => expect(normalizeTransmission('Düz Vites')).toBe('manuel'));
    it('"El Vites" → manuel', () => expect(normalizeTransmission('El Vites')).toBe('manuel'));
    it('"Otomatik" → otomatik', () => expect(normalizeTransmission('Otomatik')).toBe('otomatik'));
    it('"Yarı Otomatik" → yarı_otomatik', () => expect(normalizeTransmission('Yarı Otomatik')).toBe('yarı_otomatik'));
    it('"Tiptronic" → yarı_otomatik', () => expect(normalizeTransmission('Tiptronic')).toBe('yarı_otomatik'));
    it('"DSG" → yarı_otomatik', () => expect(normalizeTransmission('DSG')).toBe('yarı_otomatik'));
    it('"CVT" → yarı_otomatik', () => expect(normalizeTransmission('CVT')).toBe('yarı_otomatik'));
  });

  describe('English equivalents', () => {
    it('"Manual" → manuel', () => expect(normalizeTransmission('Manual')).toBe('manuel'));
    it('"Automatic" → otomatik', () => expect(normalizeTransmission('Automatic')).toBe('otomatik'));
    it('"Semi-auto" → yarı_otomatik', () => expect(normalizeTransmission('Semi-auto')).toBe('yarı_otomatik'));
  });

  describe('Case insensitivity', () => {
    it('"MANUEL" → manuel', () => expect(normalizeTransmission('MANUEL')).toBe('manuel'));
    it('"otomatik" → otomatik', () => expect(normalizeTransmission('otomatik')).toBe('otomatik'));
  });

  describe('Edge cases', () => {
    it('null → null', () => expect(normalizeTransmission(null)).toBeNull());
    it('undefined → null', () => expect(normalizeTransmission(undefined)).toBeNull());
    it('empty string → null', () => expect(normalizeTransmission('')).toBeNull());
    it('unknown term → null', () => expect(normalizeTransmission('elektrikli')).toBeNull());
  });
});

// ─── normalizeBodyType ───────────────────────────────────────────────────────

describe('normalizeBodyType', () => {
  it('"Sedan" → sedan', () => expect(normalizeBodyType('Sedan')).toBe('sedan'));
  it('"Hatchback" → hatchback', () => expect(normalizeBodyType('Hatchback')).toBe('hatchback'));
  it('"Station Wagon" → station_wagon', () => expect(normalizeBodyType('Station Wagon')).toBe('station_wagon'));
  it('"Kombi" → station_wagon', () => expect(normalizeBodyType('Kombi')).toBe('station_wagon'));
  it('"SUV" → suv', () => expect(normalizeBodyType('SUV')).toBe('suv'));
  it('"Crossover" → suv', () => expect(normalizeBodyType('Crossover')).toBe('suv'));
  it('"Coupe" → coupe', () => expect(normalizeBodyType('Coupe')).toBe('coupe'));
  it('"Coupé" → coupe', () => expect(normalizeBodyType('Coupé')).toBe('coupe'));
  it('"Cabrio/Roadster" → cabrio', () => expect(normalizeBodyType('Cabrio/Roadster')).toBe('cabrio'));
  it('"Cabriolet" → cabrio', () => expect(normalizeBodyType('Cabriolet')).toBe('cabrio'));
  it('"MPV" → minivan', () => expect(normalizeBodyType('MPV')).toBe('minivan'));
  it('"Minivan" → minivan', () => expect(normalizeBodyType('Minivan')).toBe('minivan'));
  it('"Pick-up" → pickup', () => expect(normalizeBodyType('Pick-up')).toBe('pickup'));
  it('"Pickup" → pickup', () => expect(normalizeBodyType('Pickup')).toBe('pickup'));

  describe('Edge cases', () => {
    it('null → null', () => expect(normalizeBodyType(null)).toBeNull());
    it('undefined → null', () => expect(normalizeBodyType(undefined)).toBeNull());
    it('empty string → null', () => expect(normalizeBodyType('')).toBeNull());
    it('unknown → null', () => expect(normalizeBodyType('mikrovan')).toBeNull());
  });
});

// ─── vehicleFingerprint ──────────────────────────────────────────────────────

describe('vehicleFingerprint', () => {
  it('generates expected fingerprint', () => {
    expect(vehicleFingerprint('Volkswagen', 'Passat', 2019, 'dizel', 'otomatik'))
      .toBe('volkswagen-passat-2019-dizel-otomatik');
  });

  it('lowercases make and model', () => {
    expect(vehicleFingerprint('TOYOTA', 'COROLLA', 2021, 'benzin', 'manuel'))
      .toBe('toyota-corolla-2021-benzin-manuel');
  });

  it('handles Turkish uppercase İ correctly', () => {
    const fp = vehicleFingerprint('İsuzu', 'D-Max', 2020, 'dizel', 'manuel');
    expect(fp).toBe('isuzu-d-max-2020-dizel-manuel');
  });

  it('normalizes spaces to hyphens in model name', () => {
    expect(vehicleFingerprint('Hyundai', 'Santa Fe', 2022, 'benzin', 'otomatik'))
      .toBe('hyundai-santa-fe-2022-benzin-otomatik');
  });

  it('handles make with space', () => {
    expect(vehicleFingerprint('Land Rover', 'Discovery', 2020, 'dizel', 'otomatik'))
      .toBe('land-rover-discovery-2020-dizel-otomatik');
  });
});

// ─── parsePaintCondition ─────────────────────────────────────────────────────

describe('parsePaintCondition', () => {
  describe('Original / no paint work', () => {
    it('"Boyasız" → isOriginal true, 0 panels', () => {
      const result = parsePaintCondition('Boyasız');
      expect(result).toEqual({
        originalText: 'Boyasız',
        paintedPanels: 0,
        replacedPanels: 0,
        isOriginal: true,
      });
    });

    it('"Tamamı orjinal" → isOriginal true', () => {
      const result = parsePaintCondition('Tamamı orjinal');
      expect(result.isOriginal).toBe(true);
      expect(result.paintedPanels).toBe(0);
      expect(result.replacedPanels).toBe(0);
    });

    it('"Tamamı orijinal" (alternate spelling) → isOriginal true', () => {
      expect(parsePaintCondition('Tamamı orijinal').isOriginal).toBe(true);
    });

    it('"BOYASIZ" uppercase → isOriginal true', () => {
      expect(parsePaintCondition('BOYASIZ').isOriginal).toBe(true);
    });

    it('preserves originalText exactly', () => {
      expect(parsePaintCondition('Boyasız').originalText).toBe('Boyasız');
    });
  });

  describe('Painted panels', () => {
    it('"2 boyalı" → paintedPanels 2, replacedPanels 0', () => {
      const result = parsePaintCondition('2 boyalı');
      expect(result.paintedPanels).toBe(2);
      expect(result.replacedPanels).toBe(0);
      expect(result.isOriginal).toBe(false);
    });

    it('"1 boya" → paintedPanels 1', () => {
      expect(parsePaintCondition('1 boya').paintedPanels).toBe(1);
    });

    it('"5 boyalı" → paintedPanels 5', () => {
      expect(parsePaintCondition('5 boyalı').paintedPanels).toBe(5);
    });
  });

  describe('Painted + replaced panels', () => {
    it('"3 boya 1 değişen" → paintedPanels 3, replacedPanels 1', () => {
      const result = parsePaintCondition('3 boya 1 değişen');
      expect(result.paintedPanels).toBe(3);
      expect(result.replacedPanels).toBe(1);
      expect(result.isOriginal).toBe(false);
    });

    it('"2 boya 2 değişen" → paintedPanels 2, replacedPanels 2', () => {
      const result = parsePaintCondition('2 boya 2 değişen');
      expect(result.paintedPanels).toBe(2);
      expect(result.replacedPanels).toBe(2);
    });

    it('"1 boya 1 değişen" → paintedPanels 1, replacedPanels 1', () => {
      const result = parsePaintCondition('1 boya 1 değişen');
      expect(result.paintedPanels).toBe(1);
      expect(result.replacedPanels).toBe(1);
    });
  });

  describe('Replaced panels only', () => {
    it('"1 değişen" → replacedPanels 1, paintedPanels 0', () => {
      const result = parsePaintCondition('1 değişen');
      expect(result.paintedPanels).toBe(0);
      expect(result.replacedPanels).toBe(1);
      expect(result.isOriginal).toBe(false);
    });
  });

  describe('originalText preservation', () => {
    it('always preserves the original Turkish text', () => {
      const inputs = ['Boyasız', '3 boya 1 değişen', '2 boyalı', 'Tamamı orjinal'];
      for (const input of inputs) {
        expect(parsePaintCondition(input).originalText).toBe(input);
      }
    });
  });

  describe('Edge cases', () => {
    it('null input → empty originalText, 0 panels, not original', () => {
      const result = parsePaintCondition(null);
      expect(result.originalText).toBe('');
      expect(result.paintedPanels).toBe(0);
      expect(result.replacedPanels).toBe(0);
      expect(result.isOriginal).toBe(false);
    });

    it('undefined input → same as null', () => {
      const result = parsePaintCondition(undefined);
      expect(result.originalText).toBe('');
    });

    it('empty string → 0 panels, not original', () => {
      const result = parsePaintCondition('');
      expect(result.paintedPanels).toBe(0);
      expect(result.isOriginal).toBe(false);
    });

    it('unknown description → isOriginal false, 0 panels', () => {
      const result = parsePaintCondition('belirsiz durum');
      expect(result.isOriginal).toBe(false);
      expect(result.paintedPanels).toBe(0);
      expect(result.replacedPanels).toBe(0);
      expect(result.originalText).toBe('belirsiz durum');
    });
  });
});
