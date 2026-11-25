import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { unzipSync } from 'fflate';
import type { MultiPolygon, Polygon } from 'geojson';
import { openShp } from 'shapefile';
import { z } from 'zod';

// 원본 EPSG:5181 좌표의 경계와 적재에 필요한 속성이다. 면적은 정밀도를 보존하는 정수 문자열이다.
export type BoundaryFeature = {
  dongCode: string;
  dongName: string;
  areaM2: string;
  geometry: Polygon | MultiPolygon;
};

export type BoundarySource = { checksum: string; features: BoundaryFeature[] };
type BoundaryFiles = {
  shp: Uint8Array;
  dbf: Uint8Array;
  prj: Uint8Array;
  cpg: Uint8Array;
};
const extensions = ['shp', 'dbf', 'prj', 'cpg'] as const;

// 원본 검증 실패도 배치 이력에 남길 수 있도록, 확인한 건수와 원본 체크섬을 오류에 함께 담는다.
export class BoundarySourceError extends Error {
  readonly fetchedRows: number;
  readonly validRows: number;
  readonly rejectedRows: number;
  readonly checksum?: string;

  constructor(
    message: string,
    metadata: {
      fetchedRows?: number;
      validRows?: number;
      rejectedRows?: number;
      checksum?: string;
    } = {},
  ) {
    super(message);
    this.name = 'BoundarySourceError';
    this.fetchedRows = metadata.fetchedRows ?? 0;
    this.validRows = metadata.validRows ?? 0;
    this.rejectedRows = metadata.rejectedRows ?? 0;
    this.checksum = metadata.checksum;
  }
}

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// 잘못된 UTF-8을 대체 문자로 바꾸면 원본 이름이 손상된 채 적재되므로 즉시 실패시킨다.
const decode = (bytes: Uint8Array) =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const normalize = (name: string) => name.toLowerCase().replace(/[ _]/g, '');
type WktNode = { key: string; values: (string | number | WktNode)[] };

// WKT1만 받으며 중첩 구조를 해석한다. EPSG 표기만 믿으면 다른 단위·축·투영 매개변수를 놓칠 수 있다.
function parseWkt(input: string): WktNode {
  const tokens =
    input.match(
      /"(?:[^"]|"")*"|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[[\],]|\S/g,
    ) ?? [];
  let position = 0;
  function node(): WktNode {
    const key = tokens[position++];
    requireValid(
      key && /^[A-Z_]+$/i.test(key) && tokens[position++] === '[',
      'Unsupported projection WKT',
    );
    const values: WktNode['values'] = [];
    while (true) {
      const token = tokens[position++];
      requireValid(token !== undefined, 'Truncated projection WKT');
      if (tokens[position] === '[') {
        position -= 1;
        values.push(node());
      } else if (token.startsWith('"'))
        values.push(token.slice(1, -1).replace(/""/g, '"'));
      else if (/^[-+\d.]/.test(token)) {
        const value = Number(token);
        requireValid(Number.isFinite(value), 'Invalid projection number');
        values.push(value);
      } else {
        requireValid(/^[A-Z_]+$/i.test(token), 'Invalid projection token');
        values.push(token);
      }
      const separator = tokens[position++];
      if (separator === ']') break;
      requireValid(separator === ',', 'Invalid projection separator');
    }
    return { key: key.toUpperCase(), values };
  }
  const result = node();
  requireValid(position === tokens.length, 'Trailing projection WKT');
  return result;
}

function children(node: WktNode, key: string) {
  return node.values.filter(
    (value): value is WktNode => typeof value === 'object' && value.key === key,
  );
}

function child(node: WktNode, key: string) {
  const matches = children(node, key);
  requireValid(matches.length === 1, `Projection requires one ${key}`);
  return matches[0]!;
}

function allowedChildren(node: WktNode, keys: string[], scalarCount = 1) {
  requireValid(
    node.values.length >= scalarCount &&
      node.values.every((value, index) =>
        index < scalarCount
          ? typeof value !== 'object'
          : typeof value === 'object' && keys.includes(value.key),
      ),
    'Unsupported projection clause',
  );
}

function named(node: WktNode, names: string[]) {
  requireValid(
    typeof node.values[0] === 'string' &&
      names.some(
        (name) => normalize(name) === normalize(node.values[0] as string),
      ),
    `Unexpected projection ${node.key}`,
  );
}

