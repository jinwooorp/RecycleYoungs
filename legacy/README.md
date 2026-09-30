# 이전 실험 코드

`csv_server/`는 기존 TypeScript CSV 적재 실험과 Next.js/Vite·Prisma 초안을 보존한 디렉터리입니다. 현재 backend·frontend·Python ETL과 루트 Compose는 이 코드에 의존하지 않습니다.

보존한 자료는 소규모 합성 점포 CSV, TypeScript 점포 적재 실험, Prisma 점포·상권 모델 초안과 당시 설정입니다. 실제 서비스 데이터나 완성된 API로 취급하지 않습니다. 매출 적재는 미완성이고 인구 스크립트는 비어 있으며, Prisma의 실제 contract는 User/Post 예제입니다.

일상적인 개발은 루트 README의 명령을 사용합니다. 이 디렉터리의 문서·예시 명령은 당시 실험 기록이며 현재 실행 안내가 아닙니다. legacy Compose는 공용 DB와 다른 DB 설정으로 호스트 5432를 사용하므로 함께 실행하지 않습니다.

새 흐름의 데이터·재실행·Spring 조회 검증과 필요한 자료·설계 이전이 끝난 뒤 별도 변경으로 제거합니다. 기존 DB 볼륨이나 원본 자료를 코드 이동 과정에서 삭제하지 않습니다.
