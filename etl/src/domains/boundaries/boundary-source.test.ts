import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  parseBoundaryFiles,
  parseBoundaryZip,
  readBoundarySource,
  validateProjection,
} from './boundary-source.js';

// 실제 원본과 같은 EPSG:5181 WKT를 바탕으로 정의 일부를 바꿔 좌표계 검증 실패를 재현한다.
const projection =
  'PROJCS["Korea_2000_Korea_Central_Belt",GEOGCS["GCS_Korea_2000",DATUM["D_Korea_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],PARAMETER["False_Northing",500000.0],PARAMETER["Central_Meridian",127.0],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],UNIT["Meter",1.0]]';
const encode = (value: string) => new TextEncoder().encode(value);
const ring = [
  [190000, 450000],
  [190000, 450100],
  [190100, 450100],
  [190000, 450000],
];

// 파일을 만들지 않고 Polygon 한 레코드의 SHP 바이트를 구성한다.
// 헤더의 길이는 16비트 워드 단위이며, 링별 점 시작 인덱스와 XY 좌표를 직접 기록한다.
function shpFixture(rings = [ring]) {
  const recordLength = 44 + rings.length * 4 + rings.flat().length * 16;
  const buffer = Buffer.alloc(100 + 8 + recordLength);
  buffer.writeInt32BE(9994, 0);
  buffer.writeInt32BE(buffer.length / 2, 24);
  buffer.writeInt32LE(1000, 28);
  buffer.writeInt32LE(5, 32);
  buffer.writeInt32BE(1, 100);
  buffer.writeInt32BE(recordLength / 2, 104);
  buffer.writeInt32LE(5, 108);
  buffer.writeInt32LE(rings.length, 144);
  buffer.writeInt32LE(rings.flat().length, 148);
  let pointIndex = 0;
  rings.forEach((points, index) => {
    buffer.writeInt32LE(pointIndex, 152 + index * 4);
    points.forEach((point) => {
      buffer.writeDoubleLE(point[0]!, 152 + rings.length * 4 + pointIndex * 16);
      buffer.writeDoubleLE(point[1]!, 160 + rings.length * 4 + pointIndex * 16);
      pointIndex += 1;
    });
  });
  return buffer;
}

const fields = [
  ['ADSTRD_CD', 'C', 8],
  ['ADSTRD_NM', 'C', 30],
  ['XCNTS_VALU', 'N', 38],
  ['YDNTS_VALU', 'N', 38],
  ['RELM_AR', 'N', 38],
] as const;

// 실제 필드명·폭을 가진 DBF를 메모리에서 구성한다. 각 행의 첫 바이트는 정상 행을 뜻하는 공백이며,
// UTF-8 문자 필드는 왼쪽부터, 숫자 원문은 오른쪽 정렬로 기록해 원본 읽기 경로를 검증한다.
function dbfFixture(
  rows = [['11110515', '청운효자동', '190000', '450000', '2568432']],
) {
  const headerLength = 33 + fields.length * 32;
  const recordLength = 1 + fields.reduce((total, field) => total + field[2], 0);
  const buffer = Buffer.alloc(
    headerLength + rows.length * recordLength + 1,
    32,
  );
  buffer[0] = 3;
  buffer.writeUInt32LE(rows.length, 4);
  buffer.writeUInt16LE(headerLength, 8);
  buffer.writeUInt16LE(recordLength, 10);
  fields.forEach(([name, type, length], index) => {
    const offset = 32 + index * 32;
    buffer.fill(0, offset, offset + 32);
    buffer.write(name, offset, 'ascii');
    buffer[offset + 11] = type.charCodeAt(0);
    buffer[offset + 16] = length;
  });
  buffer[headerLength - 1] = 13;
  rows.forEach((row, index) => {
    let offset = headerLength + index * recordLength + 1;
    fields.forEach((field, fieldIndex) => {
      const value = encode(row[fieldIndex]!);
      buffer.set(
        value,
        offset + (field[1] === 'N' ? field[2] - value.length : 0),
      );
      offset += field[2];
    });
  });
  buffer[buffer.length - 1] = 26;
  return buffer;
}