function numeric(node: WktNode, index: number, expected: number) {
  const actual = node.values[index];
  requireValid(
    typeof actual === 'number' &&
      Math.abs(actual - expected) <= Math.abs(expected) * 1e-13,
    `Unexpected projection ${node.key} value`,
  );
}

// PRJ의 실제 정의가 EPSG:5181과 맞는지 검사한다. 좌표 변환은 이후 DB 적재 단계에서 수행한다.
export function validateProjection(prj: string): void {
  const root = parseWkt(prj.trim());
  requireValid(root.key === 'PROJCS', 'Expected EPSG:5181 projected WKT1');
  allowedChildren(root, [
    'GEOGCS',
    'PROJECTION',
    'PARAMETER',
    'UNIT',
    'AXIS',
    'AUTHORITY',
  ]);
  const geo = child(root, 'GEOGCS');
  allowedChildren(geo, ['DATUM', 'PRIMEM', 'UNIT', 'AUTHORITY', 'AXIS']);
  named(geo, ['GCS_Korea_2000', 'Korea 2000']);
  const datum = child(geo, 'DATUM');
  allowedChildren(datum, ['SPHEROID', 'AUTHORITY']);
  named(datum, [
    'D_Korea_2000',
    'Geocentric datum of Korea',
    'Korean Geodetic Datum 2002',
  ]);
  const spheroid = child(datum, 'SPHEROID');
  allowedChildren(spheroid, ['AUTHORITY'], 3);
  named(spheroid, ['GRS 1980']);
  numeric(spheroid, 1, 6378137);
  numeric(spheroid, 2, 298.257222101);
  const prime = child(geo, 'PRIMEM');
  allowedChildren(prime, ['AUTHORITY'], 2);
  named(prime, ['Greenwich']);
  numeric(prime, 1, 0);
  const degrees = child(geo, 'UNIT');
  allowedChildren(degrees, ['AUTHORITY'], 2);
  named(degrees, ['Degree']);
  numeric(degrees, 1, Math.PI / 180);
  const method = child(root, 'PROJECTION');
  allowedChildren(method, ['AUTHORITY']);
  named(method, ['Transverse Mercator']);
  const meters = child(root, 'UNIT');
  allowedChildren(meters, ['AUTHORITY'], 2);
  named(meters, ['Meter', 'Metre']);
  numeric(meters, 1, 1);
  // 투영 원점과 단위를 포함한 값이 일치해야 같은 좌표를 같은 위치로 해석할 수 있다.
  const expected = new Map([
    ['falseeasting', 200000],
    ['falsenorthing', 500000],
    ['centralmeridian', 127],
    ['scalefactor', 1],
    ['latitudeoforigin', 38],
  ]);
  const parameters = children(root, 'PARAMETER');
  requireValid(
    parameters.length === expected.size,
    'Unexpected projection parameters',
  );
  for (const parameter of parameters) {
    requireValid(
      typeof parameter.values[0] === 'string',
      'Invalid projection parameter',
    );
    const name = normalize(parameter.values[0]);
    const value = expected.get(name);
    requireValid(
      value !== undefined && parameter.values.length === 2,
      'Unexpected or duplicate projection parameter',
    );
    numeric(parameter, 1, value);
    expected.delete(name);
  }
  for (const [node, names, directions] of [
    [root, ['Easting', 'Northing'], ['EAST', 'NORTH']],
    [geo, ['Longitude', 'Latitude'], ['EAST', 'NORTH']],
  ] as const) {
    const axes = children(node, 'AXIS');
    requireValid(
      axes.length === 0 || axes.length === 2,
      'Unexpected projection axes',
    );
    axes.forEach((axis, index) => {
      named(axis, [names[index]!]);
      requireValid(
        axis.values.length === 2 && axis.values[1] === directions[index],
        'Unexpected projection axis direction',
      );
    });
  }
  // AUTHORITY가 없는 ESRI WKT도 허용하지만, 표기가 있다면 검증한 좌표계와 일치해야 한다.
  const authorities = children(root, 'AUTHORITY');
  requireValid(authorities.length <= 1, 'Duplicate projection authority');
  authorities.forEach((authority) =>
    requireValid(
      authority.values[0] === 'EPSG' && authority.values[1] === '5181',
      'Unexpected projection authority',
    ),
  );
}

