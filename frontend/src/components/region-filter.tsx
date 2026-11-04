import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, MapPin, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  RegionExplorer,
  RegionResource,
} from '@/hooks/use-region-explorer';

const desktopQuery = '(min-width: 64rem)';
const isDesktop = () =>
  !window.matchMedia || window.matchMedia(desktopQuery).matches;
function subscribeLayout(listener: () => void) {
  const media = window.matchMedia?.(desktopQuery);
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}

function ResourceNotice({
  resource,
  label,
  empty = false,
}: {
  resource: RegionResource<unknown>;
  label: string;
  empty?: boolean;
}) {
  if (resource.status === 'loading')
    return <p role="status">{label} 불러오는 중…</p>;
  if (resource.status === 'error')
    return (
      <div role="alert" className="region-filter-error">
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
    return <p role="status">조회 가능한 {label}이 없습니다.</p>;
  return null;
}

/** 업종과 독립적인 공통 지역 선택 UI입니다. 선택·요청 수명은 상위 훅이 유지합니다. */
export function RegionFilter({
  region,
  onOpen,
  panelOpen,
}: {
  region: RegionExplorer;
  onOpen: () => void;
  panelOpen: boolean;
}) {
  const desktop = useSyncExternalStore(subscribeLayout, isDesktop, () => true);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const district = useRef<HTMLSelectElement>(null);
  const expanded = desktop || open;
  const districtName = region.districts.data?.find(
    (item) => item.districtCode === region.districtCode,
  )?.districtName;
  const dongName = region.dongs.data?.find(
    (item) => item.dongCode === region.dongCode,
  )?.dongName;
  const resources = [region.districts, region.dongs, region.boundary];
  const needsNotice =
    resources.some(
      (resource) =>
        resource.status === 'error' || resource.status === 'loading',
    ) ||
    region.districts.data?.length === 0 ||
    region.dongs.data?.length === 0;
  const hasError = resources.some((resource) => resource.status === 'error');
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (desktop || !open) return;
    district.current?.focus();
    // 지도·검색창 등 다른 도구를 사용하면 팝오버만 닫고 해당 입력의 포커스를 유지합니다.
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [desktop, open]);
  return (
    <div
      ref={root}
      className="region-filter"
      data-compact={!desktop}
      data-open={open}
      data-panel-open={panelOpen}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !desktop && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      {!desktop && (
        <Button
          ref={trigger}
          variant="outline"
          aria-label="지역 필터"
          aria-expanded={open}
          aria-controls="region-filter-controls"
          onClick={() => {
            if (open) close();
            else {
              onOpen();
              setOpen(true);
            }
          }}
        >
          <SlidersHorizontal aria-hidden="true" data-icon="inline-start" />
          <span className="region-filter-summary">
            {dongName || districtName || '지역 필터'}
          </span>
          {hasError && <span aria-label="지역 데이터 확인 필요">!</span>}
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </Button>
      )}
      <div
        id="region-filter-controls"
        role="group"
        aria-label="지역 필터"
        className="region-filter-controls"
        hidden={!expanded}
      >
        {!desktop && (
          <div className="region-filter-heading">
            <h2>지역 필터</h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="지역 필터 닫기"
              onClick={close}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        )}
        <div className="region-filter-fields">
          <div className="region-filter-city">
            <span>시·도</span>
            <p>
              <MapPin aria-hidden="true" />
              서울특별시<span className="sr-only"> · 고정</span>
            </p>
          </div>
          <label className="region-filter-field">
            <span>자치구</span>
            <span className="region-filter-select">
              <select
                aria-label="자치구"
                ref={district}
                value={region.districtCode}
                aria-describedby="region-filter-help"
                onChange={(event) => region.selectDistrict(event.target.value)}
                disabled={
                  region.districts.status !== 'ready' ||
                  !region.districts.data?.length
                }
                data-selected={!!region.districtCode}
              >
                <option value="">자치구 전체</option>
                {region.districts.data?.map((item) => (
                  <option key={item.districtCode} value={item.districtCode}>
                    {item.districtName}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </span>
          </label>
          <label className="region-filter-field">
            <span>행정동</span>
            <span className="region-filter-select">
              <select
                aria-label="행정동"
                value={region.dongCode}
                aria-describedby="region-filter-help"
                onChange={(event) => region.selectDong(event.target.value)}
                disabled={
                  !region.districtCode ||
                  region.dongs.status !== 'ready' ||
                  !region.dongs.data?.length
                }
                data-selected={!!region.dongCode}
              >
                <option value="">행정동 전체</option>
                {region.dongs.data?.map((item) => (
                  <option key={item.dongCode} value={item.dongCode}>
                    {item.dongName}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </span>
          </label>
        </div>
        <p
          id="region-filter-help"
          className={desktop ? 'sr-only' : 'region-filter-help'}
        >
          {region.districtCode
            ? '행정동 전체는 선택한 자치구를 의미합니다.'
            : '자치구를 선택하면 행정동을 조회합니다.'}
        </p>
        {needsNotice && (
          <div className="region-filter-notices">
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
          </div>
        )}
      </div>
    </div>
  );
}