// 각 테스트가 바이트를 직접 훼손해도 다른 테스트에 전파되지 않도록 네 파일을 새로 구성한다.
function fixture() {
  return {
    shp: shpFixture(),
    dbf: dbfFixture(),
    prj: encode(projection),
    cpg: encode('UTF-8'),
  };
}

describe('boundary source', () => {
  it('reads actual truncated DBF field names, UTF-8 and polygon coordinates', async () => {
    const source = await parseBoundaryFiles(fixture());
    expect(source.features).toEqual([
      {
        dongCode: '11110515',
        dongName: '청운효자동',
        areaM2: '2568432',
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
    ]);
    expect(source.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  // Number로 읽었다면 반올림될 면적을 사용해 원본 정수 문자열의 보존을 확인한다.
  it('preserves integer area above the JavaScript safe integer range', async () => {
    const files = fixture();
    files.dbf = dbfFixture([
      ['11110515', '청운효자동', '190000', '450000', '9007199254740993'],
    ]);
    expect((await parseBoundaryFiles(files)).features[0]?.areaM2).toBe(
      '9007199254740993',
    );
  });

  it('preserves separate polygons as a MultiPolygon', async () => {
    const secondRing = [
      [200000, 450000],
      [200000, 450100],
      [200100, 450100],
      [200000, 450000],
    ];
    const source = await parseBoundaryFiles({
      ...fixture(),
      shp: shpFixture([ring, secondRing]),
    });
    expect(source.features[0]?.geometry).toEqual({
      type: 'MultiPolygon',
      coordinates: [[ring], [secondRing]],
    });
  });

  // 수학적으로 정수처럼 보이는 지수 표기도 원본 정수 형식이 아니므로 허용하지 않는다.
  it.each(['', '0', '-1', '1.5', '1e3', '9223372036854775808'])(
    'rejects invalid raw area %j',
    async (area) => {
      const files = fixture();
      files.dbf = dbfFixture([
        ['11110515', '청운효자동', '190000', '450000', area],
      ]);
      await expect(parseBoundaryFiles(files)).rejects.toThrow();
    },
  );

  it.each([
    ['1111051', '청운효자동', '190000', '450000', '1'],
    ['11110x15', '청운효자동', '190000', '450000', '1'],
    ['11110515', '', '190000', '450000', '1'],
    ['11110515', '청운효자동', '127', '38', '1'],
    ['11110515', '청운효자동', '190000.5', '450000', '1'],
  ])('rejects invalid attributes %j', async (...row) => {
    await expect(
      parseBoundaryFiles({ ...fixture(), dbf: dbfFixture([row]) }),
    ).rejects.toThrow();
  });

  // 이름 필드의 실제 바이트를 깨뜨려 디코딩 단계에서 손상된 이름을 거부하는지 확인한다.
  it('rejects malformed UTF-8 names instead of replacement characters', async () => {
    const files = fixture();
    files.dbf[33 + fields.length * 32 + 1 + 8] = 255;
    await expect(parseBoundaryFiles(files)).rejects.toThrow();
  });

  it('rejects duplicate dong codes', async () => {
    const files = fixture();
    const record = files.shp.subarray(100);
    files.shp = Buffer.concat([files.shp, record]);
    files.shp.writeInt32BE(files.shp.length / 2, 24);
    files.shp.writeInt32BE(2, 100 + record.length);
    files.dbf = dbfFixture([
      ['11110515', '청운효자동', '190000', '450000', '1'],
      ['11110515', '청운효자동', '190000', '450000', '1'],
    ]);
    await expect(parseBoundaryFiles(files)).rejects.toThrow(/duplicate/i);
  });

  // 라이브러리의 자동 승격이 원본 오류를 숨기지 않도록, 외곽선 밖 구멍과 방향 오류를 검증한다.
  it('rejects an orphan counterclockwise hole instead of promoting it to a shell', async () => {
    const hole = [
      [200000, 450000],
      [200100, 450000],
      [200100, 450100],
      [200000, 450000],
    ];
    await expect(
      parseBoundaryFiles({ ...fixture(), shp: shpFixture([ring, hole]) }),
    ).rejects.toThrow(/hole|nesting/i);
  });

  it('rejects an entirely counterclockwise shapefile polygon', async () => {
    await expect(
      parseBoundaryFiles({
        ...fixture(),
        shp: shpFixture([[...ring].reverse()]),
      }),
    ).rejects.toThrow(/hole|nesting/i);
  });

  // 정상적인 외곽선·구멍 관계는 입력 좌표와 역할을 그대로 유지해야 한다.
  it('retains a counterclockwise hole contained in its clockwise shell', async () => {
    const shell = [
      [190000, 450000],
      [190000, 450100],
      [190100, 450100],
      [190100, 450000],
      [190000, 450000],
    ];
    const hole = [
      [190020, 450020],
      [190080, 450020],
      [190080, 450080],
      [190020, 450080],
      [190020, 450020],
    ];
    expect(
      (
        await parseBoundaryFiles({
          ...fixture(),
          shp: shpFixture([shell, hole]),
        })
      ).features[0]?.geometry,
    ).toEqual({ type: 'Polygon', coordinates: [shell, hole] });
  });

  it('rejects nested shells with the same orientation', async () => {
    const shell = [
      [190000, 450000],
      [190000, 450100],
      [190100, 450100],
      [190100, 450000],
      [190000, 450000],
    ];
    const inner = [
      [190020, 450020],
      [190020, 450080],
      [190080, 450080],
      [190080, 450020],
      [190020, 450020],
    ];
    await expect(
      parseBoundaryFiles({ ...fixture(), shp: shpFixture([shell, inner]) }),
    ).rejects.toThrow(/nesting/i);
  });

  // 열린 링·점 부족·무한대 좌표를 자동으로 닫거나 보정하지 않고 거부해야 한다.
  it.each(
    [
      [
        [190000, 450000],
        [190000, 450100],
        [190100, 450100],
        [190001, 450000],
      ],
      [
        [190000, 450000],
        [190000, 450100],
        [190000, 450000],
      ],
      [
        [190000, 450000],
        [190000, Infinity],
        [190100, 450100],
        [190000, 450000],
      ],
    ].map((points) => ({ points })),
  )('rejects invalid rings without repairing them: %j', async ({ points }) => {
    await expect(
      parseBoundaryFiles({ ...fixture(), shp: shpFixture([points]) }),
    ).rejects.toThrow();
  });

  it('rejects deleted DBF records', async () => {
    const files = fixture();
    files.dbf[33 + fields.length * 32] = 42;
    await expect(parseBoundaryFiles(files)).rejects.toThrow(/deleted/i);
  });

  // 행 검증 실패 시 이미 읽은 건수와 체크섬은 남기되, 실패 행은 유효 건수에 포함하지 않는다.
  it('reports validation failure counts and the checksum without accepting rejected rows', async () => {
    const files = fixture();
    files.dbf = dbfFixture([
      ['11110515', '청운효자동', '190000', '450000', '0'],
    ]);
    await expect(parseBoundaryFiles(files)).rejects.toMatchObject({
      name: 'BoundarySourceError',
      fetchedRows: 1,
      validRows: 0,
      rejectedRows: 1,
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  // 바이트 위치별로 파일 식별자·버전·도형 종류를 바꿔 바이너리 구조 검증을 확인한다.
  it.each([
    [0, 1234, false],
    [28, 999, true],
    [32, 15, true],
    [108, 0, true],
  ])(
    'rejects unsupported SHP header or record values at %i',
    async (offset, value, littleEndian) => {
      const files = fixture();
      new DataView(
        files.shp.buffer,
        files.shp.byteOffset,
        files.shp.byteLength,
      ).setInt32(offset, value, littleEndian);
      await expect(parseBoundaryFiles(files)).rejects.toThrow();
    },
  );

  it('rejects DBF field lengths that do not equal the declared record length', async () => {
    const files = fixture();
    files.dbf[32 + 16] = 7;
    await expect(parseBoundaryFiles(files)).rejects.toThrow(/length/i);
  });

  it('rejects SHP and DBF count disagreement', async () => {
    const files = fixture();
    files.dbf = dbfFixture([]);
    await expect(parseBoundaryFiles(files)).rejects.toThrow(/count/i);
  });

  it.each(['shp', 'dbf'] as const)(
    'rejects truncated %s data',
    async (part) => {
      const files = fixture();
      files[part] = files[part].subarray(0, files[part].length - 10);
      await expect(parseBoundaryFiles(files)).rejects.toThrow();
    },
  );

  it('rejects unsupported encodings', async () => {
    await expect(
      parseBoundaryFiles({ ...fixture(), cpg: encode('CP949') }),
    ).rejects.toThrow(/encoding/i);
  });

  // 한글 경로·파일명이나 ZIP 포장 여부는 체크섬에 영향을 주지 않지만 원본 바이트 변경은 반영된다.
  it('uses identical checksums for ZIP and unpacked source bytes', async () => {
    const files = fixture();
    const archive = zipSync(
      Object.fromEntries(
        Object.entries(files).map(([extension, bytes]) => [
          `서울/행정동.${extension}`,
          bytes,
        ]),
      ),
    );
    expect(await parseBoundaryZip(archive)).toEqual(
      await parseBoundaryFiles(files),
    );
    const changed = { ...files, cpg: encode('UTF-8\n') };
    expect((await parseBoundaryFiles(changed)).checksum).not.toBe(
      (await parseBoundaryFiles(files)).checksum,
    );
  });

  // 보조 파일 누락, 여러 SHP 묶음, 대소문자만 다른 중복을 구별 없이 안전하게 거부한다.
  it.each(['missing', 'multiple', 'duplicate'])(
    'rejects %s ZIP shapefile parts',
    async (kind) => {
      const entries: Record<string, Uint8Array> = Object.fromEntries(
        Object.entries(fixture()).map(([extension, bytes]) => [
          `dong.${extension}`,
          bytes,
        ]),
      );
      if (kind === 'missing') delete entries['dong.prj'];
      if (kind === 'multiple') entries['other.shp'] = shpFixture();
      if (kind === 'duplicate') entries['dong.SHP'] = shpFixture();
      await expect(parseBoundaryZip(zipSync(entries))).rejects.toThrow();
    },
  );

  it('rejects unsupported source path extensions before reading', async () => {
    await expect(readBoundarySource('/no-source.json')).rejects.toThrow(
      /shp|zip/i,
    );
  });
});

// EPSG 번호 표기의 유무보다 실제 투영 정의와 축 순서를 기준으로 승인하는지 검증한다.
describe('validateProjection', () => {
  it('accepts the supplied EPSG:5181 ESRI WKT without AUTHORITY', () => {
    expect(() => validateProjection(projection)).not.toThrow();
  });

  it('accepts standard EPSG WKT aliases and east/north axes', () => {
    const wkt = projection
      .replace('D_Korea_2000', 'Geocentric_datum_of_Korea')
      .replace('GRS_1980', 'GRS 1980')
      .replace(
        /\]$/,
        ',AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","5181"]]',
      );
    expect(() => validateProjection(wkt)).not.toThrow();
  });

  it.each([
    ['500000.0', '600000.0'],
    ['200000.0', '0.0'],
    ['127.0', '129.0'],
    ['38.0', '0.0'],
    ['298.257222101', '298.257223563'],
    ['D_Korea_2000', 'WGS_1984'],
    ['Transverse_Mercator', 'Mercator'],
    ['"Meter",1.0', '"Foot",0.3048'],
    ['"Greenwich",0.0', '"Greenwich",1.0'],
  ])('rejects mismatched projection parameter %s', (from, to) => {
    expect(() => validateProjection(projection.replace(from, to))).toThrow();
  });

  it('rejects reversed axes even when AUTHORITY says 5181', () => {
    expect(() =>
      validateProjection(
        projection.replace(
          /\]$/,
          ',AXIS["Northing",NORTH],AXIS["Easting",EAST],AUTHORITY["EPSG","5181"]]',
        ),
      ),
    ).toThrow();
  });

  // 허용된 노드 안에 알 수 없는 하위 구문을 숨겨도 구조 검사에서 놓치지 않아야 한다.
  it('rejects unsupported clauses hidden inside a projection unit', () => {
    expect(() =>
      validateProjection(
        projection.replace(
          'UNIT["Meter",1.0]',
          'UNIT["Meter",1.0,AXIS["Northing",NORTH]]',
        ),
      ),
    ).toThrow();
  });
});