// 좌표의 유한성·링 폐쇄·GeoJSON 구조를 검사한다. 도형의 전체 공간 유효성은 이후 PostGIS에서 검사한다.
const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const ringSchema = z
  .array(pointSchema)
  .min(4)
  .refine((ring) => {
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    return first[0] === last[0] && first[1] === last[1];
  }, 'Polygon rings must be closed');
const polygonCoordinatesSchema = z.array(ringSchema).min(1);
const geometrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('Polygon'),
    coordinates: polygonCoordinatesSchema,
  }),
  z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(polygonCoordinatesSchema).min(1),
  }),
]);
const attributesSchema = z.object({
  dongCode: z.string().regex(/^[0-9]{8}$/),
  dongName: z
    .string()
    .min(1)
    .regex(/\p{L}/u)
    .refine(
      (value) =>
        [...value].every((character) => {
          const code = character.codePointAt(0)!;
          return code >= 32 && (code < 127 || code > 159) && code !== 65533;
        }),
      'Invalid dong name',
    ),
  centerX: z.number().int().min(50000).max(400000),
  centerY: z.number().int().min(100000).max(700000),
  areaM2: z
    .string()
    .regex(/^[0-9]+$/)
    .refine(
      (value) => BigInt(value) > 0n && BigInt(value) <= 9223372036854775807n,
      'Area must be a positive int64',
    ),
});

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

type Ring = [number, number][];

// 부호로 SHP 링의 역할을 구분한다. 이 계산에서는 시계 방향 외곽선이 양수, 반시계 방향 구멍이 음수다.
function ringArea(ring: Ring): number {
  let area = 0;
  for (let index = 1; index < ring.length; index += 1) {
    const previous = ring[index - 1]!;
    const current = ring[index]!;
    area += previous[1] * current[0] - previous[0] * current[1];
  }
  return area;
}

