import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectChevron } from '@/components/ui/native-select';
import type {
  RegionExplorer,
  RegionResource,
} from '@/hooks/use-region-explorer';

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

function RegionChoice({
  label,
  value,
  checked,
  onClick,
}: {
  label: string;
  value: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      value={value}
      aria-pressed={checked}
      onClick={onClick}
    >
      <span>{label}</span>
      {checked && <Check aria-hidden="true" />}
    </Button>
  );
}

type Step = 'district' | 'dong';

export function RegionFilter({
  region,
  onOpen,
  onSelection,
}: {
  region: RegionExplorer;
  onOpen: () => void;
  onSelection?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('district');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  const focusChoices = useRef(false);
  const districts = region.districts.data ?? [];
  const applied = districts.filter(({ districtCode }) =>
    region.districtCodes.includes(districtCode),
  );
  const dongs = region.dongs.data ?? [];
  const dongName = dongs.find(
    ({ dongCode }) => dongCode === region.dongCode,
  )?.dongName;
  const districtName = applied[0]?.districtName;
  const summary =
    applied.length > 1
      ? `${districtName} 외 ${applied.length - 1}개 구`
      : [districtName, dongName].filter(Boolean).join(' · ');
  const errors = region.boundaries.filter((entry) => entry.error);
  const canChooseDong = applied.length === 1;
  const isDong = step === 'dong' && canChooseDong;

  useLayoutEffect(() => {
    if (!open || !focusChoices.current) return;
    focusChoices.current = false;
    const current = choices.current?.querySelector<HTMLButtonElement>(
      'button[aria-pressed="true"]',
    );
    (current ?? choices.current?.querySelector('button'))?.focus();
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (
        !(event.target instanceof Node) ||
        root.current?.contains(event.target)
      )
        return;
      // 바깥 버튼이 포커스를 받으면 기본 동작을 유지합니다.
      if (controls.current?.contains(document.activeElement))
        trigger.current?.focus({ preventScroll: true });
      setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function goTo(next: Step) {
    if (next === step) {
      choices.current?.querySelector<HTMLButtonElement>('button')?.focus();
      return;
    }
    focusChoices.current = true;
    setStep(next);
  }

  function selectDistricts(codes: readonly string[]) {
    if (region.applyDistricts(codes)) onSelection?.();
  }
  function selectDong(code: string) {
    if (region.selectDong(code)) onSelection?.();
  }

  return (
    <div
      ref={root}
      className="region-filter"
      data-open={open}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next && !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <Button
        ref={trigger}
        variant="outline"
        aria-label="지역 필터"
        aria-describedby="applied-districts"
        aria-expanded={open}
        aria-controls="region-filter-controls"
        onClick={(event) => {
          if (open) close();
          else {
            onOpen();
            setStep('district');
            focusChoices.current = event.detail === 0;
            setOpen(true);
          }
        }}
      >
        <SlidersHorizontal aria-hidden="true" data-icon="inline-start" />
        <span className="region-filter-summary">{summary || '서울 전체'}</span>
        {(errors.length > 0 || region.districts.status === 'error') && (
          <span aria-hidden="true">!</span>
        )}
        <SelectChevron className="mr-px" />
      </Button>
      <p id="applied-districts" className="sr-only">
        {applied.length
          ? `적용한 자치구 ${applied.length}개: ${applied.map(({ districtName }) => districtName).join(', ')}`
          : '서울특별시 전체 · 선택한 자치구 0개'}
        {dongName && ` · ${dongName}`}
        {errors.length > 0 && ` · 경계를 불러오지 못한 지역 ${errors.length}곳`}
      </p>
      <div
        ref={controls}
        id="region-filter-controls"
        role="group"
        aria-labelledby="region-filter-title"
        className="region-filter-controls"
        hidden={!open}
        tabIndex={-1}
      >
        <header className="region-filter-heading">
          <h2 id="region-filter-title">지역 필터</h2>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="지역 필터 초기화"
              onClick={() => {
                selectDistricts([]);
                if (isDong) goTo('district');
              }}
            >
              <RotateCcw aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="지역 필터 닫기"
              onClick={close}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        </header>
        <p
          className="region-filter-current"
          role="status"
          aria-label="현재 지역"
        >
          서울특별시{summary ? ` · ${summary}` : ' 전체'}
          <span className="sr-only"> · 선택한 자치구 {applied.length}개</span>
        </p>
        <div
          className="region-filter-steps"
          role="group"
          aria-label="지역 선택 단계"
        >
          <span className="region-filter-city">
            서울특별시 <span className="sr-only">고정</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            aria-current={!isDong ? 'step' : undefined}
            aria-controls="region-filter-choices"
            onClick={() => goTo('district')}
          >
            자치구
          </Button>
          {applied.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              aria-current={isDong ? 'step' : undefined}
              aria-controls="region-filter-choices"
              aria-describedby={
                !canChooseDong ? 'region-filter-dong-help' : undefined
              }
              disabled={!canChooseDong}
              onClick={() => goTo('dong')}
            >
              행정동
            </Button>
          )}
        </div>
        {isDong && (
          <div className="region-filter-back">
            <Button
              type="button"
              variant="ghost"
              aria-label="이전 단계: 자치구"
              onClick={() => goTo('district')}
            >
              <ArrowLeft aria-hidden="true" />
              {districtName}
            </Button>
          </div>
        )}
        {applied.length > 1 && (
          <p
            id="region-filter-dong-help"
            className="text-xs text-muted-foreground"
          >
            여러 자치구를 선택한 경우 행정동을 선택할 수 없습니다.
          </p>
        )}
        <div
          ref={choices}
          key={isDong ? region.districtCode : 'districts'}
          id="region-filter-choices"
          className="region-filter-choices"
          role="group"
          aria-label={isDong ? '행정동 목록' : '자치구 목록'}
        >
          {isDong ? (
            <>
              <RegionChoice
                label="행정동 전체"
                value=""
                checked={!region.dongCode}
                onClick={() => selectDong('')}
              />
              {dongs.map(({ dongCode, dongName }) => (
                <RegionChoice
                  key={dongCode}
                  label={dongName}
                  value={dongCode}
                  checked={region.dongCode === dongCode}
                  onClick={() => selectDong(dongCode)}
                />
              ))}
            </>
          ) : (
            <>
              <RegionChoice
                label="서울 전체"
                value=""
                checked={!applied.length}
                onClick={() => selectDistricts([])}
              />
              {districts.map(({ districtCode, districtName }) => {
                const checked = region.districtCodes.includes(districtCode);
                return (
                  <RegionChoice
                    key={districtCode}
                    label={districtName}
                    value={districtCode}
                    checked={checked}
                    onClick={() =>
                      selectDistricts(
                        checked
                          ? region.districtCodes.filter(
                              (code) => code !== districtCode,
                            )
                          : [...region.districtCodes, districtCode],
                      )
                    }
                  />
                );
              })}
            </>
          )}
        </div>
        {isDong ? (
          <ResourceNotice
            resource={region.dongs}
            label="행정동 목록"
            empty={!dongs.length}
          />
        ) : (
          <ResourceNotice
            resource={region.districts}
            label="자치구 목록"
            empty={!districts.length}
          />
        )}
        {region.boundaries.some((entry) => entry.loading) && (
          <p role="status">지역 경계 불러오는 중…</p>
        )}
        {errors.map((entry) => {
          const code = entry.key.split(':')[1];
          const name =
            districts.find((item) => item.districtCode === code)
              ?.districtName ??
            dongName ??
            code;
          return (
            <div key={entry.key} role="alert" className="region-filter-error">
              <p>
                {name} 경계: {entry.error}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  controls.current?.focus();
                  entry.retry();
                }}
                aria-label={`${name} 경계 다시 시도`}
              >
                다시 시도
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
