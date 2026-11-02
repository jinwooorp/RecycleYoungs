# 점수 입력과 독립 승인 manifest의 결합 검증

**구현 범위는 승인 주장의 형식과 입력의 결합 관계를 확인하는 내부 진단입니다.** 성공 결과는 `BINDING_VERIFIED`이며 공개 승인이 아닙니다. JSON에 `APPROVED`가 있고 외부 해시가 일치해도 `NOT_APPROVED`, `sourceTrust=NOT_ESTABLISHED`를 유지합니다. 승인 주체·신뢰 기준·배포 방식은 아직 결정하지 않았습니다.

기준은 [계산 계약 6.2절](score-v1-contract.md#62-승인-입력-스냅샷을-불변-배포-아티팩트로-보존), [승인 조건](score-v1-contract.md#8-승인과-구현-착수-조건), [R01·R02](score-snapshot-reproducibility.md), [묶음 파일 계약](score-snapshot-tools.md)입니다. 기존 A 계산식·스냅샷·Repository·Service·내보내기·오프라인 도구는 변경하지 않습니다.

## 1. 코드와 실행 경계

| 클래스                                                                                                                            | 책임                                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [ScoreApprovalManifest](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreApprovalManifest.java)                 | 불변 승인 주장, 구·동 전체 목록과 실제 배치 메타데이터 |
| [ScoreApprovalManifestCodec](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreApprovalManifestCodec.java)       | 엄격한 JSON 입출력과 별도 manifest SHA-256             |
| [ScoreApprovalManifestVerifier](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreApprovalManifestVerifier.java) | 실제 묶음 바이트·두 아티팩트·호출자 기대 근거 ID 대조  |

세 클래스는 기존 `scoreRegression` 소스셋에 둡니다. 파일·DB·HTTP·Spring Context 없이 메모리 바이트만 사용하며 제품 JAR에 포함하지 않습니다. 별도 실행 작업이나 자동 발급·저장은 추가하지 않았습니다. 기존 Service와 공개 경로에도 연결하지 않습니다.

## 2. 독립 manifest 스키마

`manifestSchemaVersion`은 `score-approval-manifest-v1`입니다. 현재 대상은 `20262`(2026년 2분기)·`CS100010`·`a-rank-v1-candidate.1`만 지원합니다. 이름에 v1이 포함돼도 정책 채택을 뜻하지 않습니다.

| 필드                                              | 내용                                                           |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `manifestSchemaVersion`                           | manifest 자체의 스키마 버전                                    |
| `quarterCode`, `industryCode`, `algorithmVersion` | 구·동에 공통인 입력 범위와 계산 버전                           |
| `policyVersion`, `policy`                         | 호출자가 지정하는 정책 버전 식별자와 정확한 정책 맵            |
| `district`, `dong`                                | 각각 아래 `CohortBinding`. 서로 바꾸거나 단위를 혼합할 수 없음 |
| `fileSha256`                                      | 보존 묶음 파일 전체 바이트의 소문자 SHA-256 64자리             |
| `policyApproval`                                  | 정책 승인 주장과 `policyApprovalId`에 해당하는 근거            |
| `sourceVerification`                              | 해당 원천 판본의 비교 가능성 근거 ID와 승인 주장               |
| `coverageApproval`                                | `coverageApprovalId`에 해당하는 커버리지 승인 주장             |

`CohortBinding`에는 `unit`, `inputSnapshotId`, `boundaryRegionCodes`, `eligibleRegionCodes`, `excludedRegions`, `batches`를 넣습니다. 전체 경계 코드는 비어 있을 수 없고, 완비·제외 목록은 중복·누락 없이 전체 경계를 분할해야 합니다. 제외 지역은 코드와 모든 지표별 사유를 보존합니다. 지역 수를 25·421로 고정하지 않습니다.

`batches`는 스냅샷이 참조한 경계와 통계 배치 전체입니다. UUID·데이터셋·원천 종류·범위·기간·체크섬·ETL 버전·상태·시작/종료/게시 시각을 기존 `BatchMetadata`대로 보존합니다. 이 스키마는 체크섬·ETL 버전 등 판본 식별 정보를 필수로 요구합니다. NULL을 허용하는 기간·범위 코드·종료/게시 시각도 JSON 키 자체는 있어야 합니다. 실제 입력의 행별 출처 연결은 기존 아티팩트 검증기로 확인합니다.

세 근거는 같은 `ApprovalEvidence` 구조를 사용합니다.

| 필드          | 규칙                                                        |
| ------------- | ----------------------------------------------------------- |
| `approvalId`  | 해당 역할의 근거 ID. 정책·원천·커버리지 기대 ID와 각각 대조 |
| `status`      | 작성자의 주장: `APPROVED`, `PENDING`, `REJECTED`            |
| `approvedAt`  | `APPROVED`일 때 필수. 나머지 상태에서는 NULL                |
| `reviewer`    | 공백·제어문자가 아닌 필수 담당자 식별 문자열                |
| `evidenceUrl` | 호스트가 있고 인증정보가 없는 절대 HTTP(S) URL              |

ID와 `policyVersion`은 영문·숫자로 시작하는 최대 128자의 영문·숫자·`.`·`_`·`:`·`-` 문자열입니다. URL은 방문하지 않으며 담당자의 자격·근거 문서의 존재나 진위를 확인하지 않습니다. `policyVersion`은 외부 기대값과 비교할 표식이며, 현재 입력에는 독립적인 정책 버전 필드가 없으므로 **정책 맵 전체를 입력과 추가로 대조**합니다. 버전 등록·정책 승인 체계가 구현된 것은 아닙니다.

## 3. 정규 JSON과 세 종류의 해시

기존 `ScoreSnapshotCodec.canonicalJson()`·SHA-256을 재사용합니다. 객체 키는 Unicode 코드 포인트 순서, UTF-8, BOM·불필요한 공백·끝 개행 없음입니다. UUID는 소문자, 시각은 UTC `Z`와 불필요한 소수 초 끝 0 제거 규칙을 따릅니다. 지역·배치는 코드·UUID순, 제외 사유는 기존 사유·지표 선언 순서로 정렬합니다. 컬렉션은 방어적으로 복사하고 불변으로 반환합니다.

- **구·동 `inputSnapshotId`:** 기존 입력 payload의 정규 바이트 해시입니다. 승인 담당자·시각·ID·URL은 payload에 넣지 않으므로 manifest 변경으로 이 해시는 달라지지 않습니다.
- **`fileSha256`:** 전달받은 실제 묶음 파일의 전체 바이트 해시입니다. 아티팩트를 별도 매개변수로 받아 파일과 무관하게 검증하는 대신, 바로 그 바이트를 기존 `ScoreSnapshotBundle.decode()`로 해석·재현합니다.
- **manifest SHA-256:** manifest 전체 정규 바이트의 별도 해시입니다. manifest 안에는 자기 해시나 신뢰 기준 필드를 두지 않습니다. 공백·키/목록 순서만 다른 동등한 JSON은 같은 정규 해시를 갖습니다.

중복 키·알 수 없는 필드·누락된 키·잘못된 타입·숫자 enum·숫자 epoch 시각·지원하지 않는 버전·잘못된 UTF-8·BOM·JSON 뒤 추가 값·손상된 문자열을 거부합니다. 시각은 ISO 문자열 또는 허용된 NULL만 받으며, nullable 키 누락과 명시적 NULL을 구분합니다. 오류에는 입력·담당자·URL·원본 예외를 포함하지 않습니다.

## 4. 결합 검증 순서와 실패 조건

`verify(manifestJson, bundleJson, expectedReferences, expectedManifestSha256)`은 다음 순서로 동작합니다. 파일을 읽거나 DB를 조회하지 않습니다.

1. manifest를 엄격하게 해석합니다. 호출자가 별도로 정한 `ExpectedReferences`는 필수입니다.
2. 묶음 파일을 기존 Codec으로 해석해 구·동의 입력 해시·전체 집단·행별 출처와 정확한 A 계산 결과를 재현합니다. 두 단위의 공통 경계·정책·분기·업종·조회 시각과 부모 구 연결도 기존 규칙으로 확인합니다.
3. 파일 전체 해시와 정책 버전·정책 승인 ID·원천 근거 ID·커버리지 승인 ID를 각각 대조합니다. 근거 상태가 `APPROVED`라는 주장까지 완비됐는지 검사하며, 미완성/거부 주장은 성공으로 처리하지 않습니다.
4. 각 단위의 입력 해시·정책 맵·전체 경계·완비·제외 코드와 사유·참조 배치 메타데이터를 정확히 대조합니다.
5. 외부 manifest 해시가 제공되면 형식과 정규 해시 일치를 검사합니다. 생략 시 `NOT_PROVIDED`, 일치 시 `MATCHED`로 기록합니다. 빈 값이나 불일치는 실패입니다.

재게시·원본값 또는 scale·출처 ID/체크섬/판본·경계·제외 목록/사유가 달라지면 과거 manifest와의 결합 검증은 실패합니다. 현재 입력을 과거 입력으로 자동 대체하지 않습니다. 한 항목만 맞는 부분 성공도 반환하지 않습니다.

## 5. 결합 성공과 실제 승인 사이의 경계

호출자는 기대 ID를 manifest에서 자동 추출하거나, manifest 자체의 해시를 읽어 독립 신뢰 기준인 것처럼 제공하면 안 됩니다. 이 라이브러리는 호출자가 기대값을 어떤 경로로 얻었는지 증명할 수 없습니다. **`MATCHED`는 전달받은 해시와의 일치일 뿐 신뢰할 수 있는 승인 주체를 검증한 상태가 아닙니다.**

공격자가 입력·manifest·기대 ID·기대 해시를 함께 바꾸면 내용 일관성만으로 위조를 식별할 수 없습니다. ID·URL의 형식 검사 역시 해당 근거가 이 입력과 정책을 승인했다는 증명이 아닙니다.

따라서 성공 반환값에도 공개 승인 상태는 항상 `NOT_APPROVED`, 원천 신뢰는 항상 `NOT_ESTABLISHED`입니다. 기존 Service의 상태도 바꾸지 않습니다. 실제 승인에는 신뢰할 승인 주체, 역할별 승인 권한, 독립 해시 또는 서명 검증, 안전한 배포·갱신·폐기·철회·감사 절차가 필요합니다. 이번 구현은 승인 발급·공개 게이트·운영 보관·백업 기능을 포함하지 않습니다.

## 6. 합성 검증과 남은 작업

[ScoreApprovalManifestTests](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreApprovalManifestTests.java)는 합성 전체 3구·3동 중 매출 행 없는 1동을 포함합니다. 실제 원본 스냅샷·실제 승인 ID를 사용하지 않고 manifest 파일도 발급·저장하지 않습니다.

새 테스트는 정상 결합, 역할별 근거 누락·불일치, 입력/파일 해시, 정책·출처·커버리지 변조, 잘못된 JSON 타입과 손상, 정확한 재현, 순서·시각 정규화와 불변성, 외부 기준 부재·위조 주장에도 공개 불가, 기존 Service의 `NOT_APPROVED` 유지를 확인합니다.

`backend/`에서 `./gradlew test`, `./gradlew integrationTest`, `./gradlew build`, `./gradlew spotlessCheck`로 검증합니다. 통합 테스트는 기존 일회용 PostGIS만 사용합니다. 실제 개발 DB·실제 보존 파일·내보내기·실데이터 회귀 도구는 이번에 실행하지 않습니다.

2026-11-02 최종 검증 결과: 신규 manifest **57개**, 전체 단위 **605개**, 일회용 DB 통합 **833개**가 통과했으며 실패·오류·건너뜀은 없습니다. 기존 R01·R02 스냅샷 44개와 고정 SHA-256 fixture를 유지했습니다. 빌드·Spotless, 제품 JAR의 도구 제외, 문서 Prettier·상대 링크·표와 신규 파일 공백 검사도 확인했습니다. 읽기 전용 독립 코드 리뷰에서 수정이 필요한 사항은 발견하지 못했습니다.

과거 12:17 전체 입력 fixture가 없으므로 R03 완전 재현은 여전히 미완료입니다. 정책·원천 판본의 의미적 비교 가능성·커버리지의 실제 승인, 실제 창업 성과 검증도 완료하지 않았습니다. 다음 단계는 승인 주체와 신뢰 기준·배포/보관 책임을 먼저 결정하고, 이 결합 진단과 별개인 진위 검증 절차를 설계하는 것입니다.