// 포함 관계를 판별할 때 경계 위 점을 구별하도록 내부는 1, 경계는 0, 외부는 -1을 돌려준다.
function pointInRing(ring: Ring, [x, y]: [number, number]): number {
  let inside = false;
  for (let index = 1; index < ring.length; index += 1) {
    const [ax, ay] = ring[index - 1]!;
    const [bx, by] = ring[index]!;
    if (
      (x - ax) * (by - ay) === (y - ay) * (bx - ax) &&
      x >= Math.min(ax, bx) &&
      x <= Math.max(ax, bx) &&
      y >= Math.min(ay, by) &&
      y <= Math.max(ay, by)
    )
      return 0;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside ? 1 : -1;
}

// 경계 위 점은 건너뛰고 첫 판별 가능한 점을 사용한다. 모든 점이 경계에 있으면 포함으로 보지 않는다.
function containsRing(shell: Ring, ring: Ring): boolean {
  for (const point of ring) {
    const containment = pointInRing(shell, point);
    if (containment !== 0) return containment > 0;
  }
  return false;
}

function validateRingNesting(rings: Ring[]): void {
  const areas = rings.map(ringArea);
  requireValid(
    areas.every((area) => Number.isFinite(area) && area !== 0),
    'Invalid SHP ring area',
  );
  // shapefile 라이브러리는 외곽선 밖의 반시계 방향 구멍을 외곽선으로 승격한다.
  // 원본 링의 역할을 먼저 확인하고, 라이브러리 해석으로 묶음이 바뀌는 입력은 거부한다.
  for (let index = 0; index < rings.length; index += 1) {
    const ring = rings[index]!;
    const area = areas[index]!;
    let parent: number | undefined;
    for (let candidate = 0; candidate < rings.length; candidate += 1) {
      if (candidate === index || Math.abs(areas[candidate]!) <= Math.abs(area))
        continue;
      if (
        containsRing(rings[candidate]!, ring) &&
        (parent === undefined ||
          Math.abs(areas[candidate]!) < Math.abs(areas[parent]!))
      )
        parent = candidate;
    }
    // 가장 작은 포함 링을 부모로 삼아 외곽선과 구멍이 번갈아 중첩되는지 확인한다.
    requireValid(
      parent === undefined ? area > 0 : area > 0 !== areas[parent]! > 0,
      'Invalid SHP shell/hole nesting or orphan hole',
    );
    if (area < 0) {
      const assignedShell = rings.findIndex(
        (shell, candidate) =>
          areas[candidate]! > 0 && containsRing(shell, ring),
      );
      requireValid(
        assignedShell === parent,
        'Unsupported SHP hole nesting; parser would change its containing shell',
      );
    }
  }
}

// 라이브러리 파싱 전에 원본 SHP 구조와 링을 검사하고, DBF와 대조할 레코드 수를 반환한다.
function validateShp(bytes: Uint8Array): number {
  requireValid(bytes.length >= 100, 'Truncated SHP header');
  const data = view(bytes);
  requireValid(
    data.getInt32(0) === 9994 &&
      data.getInt32(28, true) === 1000 &&
      data.getInt32(32, true) === 5,
    'SHP must be version 1000 Polygon (type 5)',
  );
  // 파일·레코드 길이는 16비트 워드 단위의 빅 엔디언 값이므로 바이트 단위로 환산한다.
  requireValid(
    data.getInt32(24) * 2 === bytes.length,
    'SHP declared length mismatch',
  );
  let count = 0;
  for (let offset = 100; offset < bytes.length;) {
    requireValid(offset + 8 <= bytes.length, 'Truncated SHP record header');
    const length = data.getInt32(offset + 4) * 2;
    const start = offset + 8;
    // 레코드 번호는 1부터 연속되어야 하며, 선언된 본문이 실제 버퍼 안에 모두 있어야 한다.
    requireValid(
      data.getInt32(offset) === count + 1 &&
        length >= 44 &&
        start + length <= bytes.length,
      'Invalid SHP record length or index',
    );
    requireValid(
      data.getInt32(start, true) === 5,
      'SHP record must be Polygon',
    );
    // Polygon 본문은 리틀 엔디언이며, 고정 영역 뒤에 링 시작 인덱스와 XY 좌표 쌍이 이어진다.
    const parts = data.getInt32(start + 36, true);
    const points = data.getInt32(start + 40, true);
    requireValid(
      parts > 0 && points >= 4 && length === 44 + parts * 4 + points * 16,
      'Invalid SHP polygon length',
    );
    const pointStart = start + 44 + parts * 4;
    const rings: Ring[] = [];
    for (let part = 0; part < parts; part += 1) {
      const first = data.getInt32(start + 44 + part * 4, true);
      const end =
        part + 1 < parts ? data.getInt32(start + 48 + part * 4, true) : points;
      // 링 인덱스는 바이트 위치가 아니라 점 배열의 위치다. 각 링은 닫힌 최소 네 점을 가져야 한다.
      requireValid(
        (part !== 0 || first === 0) &&
          first >= 0 &&
          end <= points &&
          end - first >= 4,
        'Invalid SHP ring offsets',
      );
      const ring: number[][] = [];
      for (let index = first; index < end; index += 1)
        ring.push([
          data.getFloat64(pointStart + index * 16, true),
          data.getFloat64(pointStart + index * 16 + 8, true),
        ]);
      rings.push(ringSchema.parse(ring));
    }
    validateRingNesting(rings);
    count += 1;
    offset = start + length;
  }
  requireValid(count > 0, 'SHP contains no polygons');
  return count;
}

// DBF 헤더를 검증한 뒤 행별 속성 읽기 기능을 제공한다. 숫자 자동 변환 없이 원문을 직접 읽는다.
function parseDbf(bytes: Uint8Array) {
  requireValid(
    bytes.length >= 33 && bytes[0] === 3,
    'Unsupported or truncated DBF header',
  );
  const data = view(bytes);
  const count = data.getUint32(4, true);
  const headerLength = data.getUint16(8, true);
  const rowLength = data.getUint16(10, true);
  requireValid(
    headerLength >= 33 &&
      (headerLength - 33) % 32 === 0 &&
      headerLength <= bytes.length &&
      bytes[headerLength - 1] === 13,
    'Invalid DBF header length',
  );
  // 선언된 행 수와 실제 길이가 맞아야 하며, 마지막의 선택적 DBF 종료 바이트만 허용한다.
  const requiredLength = headerLength + count * rowLength;
  requireValid(
    requiredLength === bytes.length ||
      (requiredLength + 1 === bytes.length && bytes[requiredLength] === 26),
    'DBF row count or truncated data mismatch',
  );
  const fields = new Map<
    string,
    { offset: number; length: number; type: number; scale: number }
  >();
  // 각 행 첫 바이트는 삭제 여부 표시이고, 필드 설명자의 길이를 누적해 속성 위치를 구한다.
  let fieldOffset = 1;
  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    const rawName = bytes.subarray(offset, offset + 11);
    const name = decode(
      rawName.subarray(0, rawName.indexOf(0) < 0 ? 11 : rawName.indexOf(0)),
    );
    const length = bytes[offset + 16]!;
    requireValid(
      name && !fields.has(name) && length > 0,
      'Duplicate or invalid DBF field',
    );
    fields.set(name, {
      offset: fieldOffset,
      length,
      type: bytes[offset + 11]!,
      scale: bytes[offset + 17]!,
    });
    fieldOffset += length;
  }
  requireValid(fieldOffset === rowLength, 'DBF actual row length mismatch');
  // 원본 DBF에 실제 저장된 필드명을 사용한다. C는 문자, N은 숫자이며 소수 자릿수는 0이어야 한다.
  for (const [name, type] of [
    ['ADSTRD_CD', 67],
    ['ADSTRD_NM', 67],
    ['XCNTS_VALU', 78],
    ['YDNTS_VALU', 78],
    ['RELM_AR', 78],
  ] as const) {
    const field = fields.get(name);
    requireValid(
      field && field.type === type && field.scale === 0,
      `Missing or unsupported DBF field ${name}`,
    );
  }
  return {
    count,
    row(index: number) {
      const offset = headerLength + rowLength * index;
      requireValid(bytes[offset] === 32, 'Deleted or invalid DBF row');
      function text(name: string) {
        const field = fields.get(name)!;
        return decode(
          bytes.subarray(
            offset + field.offset,
            offset + field.offset + field.length,
          ),
        ).trim();
      }
      function integer(name: string) {
        const value = text(name);
        requireValid(
          /^-?[0-9]+$/.test(value),
          `DBF ${name} must be an integer`,
        );
        return Number(value);
      }
      return attributesSchema.parse({
        dongCode: text('ADSTRD_CD'),
        dongName: text('ADSTRD_NM'),
        centerX: integer('XCNTS_VALU'),
        centerY: integer('YDNTS_VALU'),
        // N(38,0) 면적을 Number로 바꾸면 안전 정수 범위를 넘는 값이 반올림될 수 있다.
        // 원문 문자열을 정수 형식·int64 범위로 검증하고 이후 BigInt로 정규화한다.
        areaM2: text('RELM_AR'),
      });
    },
  };
}

