# 점수 독립 신뢰 기록과 입력 결합 검증

**현재 구현은 메모리에서 별도로 전달받은 기대값·철회 이력·manifest·전체 입력의 일관성을 확인하는 내부 진단입니다.** 성공은 `TRUST_BINDING_VERIFIED`이며, 실제 승인이나 배포 경로의 진위 확인이 아닙니다. `NOT_APPROVED`, `sourceTrust=NOT_ESTABLISHED`를 유지합니다.

[승인 거버넌스](score-approval-governance.md)의 SHA-256 고정값 방식은 여전히 **미채택 운영 권장안**입니다. 이번 구현은 그 방식에 필요한 순수 검증 기능만 제공합니다. 보호된 경로, 승인 책임자, 실제 승인·철회 기록은 만들지 않았습니다.

## 1. 구현 경계

| 클래스                                                                                                                  | 책임                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [ScoreTrustRecord](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreTrustRecord.java)                 | manifest와 분리된 불변 기대값, 활성 상태와 철회 목록 |
| [ScoreTrustRecordCodec](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreTrustRecordCodec.java)       | 엄격한 JSON 해석, 정규 바이트와 별도 SHA-256         |
| [ScoreTrustRecordVerifier](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreTrustRecordVerifier.java) | 활성·철회·이력 검사 후 기존 manifest 검증기 연결     |

세 클래스는 기존 `scoreRegression` 소스셋에 있습니다. DB·파일·HTTP·Spring Context를 사용하지 않으며 제품 JAR에 포함하지 않습니다. 새 Gradle 작업, 운영 로더, 공개 REST API도 없습니다. 기존 계산기·Repository·Service·스냅샷 도구의 동작은 유지합니다.

## 2. 신뢰 기록 스키마

대상은 `20262`(2026년 2분기)·카페 `CS100010`·A `a-rank-v1-candidate.1`입니다. 아래 필드는 nullable 필드도 JSON 키 자체가 반드시 있어야 합니다.

| 필드                                                               | 규칙                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `trustRecordSchemaVersion`                                         | `score-trust-record-v1`만 지원                                               |
| `revision`                                                         | 1부터 `9223372036854775807`까지의 JSON 정수. 문자열·소수·NULL·범위 초과 거부 |
| `activeReleaseId`                                                  | 대상 릴리스 식별자. `INACTIVE`에서만 명시적 NULL 허용                        |
| `releaseStatus`                                                    | `ACTIVE`, `INACTIVE`, `REVOKED`. 검증 성공 후보는 `ACTIVE`뿐                 |
| `quarterCode`, `industryCode`, `algorithmVersion`, `policyVersion` | 입력 범위와 계산·정책 판본. manifest와 대조                                  |
| `manifestSha256`                                                   | 승인 대상으로 지목한 manifest의 **정규 바이트** SHA-256. 소문자 64자리       |
| `policyApprovalId`, `sourceVerificationId`, `coverageApprovalId`   | 역할별 기대 근거 ID. manifest의 해당 역할 `approvalId`와 정확히 대조         |
| `revocations`                                                      | 철회 목록. 없으면 빈 배열이며 NULL·키 누락은 거부                            |

릴리스·정책 버전·근거 ID는 기존 manifest와 동일하게 영문·숫자로 시작하는 최대 128자의 영문·숫자·`.`·`_`·`:`·`-` 식별자입니다. 릴리스 ID는 입력 해시나 승인 ID를 대신하지 않습니다.

### 철회 항목

각 항목은 `{target, targetId, reason, revokedAt}`입니다. `target`은 `RELEASE`, `POLICY_APPROVAL`, `SOURCE_VERIFICATION`, `COVERAGE_APPROVAL` 중 하나입니다. 같은 문자열 ID라도 역할이 다르면 별도 대상입니다.

- `targetId`는 해당 대상의 식별자입니다. `reason`은 앞뒤 공백·제어문자가 없는 비어 있지 않은 문자열입니다.
- `revokedAt`은 필수 ISO-8601 오프셋 시각이며 UTC로 정규화합니다. 시각의 숫자 epoch 표현은 거부합니다.
- 같은 대상 종류·ID의 중복 철회는 거부합니다. 사유나 시각을 덮어쓰는 수정 기능은 없습니다.
- 릴리스 상태가 `REVOKED`이면 그 릴리스의 철회 항목이 필요합니다. `ACTIVE`이더라도 자기 릴리스나 세 기대 승인 ID가 철회 목록에 있으면 검증을 거부합니다.

