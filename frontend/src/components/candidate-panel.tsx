import { useCallback, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  useRegionRequest,
  type RegionResource,
} from '@/hooks/use-region-explorer';
import { useStatisticsExplorer } from '@/hooks/use-statistics-explorer';
import type { Candidates } from '@/hooks/use-candidates';
import { candidateNameLimit, type Candidate } from '@/lib/candidates';
import { fetchNearbyCafes } from '@/lib/cafes';
import { fetchContainingRegions } from '@/lib/regions';
import { formatStatistic } from '@/lib/statistics';

function Result<T>({
  resource,
  label,
  children,
}: {
  resource: RegionResource<T>;
  label: string;
  children: (data: T) => ReactNode;
}) {
  if (resource.status === 'loading')
    return <span role="status">불러오는 중</span>;
  if (resource.status === 'error')
    return (
      <div className="space-y-1">
        <p role="alert">{resource.error}</p>
        <Button
          size="sm"
          variant="outline"
          aria-label={`${label} 다시 시도`}
          onClick={resource.retry}
        >
          다시 시도
        </Button>
      </div>
    );
  return resource.data === null ? '자료 없음' : children(resource.data);
}

function Publication({ publishedAt }: { publishedAt: string }) {
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      게시 <time dateTime={publishedAt}>{publishedAt}</time>
    </p>
  );
}

const metricLabels = [
  '소속 지역',
  '반경 내 경쟁 카페',
  '행정동 점포',
  '당월 추정매출',
  '전체 유동인구',
];

