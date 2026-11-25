import { useRef } from 'react';
import { useLandingMotion } from './use-landing-motion';
import {
  ArrowRight,
  ChartNoAxesCombined,
  Compass,
  GitCompareArrows,
  Search,
} from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/shared/ui/button';
import { BrandLogo, brandName } from '@/shared/ui/brand-logo';
import nearbyCafes from '@/pages/landing/assets/nearby-cafes.webp';
import nearbyCafesMobile from '@/pages/landing/assets/nearby-cafes-mobile.webp';
import placeSearch from '@/pages/landing/assets/place-search.webp';
import districtAnalysis from '@/pages/landing/assets/district-analysis.webp';
import candidateComparison from '@/pages/landing/assets/candidate-comparison.webp';
import { LandingMapArt } from './landing-map-art';
import './landing-page.css';

const sections = [
  { id: 'features', label: '지도 탐색' },
  { id: 'analysis', label: '상권 분석' },
  { id: 'comparison', label: '후보지 비교' },
  { id: 'how-it-works', label: '이용 방법' },
];

const steps = [
  ['장소 찾기', '관심 있는 동네, 주소 또는 역 이름을 검색하세요.'],
  ['주변 카페 확인', '선택한 지점에서 500m나 1km 이내의 카페를 확인하세요.'],
  ['상권 지표 확인', '기준 분기를 고르고 점포·추정매출·유동인구를 살펴보세요.'],
  [
    '후보지 저장 및 비교',
    '후보지를 저장하고 같은 반경의 카페 수와 행정동 통계를 비교하세요.',
  ],
];

// 조회를 완료한 프리뷰의 숫자를 이미지 밖에서도 읽을 수 있게 제공합니다.
const districtPreviewMetrics = [
  { label: '점포 수', value: '2,306', unit: '개', published: '11월 17일' },
  {
    label: '당월 추정매출액',
    value: '63,712,527,241',
    unit: '원',
    published: '11월 13일',
  },
  {
    label: '지역 전체 유동인구',
    value: '111,570,753',
    unit: '명',
    published: '11월 13일',
  },
];

const candidateMetricLabels = [
  '카페 점포',
  '당월 추정매출',
  '지역 전체 유동인구',
];
const candidatePreviewResults = [
  {
    name: 'A · 홍대입구역',
    result: '마포구 서교동 · 278곳',
    metrics: ['702개', '29,055,188,146원', '17,256,069명'],
  },
  {
    name: 'B · 합정역',
    result: '마포구 서교동 · 171곳',
    metrics: ['702개', '29,055,188,146원', '17,256,069명'],
  },
  {
    name: 'C · 상수역',
    result: '마포구 서강동 · 148곳',
    metrics: ['118개', '3,294,383,412원', '6,024,315명'],
  },
];

function Brand() {
  return (
    <Link to="/" className="landing-brand">
      <BrandLogo />
    </Link>
  );
}

function ExploreLink({ className = '' }: { className?: string }) {
  return (
    <Button asChild size="landing" className={`w-fit ${className}`}>
      <Link to="/explore" className="landing-cta">
        시작하기
        <ArrowRight aria-hidden="true" data-icon="inline-end" />
      </Link>
    </Button>
  );
}

