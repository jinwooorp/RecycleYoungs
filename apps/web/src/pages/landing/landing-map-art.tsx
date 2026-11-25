function CafePin({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d="M14 32C11 28 2 22 2 14a12 12 0 1 1 24 0c0 8-9 14-12 18Z"
        fill="var(--primary)"
        stroke="var(--primary-foreground)"
        strokeWidth="2"
      />
      <path
        d="M8.5 10.5h9v4a4.5 4.5 0 0 1-9 0v-4Zm9 1H19a2 2 0 0 1 0 4h-1.6M9 21.5h10"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

// 가상의 도로와 녹지를 그립니다. 지도 타일이나 실제 좌표를 사용하지 않습니다.
export function LandingMapArt({ purpose }: { purpose: 'nearby' | 'search' }) {
  return (
    <svg
      className="landing-map-art"
      viewBox="0 0 600 400"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="var(--landing-map-land)" d="M0 0h600v400H0z" />
      <path
        fill="var(--landing-map-park)"
        d="m0 19 83 9 43 44-36 63-90-19zm369 18 75-37h156v94l-82 33-114-48zM11 295l100-29 52 39-15 95H0v-66zM415 302l61-41 124 39v100H436z"
      />
      <path
        fill="var(--landing-map-block)"
        d="m139 26 73-26h90l15 79-106 62-49-30zm246 99 91 35-12 42-72 38-38-29zm-193 91 98-39 39 66-53 35-89 1zm-12 92 110-14 71 36-23 70H170z"
      />
      <path
        fill="none"
        stroke="var(--landing-map-path)"
        strokeWidth="7"
        d="M14 45 58 75l34-5m346-33 84 49 65-21M36 360l58-49 42 24m367-38 62 19"
      />
      <path
        d="M-38 224C74 243 126 199 195 152S326 121 390 72 463 41 507-28"
        fill="none"
        stroke="var(--landing-map-water)"
        strokeWidth="46"
      />
      <g fill="none" stroke="var(--landing-map-road)" strokeLinejoin="round">
        <path
          strokeWidth="7"
          d="M40 0 151 153l-45 57-5 69 94 51-12 70M210 0l25 94 70 39 151-14 144 71M322 0l33 84 105 120 114 28M500 7 465 85l-92 93-77 24-101 108M0 92l109 10 41-51 57-24m4 201-63-26-31 7M17 400l46-84 64-18m148-25 52 57 58 33 14 37M600 306l-113-47-85 14-6 95 70 32M0 347l70-22m468-46-22 121"
        />
        <path
          strokeWidth="15"
          d="M-15 136 76 153l85 33c38 14 84 10 120-11L494 63l121-21M113-15l59 111 78 42 37 100 43 21 109-10 180 52M-15 285l176-33 79 33 133 14 83 114"
        />
      </g>
      <path
        d="M-15 136 76 153l85 33c38 14 84 10 120-11L494 63l121-21M113-15l59 111 78 42 37 100 43 21 109-10 180 52M-15 285l176-33 79 33 133 14 83 114"
        fill="none"
        stroke="var(--landing-map-avenue)"
        strokeWidth="1.5"
      />
      {purpose === 'nearby' ? (
        <>
          <circle
            cx="228"
            cy="196"
            r="106"
            fill="var(--action)"
            fillOpacity="0.15"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeDasharray="6 7"
          />
          <CafePin x={149} y={119} />
          <CafePin x={104} y={231} />
          <CafePin x={252} y={217} />
          <CafePin x={311} y={147} />
          <g transform="translate(228 196)">
            <circle
              r="10"
              fill="var(--primary)"
              stroke="var(--primary-foreground)"
              strokeWidth="2"
            />
            <path
              d="M0-6v12M-6 0H6"
              stroke="var(--primary-foreground)"
              strokeWidth="1.5"
            />
          </g>
          <g transform="translate(279 119)">
            <circle
              r="19"
              fill="var(--action)"
              stroke="var(--primary-foreground)"
              strokeWidth="2"
            />
            <circle r="15" fill="none" stroke="var(--primary)" />
            <path
              d="M-6 0h.1m6 0h.1m6 0h.1"
              stroke="var(--primary)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
          <g transform="translate(151 277)">
            <path
              d="M20 41 13 32H10a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5h20a5 5 0 0 1 5 5v20a5 5 0 0 1-5 5h-3Z"
              fill="var(--candidate-selected)"
              stroke="var(--primary-foreground)"
              strokeWidth="2"
            />
            <rect
              x="9"
              y="6"
              width="22"
              height="22"
              rx="3"
              fill="none"
              stroke="var(--primary-foreground)"
            />
            <text
              x="20"
              y="23"
              fill="var(--primary-foreground)"
              textAnchor="middle"
              fontSize="16"
              fontWeight="700"
            >
              A
            </text>
          </g>
        </>
      ) : (
        <g transform="translate(285 155) scale(1.4)">
          <path
            d="M16 39C12 33 2 25 2 16a14 14 0 0 1 28 0c0 9-10 17-14 23Z"
            fill="var(--landing-map-search)"
            stroke="var(--primary-foreground)"
            strokeWidth="2"
          />
          <circle
            cx="14"
            cy="14"
            r="6"
            fill="none"
            stroke="var(--primary-foreground)"
            strokeWidth="2"
          />
          <path
            d="m18.5 18.5 6 6"
            stroke="var(--primary-foreground)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  );
}