function CandidateMetrics({
  item,
  radius,
  active,
  compare,
}: {
  item: Candidate;
  radius: Candidates['radius'];
  active: boolean;
  compare: boolean;
}) {
  const { longitude, latitude, slot } = item;
  const key = `${longitude}:${latitude}`;
  const regions = useRegionRequest(
    active ? key : null,
    useCallback(
      (signal) => fetchContainingRegions(longitude, latitude, signal),
      [longitude, latitude],
    ),
  );
  const districtCount = regions.data?.districts.length ?? 0;
  const withinSeoul = districtCount > 0;
  const soleDistrict = districtCount === 1 ? regions.data?.districts[0] : null;
  const soleDong =
    regions.data?.dongs.length === 1 ? regions.data.dongs[0] : null;
  const dong =
    soleDistrict && soleDong?.districtCode === soleDistrict.districtCode
      ? soleDong
      : null;
  const statistics = useStatisticsExplorer('', dong?.dongCode ?? '', active);
  const cafes = useRegionRequest(
    active && withinSeoul ? `${key}:${radius}` : null,
    useCallback(
      (signal) => fetchNearbyCafes({ longitude, latitude }, radius, signal),
      [longitude, latitude, radius],
    ),
  );
  const unavailable =
    regions.status === 'loading'
      ? '소속 확인 중'
      : regions.status === 'error'
        ? '소속 확인 실패'
        : !withinSeoul
          ? '서울 경계 밖'
          : districtCount > 1
            ? '여러 자치구 경계에 걸쳐 있어 행정동 통계를 비교할 수 없습니다.'
            : soleDong && !dong
              ? '자치구와 행정동의 소속 코드가 일치하지 않아 비교할 수 없습니다.'
              : '행정동을 하나로 확인할 수 없어 비교할 수 없습니다.';
  const cells = [
    <Result resource={regions} label={`${slot} 소속 지역`}>
      {({ districts, dongs }) =>
        districts.length ? (
          <>
            <p>
              {districts.map((district) => district.districtName).join(' · ')}
            </p>
            <p>
              {dongs.length
                ? dongs.map((area) => area.dongName).join(' · ')
                : '소속 행정동 없음'}
            </p>
            {districts.length > 1 && <p>여러 자치구 경계에 걸쳐 있습니다.</p>}
            {dongs.length > 1 && (
              <p>
                여러 행정동 경계에 걸쳐 있어 행정동 통계를 비교할 수 없습니다.
              </p>
            )}
          </>
        ) : (
          '서울 경계 밖'
        )
      }
    </Result>,
    withinSeoul ? (
      <Result resource={cafes} label={`${slot} 경쟁 카페`}>
        {(page) => (
          <>
            <p>{formatStatistic(String(page.totalCount))}곳</p>
            <Publication publishedAt={page.sourceBatch.publishedAt} />
          </>
        )}
      </Result>
    ) : (
      unavailable
    ),
    dong ? (
      <Result resource={statistics.stores} label={`${slot} 점포`}>
        {({ data }) =>
          data ? (
            <>
              <p>전체 {formatStatistic(data.storeCount)}</p>
              <p>
                개업 {formatStatistic(data.openedStoreCount)} · 폐업{' '}
                {formatStatistic(data.closedStoreCount)}
              </p>
              <Publication publishedAt={data.sourceBatch.publishedAt} />
            </>
          ) : (
            '자료 없음'
          )
        }
      </Result>
    ) : (
      unavailable
    ),
    dong ? (
      <Result resource={statistics.sales} label={`${slot} 추정매출`}>
        {({ data }) =>
          data ? (
            <>
              <p>
                {formatStatistic(data.monthlySalesAmount)}
                {data.monthlySalesAmount === null ? '' : '원'}
              </p>
              <Publication publishedAt={data.sourceBatch.publishedAt} />
            </>
          ) : (
            '자료 없음'
          )
        }
      </Result>
    ) : (
      unavailable
    ),
    dong ? (
      <Result resource={statistics.footTraffic} label={`${slot} 유동인구`}>
        {({ data }) =>
          data ? (
            <>
              <p>
                {formatStatistic(data.totalFootTraffic)}
                {data.totalFootTraffic === null ? '' : '명'}
              </p>
              <Publication publishedAt={data.sourceBatch.publishedAt} />
            </>
          ) : (
            '자료 없음'
          )
        }
      </Result>
    ) : (
      unavailable
    ),
  ];
  if (compare)
    return (
      <tr className="border-t align-top">
        <th scope="row" className="p-3 text-left [overflow-wrap:anywhere]">
          {slot} · {item.name}
        </th>
        {cells.map((cell, index) => (
          <td key={metricLabels[index]} className="p-3">
            {cell}
          </td>
        ))}
      </tr>
    );
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm">
      {cells.map((cell, index) => (
        <div
          key={metricLabels[index]}
          className="min-w-0 rounded-lg border p-3 [overflow-wrap:anywhere]"
        >
          <dt className="mb-1 font-medium">{metricLabels[index]}</dt>
          <dd>{cell}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CandidatePanel({
  candidates,
  active,
  mapReady,
  onSelect,
}: {
  candidates: Candidates;
  active: boolean;
  mapReady: boolean;
  onSelect: (item: Candidate) => void;
}) {
  const { items, picking, pending, notice, radius } = candidates;
  const compare = items.length > 1;
  return (
    <div className="flex min-w-0 flex-col gap-5 p-5">
      <p className="text-sm text-muted-foreground">
        후보지를 최대 3곳까지 등록할 수 있습니다. 목록은 이 브라우저 탭에 임시
        저장됩니다.
      </p>
      <Button
        variant="outline"
        aria-pressed={picking}
        disabled={!mapReady || pending || items.length >= 3}
        onClick={() => candidates.setPicking(!picking)}
      >
        {picking ? '지도 추가 모드 끄기' : '지도에서 후보지 추가'}
      </Button>
      {picking && (
        <p role="status" className="text-sm">
          지도에서 등록할 위치를 클릭하세요.
        </p>
      )}
      {pending && (
        <p role="status" className="text-sm">
          후보지가 서울 경계에 속하는지 확인 중입니다.
        </p>
      )}
      {notice && (
        <div role={notice.error ? 'alert' : 'status'} className="text-sm">
          <p>{notice.message}</p>
          {notice.retry && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void candidates.add(notice.retry!)}
            >
              등록 다시 시도
            </Button>
          )}
        </div>
      )}
      {candidates.storageUnavailable && (
        <p role="alert" className="text-sm">
          탭 저장소를 사용할 수 없어 새로고침하면 목록이 사라집니다.
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-sm">
          등록된 후보지가 없습니다. 지도 또는 장소 검색에서 추가하세요.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.slot} className="space-y-2 rounded-lg border p-3">
              <Button
                variant={
                  candidates.selected === item.slot ? 'default' : 'outline'
                }
                className="h-auto w-full justify-start whitespace-normal [overflow-wrap:anywhere]"
                aria-pressed={candidates.selected === item.slot}
                disabled={!mapReady}
                onClick={() => onSelect(item)}
              >
                {item.slot} · {item.name}
              </Button>
              <p className="text-xs text-muted-foreground">
                경도 {item.longitude.toFixed(6)} · 위도{' '}
                {item.latitude.toFixed(6)}
              </p>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const input = event.currentTarget.elements.namedItem(
                    'name',
                  ) as HTMLInputElement;
                  candidates.rename(item.slot, input.value);
                  input.value = input.value.trim() || item.name;
                }}
              >
                <input
                  key={item.name}
                  name="name"
                  aria-label={`후보지 ${item.slot} 이름`}
                  defaultValue={item.name}
                  required
                  maxLength={candidateNameLimit}
                  className="h-8 min-w-0 flex-1 rounded-md border px-2 text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  aria-label={`후보지 ${item.slot} 이름 저장`}
                >
                  저장
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`후보지 ${item.slot} 삭제`}
                  onClick={() => candidates.remove(item.slot)}
                >
                  삭제
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <section
        aria-label="비교 결과"
        className="min-w-0 space-y-3 border-t pt-4"
      >
        <h3 className="text-sm font-semibold">
          {compare ? '후보지 비교표' : '후보지 정보'}
        </h3>
        <label className="flex items-center justify-between gap-2 text-sm">
          공통 탐색 반경
          <select
            value={radius}
            onChange={(event) =>
              candidates.setRadius(event.target.value === '1000' ? 1000 : 500)
            }
            className="h-9 rounded-md border bg-background px-2"
          >
            <option value="500">500m</option>
            <option value="1000">1km</option>
          </select>
        </label>
        {items.length > 0 && (
          <p className="text-xs leading-5 text-muted-foreground">
            경쟁 카페는 후보지 반경 내 전체 건수입니다. 상권 통계는 2026년 2분기
            행정동 전체 기준이며, 점포·당월 추정매출은 카페 업종, 유동인구는
            업종 구분 없이 집계합니다. 같은 행정동의 후보지는 동일한 행정동
            통계를 사용합니다. 카페 위치의 출처는 소상공인시장진흥공단
            상가(상권)정보이며, 통계의 출처는 서울시 상권분석서비스입니다. 게시
            시점은 각 자료에 표시합니다.
          </p>
        )}
        {compare ? (
          <div
            role="region"
            aria-label="후보지 비교표 가로 스크롤"
            tabIndex={0}
            className="max-w-full overflow-x-auto rounded-lg border"
          >
            <table
              aria-label="후보지 비교표"
              className="w-full min-w-[54rem] text-sm"
            >
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className="p-3 text-left">
                    후보지
                  </th>
                  {metricLabels.map((label) => (
                    <th key={label} scope="col" className="p-3 text-left">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <CandidateMetrics
                    key={item.slot}
                    item={item}
                    radius={radius}
                    active={active}
                    compare
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          items[0] && (
            <>
              <p className="text-sm">
                후보지를 한 곳 더 등록하면 비교표를 볼 수 있습니다.
              </p>
              <CandidateMetrics
                key={items[0].slot}
                item={items[0]}
                radius={radius}
                active={active}
                compare={false}
              />
            </>
          )
        )}
      </section>
    </div>
  );
}