`ACTIVE`는 이 기록의 활성 주장일 뿐 공개 승인 상태가 아닙니다. 정책·원천·커버리지의 `PENDING`·`REJECTED` 주장은 기존 manifest 검증기가 거부합니다. 이번 스키마는 manifest v1에 `REVOKED`를 추가하지 않습니다.

## 3. JSON과 해시

기존 [manifest 정규화 규칙](score-approval-manifest.md#3-정규-json과-세-종류의-해시)을 따릅니다. 객체 키는 Unicode 코드 포인트순, UTF-8, BOM·불필요한 공백·끝 개행 없음입니다. 철회 목록은 대상 종류의 선언 순서와 대상 ID 코드 포인트순으로 정렬합니다. 시각은 UTC `Z` 표기이며 불필요한 소수 초 끝 0을 제거합니다.

중복 키·알 수 없는 필드·필수 키 누락·잘못된 타입·숫자 enum·잘못된 UTF-8·짝 없는 surrogate·뒤따르는 JSON 값·지원하지 않는 스키마를 거부합니다. 컬렉션은 방어적으로 복사하고 불변으로 반환합니다. 오류에는 원문·기대값·철회 사유·원본 예외를 넣지 않습니다.

`ScoreTrustRecordCodec.sha256()`은 신뢰 기록 전체의 정규 바이트를 식별합니다. **이 해시 자체는 승인이나 신뢰 기준의 진위 증거가 아닙니다.** 이 기록과 manifest는 입력 payload 밖에 있으므로 어느 쪽을 바꾸더라도 기존 구·동 `inputSnapshotId`는 바뀌지 않습니다.

## 4. 검증 호출과 기본 차단

호출은 다음 네 인수를 받습니다. 파일 경로·DB 연결 정보는 받지 않습니다.

```java
verifier.verify(
    trustRecordJson,
    manifestJson,
    bundleJson,
    independentlyTrustedPreviousRecord); // 없으면 null
```

1. 신뢰 기록을 엄격하게 해석하고 `ACTIVE`인지 확인합니다.
2. 현재 릴리스와 세 기대 승인 ID가 철회됐는지 확인합니다.
3. 이전 신뢰 기록이 제공되면 아래 이력 검사를 수행합니다.
4. 신뢰 기록의 분기·업종·알고리즘을 manifest와 대조합니다.
5. **신뢰 기록의** 정책 버전·세 기대 ID·정규 manifest SHA-256을 기존 `ScoreApprovalManifestVerifier`에 전달합니다. manifest나 입력에서 기대값을 생성하는 경로는 없습니다.
6. 기존 검증기가 묶음 파일 해시, 구·동 입력 해시, 정책 맵, 전체 경계·완비·제외 목록과 사유, 실제 배치 메타데이터, 정확한 계산 결과를 검사합니다. 일부만 일치하는 성공이나 과거 입력 폴백은 없습니다.

누락·손상·범위/버전/ID/해시 불일치, 비활성·철회, 이력 위반, manifest/입력 결합 실패는 모두 `IllegalArgumentException`으로 실패합니다. 성공 결과에는 리비전·활성 릴리스 ID·정규 manifest 해시와 이력 검사 여부만 남기며, 공개 승인 상태는 항상 `NOT_APPROVED`입니다.

### 이력 검사: 외부 기준이 있을 때만 가능한 확인

`independentlyTrustedPreviousRecord`는 호출자가 **독립적으로 신뢰할 수 있는 이전 기록**이어야 합니다. 현재 manifest·입력·현재 신뢰 기록에서 복사한 값을 이전 기준처럼 전달하면 안 됩니다.

| 조건                                                                         | 결과                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 이전 기록 없음                                                               | 현재 결합만 진단. `revisionCheck=NOT_PROVIDED`. 과거 리비전 재사용 방지 보장 없음 |
| 현재 리비전 < 이전 리비전                                                    | 거부                                                                              |
| 같은 리비전·다른 내용                                                        | 거부. 같은 리비전은 정규화된 모델 내용이 정확히 같아야 함                         |
| 이전 철회 목록의 삭제·사유/시각 변경                                         | 거부. 이전 항목을 모두 그대로 포함해야 함                                         |
| 제공된 이전 기록과 같은 활성 릴리스 ID를 다른 manifest·정책·기대 ID로 재지정 | 새 리비전이라도 거부                                                              |
| 더 높은 리비전·새 릴리스·철회 이력 유지·모든 결합 일치                       | `revisionCheck=CHECKED`. 공개 승인은 여전히 불가                                  |

이전 철회 이력을 유지하므로 철회된 릴리스나 역할별 승인 ID를 다시 활성 대상으로 쓰면 거부됩니다. 이전 기록이 철회 정보를 갖고 있는데 현재 기록에서 이를 지워도 검사에 실패합니다. 반면 비철회 릴리스의 전체 ID→manifest 이력은 보존하지 않습니다. 중간에 다른 릴리스가 활성화된 뒤 과거의 비철회 ID를 다른 내용으로 재사용하는 상황까지 탐지하는 기능은 없습니다.

단, `CHECKED`는 **전달받은 이전 기록에 대한 검사**입니다. 이 코드에는 영구 단조 카운터·최신성 서버·신뢰 이력 저장소가 없습니다. 누락된 더 최신 기록, 양쪽에서 사라진 철회 이력, 보호된 설정 전체의 악의적 교체를 탐지했다고 주장하지 않습니다. 호출자는 알려진 철회 이력을 보존한 이전 기준의 출처·최신성·무결성을 별도로 확보해야 합니다.

## 5. 위조와 실제 승인 사이의 경계

manifest의 `APPROVED` 문자열만 전달하거나, manifest/입력 JSON을 신뢰 기록 대신 전달하면 거부합니다. 필수 기대값 누락 시 자동 채움도 없습니다.

반면 공격자가 신뢰 기록·manifest·입력을 모두 일관되게 위조하면 메모리 결합 검사만으로 그 출처를 판별할 수 없습니다. 올바른 형식의 기대 해시·ID는 담당자의 승인 증거가 아닙니다. 따라서 `TRUST_BINDING_VERIFIED`, `revisionCheck=CHECKED`도 승인 주체·배포 경로·근거 URL의 진위나 원천 판본 비교 가능성을 입증하지 않습니다.

운영 로더, 보호된 설정 배포, 책임자의 실제 승인, 신뢰 기준의 변경 권한, 철회 전파·응답 차단 게이트는 **미구현**입니다. 기존 Service도 계속 `NOT_APPROVED`이며 공개 점수 API와 연결하지 않았습니다. 거버넌스의 권장 운영안을 최종 채택한 것으로 해석하지 않습니다.

## 6. 합성 테스트와 남은 작업

[ScoreTrustRecordTests](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreTrustRecordTests.java)는 합성된 전체 3구·3동 스냅샷과 테스트 전용 기대값만 사용합니다. 실제 승인·철회 기록·manifest를 발급하거나 파일로 저장하지 않습니다.

- 정상 결합과 미승인 유지, 누락·변조·잘못된 형식, 역할별 근거와 정책·판본 혼용 거부.
- 릴리스·각 역할의 철회, 철회 이력 삭제/수정, 이전 리비전 재사용, 동일 릴리스 재지정 거부.
- 외부 기준 부재의 명시, JSON 왕복·정규 정렬·UTC 시각·불변 컬렉션, 독립 고정 SHA-256 fixture.
- 기존 R01·R02 고정 fixture와 manifest 테스트 유지.

`backend/`에서 `./gradlew test`, `./gradlew integrationTest`, `./gradlew build`, `./gradlew spotlessCheck`를 사용합니다. 통합 테스트는 일회용 PostGIS를 사용하며, 실제 개발 DB·보존 스냅샷·내보내기·실데이터 회귀 도구에는 접근하지 않습니다.

2026-11-02 검증 결과: 신규 신뢰 기록 **68개**, 전체 단위 **673개**, 일회용 DB 통합 **833개**가 통과했으며 실패·오류·건너뜀은 없습니다. 기존 스냅샷 **44개**·manifest **57개**와 고정 SHA-256 fixture를 유지했습니다. 빌드·Spotless, 제품 JAR 2개의 도구 제외, 문서 Prettier·링크·표·신규 파일 공백 검사를 확인했습니다. 별도 읽기 전용 코드 리뷰에서 지적된 이력 검사 범위도 위와 같이 명시했습니다.

후속 작업은 [거버넌스의 결정 목록](score-approval-governance.md#6-사용자가-최종-결정할-사항)에 따라 책임·권한·배포 경로와 이전 리비전 보존 방식을 확정하고, 운영 로더·철회/공개 게이트를 구현하는 것입니다. 현재 원천 판본의 의미적 비교 가능성, 정책·커버리지 승인도 별도로 필요합니다. 과거 12:17 전체 입력 fixture가 없으므로 **R03 완전 재현은 여전히 미완료**입니다.