function PreviewBar({ label }: { label: string }) {
  return (
    <div className="landing-preview-bar" aria-hidden="true">
      {label}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <p className="landing-section-label">{children}</p>;
}

function NearbyPreview() {
  return (
    <figure className="landing-hero-stage">
      <div className="landing-preview landing-preview-hero">
        <div className="landing-hero-map">
          <LandingMapArt purpose="nearby" />
          <div className="landing-map-query">
            <Search size={16} aria-hidden="true" /> 홍대입구역
          </div>
          <span className="landing-map-key">지도 개념도</span>
        </div>
        <div className="landing-preview-sheet">
          <div className="landing-sheet-heading">
            <strong>주변 탐색</strong>
            <span>500m 반경</span>
          </div>
          <p>
            홍대입구역 주변 카페 <strong>289곳</strong>
          </p>
          <picture>
            <source
              media="(width < 600px)"
              srcSet={nearbyCafesMobile}
              width={340}
              height={78}
            />
            <img
              src={nearbyCafes}
              width={340}
              height={160}
              fetchPriority="high"
              alt="홍대입구역 500m 반경의 경쟁 카페 거리순 목록 일부"
            />
          </picture>
        </div>
        <div className="landing-preview-dock" aria-hidden="true">
          <span>
            <Compass />
            주변 탐색
          </span>
          <span>
            <ChartNoAxesCombined />
            상권 분석
          </span>
          <span>
            <GitCompareArrows />
            후보지 분석
          </span>
        </div>
      </div>
      <figcaption>
        지도 개념도와 실제 카페 조회 예시 · 홍대입구역 2호선 검색 결과 중심 ·
        원천 기준 2026년 9월
      </figcaption>
    </figure>
  );
}

function ProductPreview({
  kind,
  decorative = false,
}: {
  kind: number;
  decorative?: boolean;
}) {
  if (kind === 0)
    return (
      <figure
        data-landing-reveal={decorative ? undefined : ''}
        className="landing-map-stage"
      >
        <div className="landing-preview">
          <div className="landing-search-map">
            <LandingMapArt purpose="search" />
            <img
              src={placeSearch}
              width={352}
              height={40}
              loading="lazy"
              decoding="async"
              alt={decorative ? '' : '홍대입구역을 입력한 실제 장소 검색창'}
            />
            <span className="landing-map-key">지도 개념도</span>
          </div>
          <div className="landing-search-actions">
            <p>
              <strong>홍대입구역</strong> <span>선택한 장소 예시</span>
            </p>
            <ul>
              <li>이 위치 상권 분석</li>
              <li>이 위치 주변 카페 보기</li>
              <li>후보지로 추가</li>
            </ul>
          </div>
        </div>
      </figure>
    );
  if (kind === 1)
    return (
      <figure
        data-landing-reveal={decorative ? undefined : ''}
        className="landing-analysis-stage"
      >
        <div className="landing-preview">
          <PreviewBar label="마포구 전체 · 2026년 2분기" />
          <div className="landing-analysis-preview">
            <dl className="landing-preview-metrics">
              {districtPreviewMetrics.map(
                ({ label, value, unit, published }) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      <strong>{value}</strong> {unit}
                    </dd>
                    <dd className="landing-preview-date">
                      DB 게시 2026년 {published}
                    </dd>
                  </div>
                ),
              )}
            </dl>
            <img
              src={districtAnalysis}
              width={332}
              height={240}
              loading="lazy"
              decoding="async"
              alt={
                decorative
                  ? ''
                  : '마포구의 2026년 2분기 일반 점포 1,937개와 프랜차이즈 점포 369개를 같은 축에 표시한 막대그래프'
              }
            />
          </div>
        </div>
        <figcaption>마포구 · 2026년 2분기 · 서울시 상권분석서비스</figcaption>
      </figure>
    );
  return (
    <figure
      data-landing-reveal={decorative ? undefined : ''}
      className="landing-candidate-preview"
    >
      {!decorative && (
        <div className="landing-candidate-overview">
          <p>
            후보지별 저장 위치 중심 500m · 카페 원천 2026년 9월 / 행정동 통계 ·
            2026년 2분기
          </p>
          <ul
            aria-label="후보지 500m 조회 결과"
            className="landing-candidate-summary"
          >
            {candidatePreviewResults.map(({ name, result, metrics }) => (
              <li key={name}>
                <strong>{name}</strong> <span>{result}</span>
                <dl className="landing-candidate-metrics">
                  {candidateMetricLabels.map((label, index) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{metrics[index]}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <p className="landing-scroll-note">
            아래 비교표는 좌우로 움직여 자세히 볼 수 있어요.
          </p>
        </div>
      )}
      <div className="landing-preview">
        <PreviewBar label="후보지 비교" />
        <div
          tabIndex={decorative ? undefined : 0}
          role={decorative ? undefined : 'region'}
          aria-label={decorative ? undefined : '후보지 요약 프리뷰'}
          className="landing-comparison-scroll"
        >
          <img
            src={candidateComparison}
            width={892}
            height={849}
            loading="lazy"
            decoding="async"
            alt={
              decorative
                ? ''
                : '홍대입구역, 합정역, 상수역의 경쟁 카페와 행정동 통계를 나란히 표시한 비교표. 홍대입구역이 선택되어 있습니다.'
            }
          />
        </div>
      </div>
    </figure>
  );
}

export default function LandingPage() {
  const pageRef = useRef<HTMLDivElement>(null);

  useLandingMotion(pageRef);

  return (
    <div ref={pageRef} data-public-page className="landing-page">
      <a
        href="#landing-main"
        className="sr-only z-50 rounded-lg bg-background p-3 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        본문으로 건너뛰기
      </a>
      <header className="landing-header">
        <div className="landing-shell landing-header-inner">
          <Brand />
          <nav aria-label="랜딩 페이지 메뉴" className="landing-nav">
            {sections.map(({ id, label }) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
          <ExploreLink className="justify-self-end" />
        </div>
      </header>
      <main id="landing-main" tabIndex={-1} className="focus:outline-none">
        <section aria-labelledby="landing-heading" className="landing-hero">
          <div className="landing-shell landing-hero-inner">
            <div className="landing-hero-copy">
              <p className="landing-eyebrow">공공데이터 기반 창업 입지 탐색</p>
              <h1 id="landing-heading">
                <span>창업할 곳,</span> <span>감으로만 고르지 마세요.</span>
              </h1>
              <p className="landing-hero-description">
                서울의 주변 카페와 상권 지표를 살펴보고 창업 후보지를
                비교하세요. 현재는 카페 업종을 지원합니다.
              </p>
              <ExploreLink />
            </div>

            <NearbyPreview />
          </div>
        </section>

        <section aria-label="서비스 범위" className="landing-facts">
          <dl className="landing-shell landing-fact-grid">
            <div data-landing-reveal>
              <dt>데이터 범위</dt>
              <dd>
                <strong>서울 공공데이터</strong>
                <span>카페 위치와 행정구역 단위 상권 통계</span>
              </dd>
            </div>
            <div data-landing-reveal>
              <dt>주변 탐색</dt>
              <dd>
                <strong>500m · 1km</strong>
                <span>선택 지점에서 지정 반경 내 카페 조회</span>
              </dd>
            </div>
            <div data-landing-reveal>
              <dt>후보지 비교</dt>
              <dd>
                <strong>최대 3곳</strong>
                <span>같은 조건에서 후보지별 지표 비교</span>
              </dd>
            </div>
          </dl>
        </section>

        <div className="landing-feature-zone">
          <div className="landing-shell landing-story" data-landing-story>
            <div className="landing-story-steps">
              <section
                data-story-step
                id="features"
                aria-labelledby="features-heading"
                className="landing-feature"
              >
                <div data-landing-reveal className="landing-feature-copy">
                  <SectionLabel>지도·장소 탐색</SectionLabel>
                  <h2 id="features-heading">
                    관심 있는 동네를 <br />
                    지도에서 찾으세요
                  </h2>
                  <p>
                    자치구·행정동을 선택하거나 장소·주소·지하철역을 검색해 관심
                    위치로 이동하세요. 현재 지도 영역의 카페를 둘러보거나, 선택
                    지점에서 500m·1km 반경으로 조회할 수 있습니다.
                  </p>
                </div>
                <ProductPreview kind={0} />
              </section>

              <section
                data-story-step
                id="analysis"
                aria-labelledby="analysis-heading"
                className="landing-analysis"
              >
                <div className="landing-analysis-inner">
                  <div
                    data-landing-reveal
                    className="landing-feature-copy landing-analysis-copy"
                  >
                    <SectionLabel>상권 분석</SectionLabel>
                    <h2 id="analysis-heading">
                      숫자가 가리키는 <br />
                      범위부터 살펴보세요
                    </h2>
                    <p>
                      기준 분기를 선택하고 공공데이터의 출처와 게시 시점을
                      확인하세요. 지표마다 집계하는 범위가 다릅니다.
                    </p>
                    <dl className="landing-scope-list">
                      <div>
                        <dt>선택 지점 반경</dt>
                        <dd>500m 또는 1km 이내의 경쟁 카페를 집계합니다.</dd>
                      </div>
                      <div>
                        <dt>행정구역 전체</dt>
                        <dd>
                          자치구·행정동의 카페 점포 수와 개업률·폐업률, 당월
                          추정매출, 업종 구분 없는 지역 전체 유동인구를
                          표시합니다.
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <ProductPreview kind={1} />
                </div>
              </section>

              <section
                data-story-step
                id="comparison"
                aria-labelledby="comparison-heading"
                className="landing-comparison"
              >
                <div>
                  <div
                    data-landing-reveal
                    className="landing-comparison-heading"
                  >
                    <div>
                      <SectionLabel>후보지 비교</SectionLabel>
                      <h2 id="comparison-heading">
                        후보지를 같은 기준으로 비교하세요
                      </h2>
                    </div>
                    <p>
                      후보지를 이 브라우저에 최대 세 곳까지 저장하고 이름과
                      메모를 관리하세요. 지도에서 위치를 확인하며 경쟁 카페 수와
                      행정동 통계를 비교할 수 있습니다. 같은 행정동에 속한
                      후보지는 행정동 통계를 공유합니다.
                    </p>
                  </div>
                  <ProductPreview kind={2} />
                </div>
              </section>
            </div>
            <div className="landing-story-stage" aria-hidden="true">
              {[0, 1, 2].map((kind) => (
                <div
                  key={kind}
                  className="landing-story-layer"
                  data-story-preview
                >
                  <ProductPreview kind={kind} decorative />
                </div>
              ))}
            </div>
          </div>

          <section
            id="how-it-works"
            aria-labelledby="steps-heading"
            className="landing-shell landing-workflow"
          >
            <div data-landing-reveal>
              <SectionLabel>이용 방법</SectionLabel>
              <h2 id="steps-heading">검색에서 비교까지</h2>
            </div>
            <ol>
              {steps.map(([title, description], index) => (
                <li key={title} data-landing-reveal>
                  <span className="landing-step-number" aria-hidden="true">
                    0{index + 1}
                  </span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section
          aria-labelledby="final-heading"
          className="landing-shell landing-final"
        >
          <div className="landing-final-inner">
            <div>
              <p>{brandName}</p>
              <h2 id="final-heading">첫 후보지를 찾아보세요</h2>
              <p className="landing-final-description">
                서울에서 관심 있는 동네나 역을 검색해 주변 카페부터 살펴보세요.
              </p>
            </div>
            <ExploreLink />
          </div>
        </section>
      </main>
      <footer className="landing-shell landing-footer">
        <Brand />
        <div>
          <p>
            <strong>데이터 출처</strong> 서울시 상권분석서비스 ·
            소상공인시장진흥공단 상가(상권)정보
          </p>
          <p>
            프리뷰의 지도는 가상으로 그린 개념도이며, 목록과 통계는 실제 조회
            예시입니다. 분석 결과는 창업 검토를 위한 참고 자료입니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