// 네 원본 파일을 검증해 경계 목록과 체크섬을 반환한다. 첫 실패에서 중단하며 입력을 보정하지 않는다.
export async function parseBoundaryFiles(
  files: BoundaryFiles,
): Promise<BoundarySource> {
  // 압축 방식·파일명과 무관하게 네 파일의 원본 바이트를 고정 순서로 해시한다.
  // 확장자와 길이도 넣어 파일 경계가 다른 바이트 조합을 구분한다.
  const hash = createHash('sha256');
  for (const extension of extensions) {
    hash.update(`${extension}:${files[extension].length}:`);
    hash.update(files[extension]);
  }
  const checksum = hash.digest('hex');
  let fetchedRows = 0;
  let validRows = 0;
  let validatingRows = false;
  try {
    const encoding = decode(files.cpg).trim().toUpperCase();
    requireValid(
      ['UTF-8', 'UTF8', '65001'].includes(encoding),
      'Unsupported DBF encoding; UTF-8 CPG is required',
    );
    validateProjection(decode(files.prj));
    const dbf = parseDbf(files.dbf);
    fetchedRows = dbf.count;
    requireValid(
      validateShp(files.shp) === fetchedRows,
      'SHP and DBF record count mismatch',
    );
    const source = await openShp(files.shp);
    const features: BoundaryFeature[] = [];
    const codes = new Set<string>();
    // 파일 구조 검증이 끝난 뒤에만 행 검증을 시작한다. 속성과 도형이 모두 통과한 행만 유효 건수다.
    validatingRows = true;
    for (let index = 0; index < fetchedRows; index += 1) {
      const attributes = dbf.row(index);
      requireValid(
        !codes.has(attributes.dongCode),
        `Duplicate dong code ${attributes.dongCode}`,
      );
      const record = await source.read();
      requireValid(!record.done, 'SHP record count mismatch');
      const geometry = geometrySchema.parse(record.value);
      codes.add(attributes.dongCode);
      features.push({
        dongCode: attributes.dongCode,
        dongName: attributes.dongName,
        areaM2: BigInt(attributes.areaM2).toString(),
        geometry,
      });
      validRows += 1;
    }
    requireValid((await source.read()).done, 'SHP record count mismatch');
    return { checksum, features };
  } catch (error) {
    throw new BoundarySourceError(
      error instanceof Error ? error.message : String(error),
      {
        checksum,
        fetchedRows,
        validRows,
        // 첫 실패 행만 거부 건수에 포함한다. 미검증 행이나 파일 전체 오류를 행 거부로 세지 않는다.
        rejectedRows: validatingRows ? 1 : 0,
      },
    );
  }
}

