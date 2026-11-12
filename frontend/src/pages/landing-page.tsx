import { useRef } from 'react';
import { useLandingMotion } from '@/hooks/use-landing-motion';
import { ArrowRight, MapPin } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import nearbyCafes from '@/assets/landing/nearby-cafes.webp';
import nearbyCafesMobile from '@/assets/landing/nearby-cafes-mobile.webp';
import placeSearch from '@/assets/landing/place-search.webp';
import districtAnalysis from '@/assets/landing/district-analysis.webp';
import candidateComparison from '@/assets/landing/candidate-comparison.webp';
import './landing-page.css';

const brand = '여기 창업해도 돼?';

const sections = [
  { id: 'features', label: '지도 탐색' },
  { id: 'analysis', label: '상권 분석' },
  { id: 'comparison', label: '후보지 비교' },
  { id: 'how-it-works', label: '이용 방법' },
];

const steps = [
  ['장소 검색', '관심 있는 동네나 역 이름을 검색하세요.'],
  ['상권 분석', '주변 카페와 행정구역별 상권 통계를 살펴보세요.'],
  ['후보지 등록', '지도나 검색 결과에서 다시 보고 싶은 위치를 추가하세요.'],
  ['후보지 비교', '같은 반경의 카페 수와 행정동 통계를 나란히 보세요.'],
];

// 프리뷰 이미지에 표시된 500m 조회 결과를 읽을 수 있는 텍스트로도 제공합니다.
const candidatePreviewResults = [
  ['A · 홍대입구역 2호선', '마포구 서교동 · 289곳'],
  ['B · 서울특별시청', '중구 명동 · 187곳'],
  ['C · 성수역 2호선', '성동구 성수2가3동 · 117곳'],
];

function Brand() {
  return (
    <Link to="/" className="landing-brand">
      <MapPin aria-hidden="true" size={24} />
      {brand}
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
      <span className="landing-preview-dots">
        <i />
        <i />
        <i />
      </span>
      <span>
        {brand} / {label}
      </span>
      <span>실제 화면</span>
    </div>
  );
}

function SectionLabel({
  number,
  children,
}: {
  number: string;
  children: string;
}) {
  return (
    <p className="landing-section-label">
      <span aria-hidden="true">{number}</span>
      {children}
    </p>
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
          <PreviewBar label="장소 검색" />
          <img
            src={placeSearch}
            width={1200}
            height={750}
            loading="lazy"
            decoding="async"
            alt={
              decorative
                ? ''
                : '성수역 검색 결과 목록과 성동구 경계를 표시한 실제 지도 탐색 화면'
            }
          />
        </div>
        <figcaption>
          성수역 장소 검색 예시 <span>지도 © Kakao</span>
        </figcaption>
      </figure>
    );
  if (kind === 1)
    return (
      <figure
        data-landing-reveal={decorative ? undefined : ''}
        className="landing-analysis-stage"
      >
        <div className="landing-preview">
          <PreviewBar label="상권 분석" />
          <img
            src={districtAnalysis}
            width={360}
            height={655}
            loading="lazy"
            decoding="async"
            alt={
              decorative
                ? ''
                : '용답동의 2026년 2분기 카페 점포 수와 당월 추정매출, 전분기 점포 수 비교를 보류한 사유가 표시된 상권 분석 화면'
            }
          />
        </div>
        <figcaption>성동구 용답동 · 2026년 2분기 상권 분석</figcaption>
      </figure>
    );
  return (
    <figure
      data-landing-reveal={decorative ? undefined : ''}
      className="landing-candidate-preview"
    >
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
            width={1440}
            height={900}
            loading="lazy"
            decoding="async"
            alt={
              decorative
                ? ''
                : '서울 지도에 표시된 후보지 A·B·C와 왼쪽 후보지 요약 패널'
            }
          />
        </div>
      </div>
      <figcaption>
        <span>500m 내 경쟁 카페 조회 예시</span>
        <span>지도 © Kakao</span>
        <ul
          aria-label="후보지 500m 조회 결과"
          className="landing-candidate-summary"
        >
          {candidatePreviewResults.map(([place, result]) => (
            <li key={place}>
              <strong>{place}</strong> <span>{result}</span>
            </li>
          ))}
        </ul>
        <span className="landing-scroll-note">
          화면을 좌우로 움직여 확인할 수 있어요.
        </span>
      </figcaption>
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
              <p className="landing-eyebrow">
                서울의 창업 후보지를 데이터로 탐색
              </p>
              <h1 id="landing-heading">
                <span>창업할 곳,</span> <span>감으로만 고르지 마세요.</span>
              </h1>
              <p className="landing-hero-description">
                서울의 상권 데이터를 확인하고 관심 있는 후보지를 비교해 보세요.
                현재는 카페 업종을 지원합니다.
              </p>
              <ExploreLink />
            </div>

            <figure className="landing-hero-stage">
              <div className="landing-preview landing-preview-hero">
                <PreviewBar label="주변 카페" />
                <picture>
                  <source
                    media="(width < 600px)"
                    srcSet={nearbyCafesMobile}
                    width={390}
                    height={680}
                  />
                  <img
                    src={nearbyCafes}
                    width={1200}
                    height={750}
                    fetchPriority="high"
                    alt="홍대입구역 500m 주변 카페를 지도에 묶어 표시하고 조회 건수와 거리순 목록을 보여주는 탐색 화면"
                  />
                </picture>
              </div>
              <figcaption>
                홍대입구역 500m 주변 카페 조회 예시 <span>지도 © Kakao</span>
              </figcaption>
            </figure>
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
                  <SectionLabel number="01">지도·장소 탐색</SectionLabel>
                  <h2 id="features-heading">
                    관심 있는 동네를 <br />
                    지도에서 찾으세요
                  </h2>
                  <p>
                    자치구·행정동을 선택하거나 장소·주소·지하철역을 검색해 관심
                    위치로 이동하세요. 선택한 지점 주변의 카페도 확인할 수
                    있어요.
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
                    <SectionLabel number="02">상권 분석</SectionLabel>
                    <h2 id="analysis-heading">
                      숫자가 가리키는 <br />
                      범위부터 살펴보세요
                    </h2>
                    <p>
                      화면에 표시된 기준 분기와 자료 게시 시점을 확인하고,
                      지표마다 어떤 범위를 집계했는지 살펴보세요.
                    </p>
                    <dl className="landing-scope-list">
                      <div>
                        <dt>선택 지점 반경</dt>
                        <dd>500m 또는 1km 이내의 경쟁 카페를 집계합니다.</dd>
                      </div>
                      <div>
                        <dt>행정구역 전체</dt>
                        <dd>
                          자치구·행정동의 카페 업종 점포 현황과 당월 추정매출,
                          업종 구분 없는 지역 전체 유동인구를 표시합니다.
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
                      <SectionLabel number="03">후보지 비교</SectionLabel>
                      <h2 id="comparison-heading">
                        후보지를 같은 기준으로 비교하세요
                      </h2>
                    </div>
                    <p>
                      후보지를 최대 세 곳(A·B·C)까지 등록해 같은 반경의 카페
                      수와 각 후보지가 속한 행정동의 상권 통계를 비교하세요.
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
              <SectionLabel number="04">이용 방법</SectionLabel>
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
              <p>{brand}</p>
              <h2 id="final-heading">첫 후보지를 찾아보세요</h2>
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
            프리뷰는 실제 조회 화면을 캡처한 예시입니다. 분석 결과는 창업 검토를
            위한 참고 자료입니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
