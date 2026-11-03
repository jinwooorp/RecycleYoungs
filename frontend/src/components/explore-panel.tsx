import {
  ChevronDown,
  Coffee,
  MapPin,
  Store,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';
import type {
  RegionExplorer,
  RegionResource,
} from '@/hooks/use-region-explorer';

export type ExploreMenu = 'region' | 'cafes' | 'analysis' | 'compare';

function PreparedSelect({
  label,
  describedBy,
}: {
  label: string;
  describedBy: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-xs font-medium">
      {label}
      <span className="relative block">
        <select
          disabled
          aria-describedby={describedBy}
          className="h-11 w-full min-w-0 appearance-none rounded-lg border bg-muted/50 pr-10 pl-3 text-sm disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-100"
        >
          <option>준비 중</option>
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </span>
    </label>
  );
}

function RegionSelect({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-xs font-medium">
      {label}
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="h-11 w-full min-w-0 appearance-none rounded-lg border bg-muted/50 pr-10 pl-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-100"
        >
          <option value="">전체</option>
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </span>
    </label>
  );
}

function ResourceNotice({
  resource,
  label,
  empty,
}: {
  resource: RegionResource<unknown>;
  label: string;
  empty?: boolean;
}) {
  if (resource.status === 'loading')
    return (
      <p role="status" className="text-xs leading-5 text-muted-foreground">
        {label} 불러오는 중…
      </p>
    );
  if (resource.status === 'error')
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-2 text-xs leading-5 text-muted-foreground"
      >
        <p>
          {label}: {resource.error}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={resource.retry}
          aria-label={`${label} 다시 시도`}
        >
          다시 시도
        </Button>
      </div>
    );
  if (resource.status === 'ready' && empty)
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        조회 가능한 {label}이 없습니다.
      </p>
    );
  return null;
}

/** 메뉴별 후속 연동 영역을 분리하고 실제 데이터가 없는 상태를 안내합니다. */
export function ExplorePanel({
  menu,
  region,
}: {
  menu: ExploreMenu;
  region: RegionExplorer;
}) {
  if (menu === 'region') return <RegionPanel region={region} />;
  if (menu === 'cafes') return <CafePanel />;
  if (menu === 'analysis') return <AnalysisPanel />;
  return <ComparePanel />;
}

function RegionPanel({ region }: { region: RegionExplorer }) {
  return (
    <div className="flex flex-col gap-6 p-5 break-keep text-pretty">
      <p className="text-sm leading-6 text-muted-foreground">
        서울의 자치구·행정동을 살펴보세요.
      </p>
      <section
        aria-labelledby="district-heading"
        className="flex flex-col gap-4"
      >
        <h3 id="district-heading" className="text-sm font-semibold">
          행정구역 선택
        </h3>
        <div className="flex items-center gap-2 rounded-lg bg-accent px-3 py-3 text-sm text-primary">
          <MapPin aria-hidden="true" className="size-4" />
          서울특별시 · 고정
        </div>
        <div className="grid grid-cols-2 gap-3">
          <RegionSelect
            label="자치구"
            value={region.districtCode}
            onChange={region.selectDistrict}
            disabled={
              region.districts.status !== 'ready' ||
              !region.districts.data?.length
            }
          >
            {region.districts.data?.map((item) => (
              <option key={item.districtCode} value={item.districtCode}>
                {item.districtName}
              </option>
            ))}
          </RegionSelect>
          <RegionSelect
            label="행정동"
            value={region.dongCode}
            onChange={region.selectDong}
            disabled={
              !region.districtCode ||
              region.dongs.status !== 'ready' ||
              !region.dongs.data?.length
            }
          >
            {region.dongs.data?.map((item) => (
              <option key={item.dongCode} value={item.dongCode}>
                {item.dongName}
              </option>
            ))}
          </RegionSelect>
        </div>
        <p
          id="district-help"
          className="text-xs leading-5 text-muted-foreground"
        >
          {region.districtCode
            ? '행정동 전체는 선택한 자치구를 의미합니다.'
            : '자치구를 선택하면 행정동을 조회합니다.'}
        </p>
        <ResourceNotice
          resource={region.districts}
          label="자치구 목록"
          empty={region.districts.data?.length === 0}
        />
        <ResourceNotice
          resource={region.dongs}
          label="행정동 목록"
          empty={region.dongs.data?.length === 0}
        />
        <ResourceNotice resource={region.boundary} label="선택 지역 경계" />
      </section>
      <p className="border-t pt-5 text-xs leading-5 text-muted-foreground">
        전체 통계는 ‘상권 분석’에 연동 예정입니다.
      </p>
    </div>
  );
}