// 경로와 이름 몸통이 같은 SHP·DBF·PRJ·CPG 한 묶음만 선택한다. 대소문자 차이는 허용한다.
// 누락·중복·다른 묶음을 거부해 서로 다른 경계의 도형과 속성이 섞이는 것을 막는다.
function selectParts(
  names: string[],
): Record<(typeof extensions)[number], string> {
  const relevant = names.filter((name) =>
    extensions.some((extension) =>
      name.toLowerCase().endsWith(`.${extension}`),
    ),
  );
  const shapes = relevant.filter(
    (name) => extname(name).toLowerCase() === '.shp',
  );
  requireValid(shapes.length === 1, 'Expected exactly one shapefile group');
  const stem = shapes[0]!.slice(0, -4).toLowerCase();
  const result = {} as Record<(typeof extensions)[number], string>;
  for (const extension of extensions) {
    const matches = relevant.filter(
      (name) => name.toLowerCase() === `${stem}.${extension}`,
    );
    requireValid(
      matches.length === 1,
      `Missing or duplicate .${extension} sidecar`,
    );
    result[extension] = matches[0]!;
  }
  requireValid(
    relevant.length === extensions.length,
    'Unexpected shapefile sidecar group',
  );
  return result;
}

// ZIP을 디스크에 풀지 않고 메모리에서 읽는다. 관련 없는 항목은 압축 해제 대상에서 제외한다.
export async function parseBoundaryZip(
  bytes: Uint8Array,
): Promise<BoundarySource> {
  try {
    const names: string[] = [];
    const contents = unzipSync(bytes, {
      filter(file) {
        if (
          extensions.some((extension) =>
            file.name.toLowerCase().endsWith(`.${extension}`),
          )
        ) {
          names.push(file.name);
          return true;
        }
        return false;
      },
    });
    const parts = selectParts(names);
    return await parseBoundaryFiles({
      shp: contents[parts.shp]!,
      dbf: contents[parts.dbf]!,
      prj: contents[parts.prj]!,
      cpg: contents[parts.cpg]!,
    });
  } catch (error) {
    if (error instanceof BoundarySourceError) throw error;
    throw new BoundarySourceError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ZIP 또는 SHP 경로를 입력받아 같은 검증 경로로 보낸다. SHP의 보조 파일은 같은 디렉터리에서 찾는다.
export async function readBoundarySource(
  path: string,
): Promise<BoundarySource> {
  try {
    const extension = extname(path).toLowerCase();
    requireValid(
      extension === '.shp' || extension === '.zip',
      'Boundary source path must end in .shp or .zip',
    );
    if (extension === '.zip')
      return await parseBoundaryZip(await readFile(path));
    const directory = dirname(path);
    const stem = basename(path).slice(0, -4).toLowerCase();
    const names = (await readdir(directory)).filter(
      (name) => name.slice(0, -4).toLowerCase() === stem,
    );
    const parts = selectParts(names);
    const [shp, dbf, prj, cpg] = await Promise.all(
      extensions.map((part) => readFile(join(directory, parts[part]))),
    );
    return await parseBoundaryFiles({
      shp: shp!,
      dbf: dbf!,
      prj: prj!,
      cpg: cpg!,
    });
  } catch (error) {
    if (error instanceof BoundarySourceError) throw error;
    throw new BoundarySourceError(
      error instanceof Error ? error.message : String(error),
    );
  }
}