function CafePanel() {
  return (
    <div className="flex flex-col gap-6 p-5 break-keep text-pretty">
      <section aria-labelledby="nearby-heading" className="flex flex-col gap-4">
        <h3 id="nearby-heading" className="text-sm font-semibold">
          위치 주변 정보
        </h3>
        <p className="text-sm leading-6 text-muted-foreground">
          관심 위치 주변의 경쟁 카페를 살펴봅니다.
        </p>
        <PreparedSelect label="탐색 반경" describedBy="radius-help" />
        <p id="radius-help" className="text-xs leading-5 text-muted-foreground">
          반경 설정은 준비 중입니다. 기본 500m, 최대 1km를 지원할 예정입니다.
        </p>
      </section>
      <section
        aria-labelledby="cafe-list-heading"
        className="flex flex-col gap-4 border-t pt-6"
      >
        <h3 id="cafe-list-heading" className="text-sm font-semibold">
          주변 경쟁 카페
        </h3>
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-5">
          <Coffee aria-hidden="true" className="size-5 text-primary" />
          <p className="text-sm font-medium">주변 카페 연동 준비 중</p>
          <p className="text-xs leading-5 text-muted-foreground">
            탐색 반경과 선택 자치구가 겹치는 영역의 카페를 연결할 예정입니다.
          </p>
        </div>
      </section>
    </div>
  );
}

function AnalysisPanel() {
  return (
    <div className="flex flex-col gap-6 p-5 break-keep text-pretty">
      <section aria-label="행정구역 전체 통계" className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">행정구역 전체 통계</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          구·행정동 전체 통계를 연결할 예정입니다.
        </p>
        <div className="rounded-lg bg-accent px-3 py-3 text-xs leading-5 text-primary">
          특정 위치의 반경 내 수치와는 다릅니다.
        </div>
        {/* 공개 승인 후에도 평가 범위와 기준 시점을 함께 안내하도록 이 영역을 확장합니다. */}
        <p className="text-sm font-medium">분석 데이터 연동 준비 중</p>
        <ul className="flex flex-col divide-y rounded-xl border px-4">
          {[
            {
              Icon: Store,
              label: '점포 현황',
              description: '점포 수와 개업·폐업 현황',
            },
            {
              Icon: TrendingUp,
              label: '추정매출',
              description: '지역의 분기별 추정매출',
            },
            {
              Icon: Users,
              label: '유동인구',
              description: '지역의 분기별 유동인구',
            },
          ].map(({ Icon, label, description }) => (
            <li key={label} className="flex items-start gap-3 py-4">
              <Icon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-primary"
              />
              <div className="flex flex-1 flex-col gap-1">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {description}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">준비 중</span>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-5 text-muted-foreground">
          연동 후 출처·기준 분기·집계 단위를 안내합니다.
        </p>
      </section>
    </div>
  );
}

function ComparePanel() {
  return (
    <div className="flex flex-col gap-6 p-5 break-keep text-pretty">
      <section
        aria-labelledby="candidate-heading"
        className="flex flex-col gap-4"
      >
        <h3 id="candidate-heading" className="text-sm font-semibold">
          관심 위치
        </h3>
        <p className="text-sm leading-6 text-muted-foreground">
          후보지는 비교를 위한 관심 위치이며, 상가 매물 정보가 아닙니다.
        </p>
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-5">
          <MapPin aria-hidden="true" className="size-5 text-primary" />
          <p className="text-sm font-medium">관심 위치 저장 준비 중</p>
          <p className="text-xs leading-5 text-muted-foreground">
            위치 지정·추가는 추후 제공됩니다.
          </p>
          <Button variant="outline" size="lg" disabled>
            후보지 추가 · 준비 중
          </Button>
        </div>
      </section>
      <section
        aria-label="비교 결과"
        className="flex flex-col gap-4 border-t pt-6"
      >
        <h3 className="text-sm font-semibold">비교 결과</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          비교 데이터 연동 준비 중
        </p>
        <dl className="flex flex-col gap-4 text-xs leading-5">
          <div>
            <dt className="font-medium">위치 주변 정보</dt>
            <dd className="mt-1 text-muted-foreground">
              후보지별 반경 내 경쟁 카페를 비교합니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium">행정구역 전체 통계</dt>
            <dd className="mt-1 text-muted-foreground">
              구·행정동의 점포·매출·인구를 같은 기간과 집계 단위로 비교합니다.
            </dd>
          </div>
        </dl>
        <p className="text-xs leading-5 text-muted-foreground">
          같은 행정동이어도 주변 카페 분포는 다를 수 있습니다.
        </p>
      </section>
    </div>
  );
}
