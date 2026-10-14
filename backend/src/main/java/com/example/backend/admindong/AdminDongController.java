package com.example.backend.admindong;

import java.util.List;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Tag(name = "행정동 통계", description = "서울시 행정동·업종·분기 lookup 및 통계 조회")
@io.swagger.v3.oas.annotations.responses.ApiResponses({
    @ApiResponse(responseCode = "400", description = "INVALID_PARAMETER: 허용하지 않는 query.",
        content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class))),
    @ApiResponse(responseCode = "500", description = "DATA_INTEGRITY_ERROR: 조회 데이터 무결성 오류. INTERNAL_ERROR: 기타 내부 오류. field=null.",
        content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class)))
})
public class AdminDongController {
    private final AdminDongService service;
    public AdminDongController(AdminDongService service) { this.service = service; }

    @GetMapping("/api/admin-dongs")
    @Operation(summary = "조회 가능한 행정동 목록", description = "업종 매핑된 점포·행정동 매출 자료에서 조회 가능한 8자리 코드와 이름을 반환합니다. 현재 적재 검증 자료는 2025년입니다. "
        + "query는 허용하지 않으며 추가 시 400 INVALID_PARAMETER입니다. 빈 목록은 정상 200입니다.")
    @ApiResponse(responseCode = "200", description = "행정동 코드·이름 배열", content = @Content(mediaType = "application/json", array = @ArraySchema(schema = @Schema(implementation = ApiResponses.NamedCode.class))))
    public List<ApiResponses.NamedCode> dongs(@Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        QueryValidator.noQuery(query);
        return service.dongs();
    }
    @GetMapping("/api/industries")
    @Operation(summary = "통계 조회 지원 업종 목록", description = "서울시 업종 매핑과 조회 자료가 있는 내부 업종만 반환합니다. "
        + "주변 경쟁 점포 API의 CAFE 전용 지원 범위와 구분합니다. query는 허용하지 않으며 추가 시 400 INVALID_PARAMETER입니다. 빈 목록은 정상 200입니다.")
    @ApiResponse(responseCode = "200", description = "내부 업종 코드·이름 배열", content = @Content(mediaType = "application/json", array = @ArraySchema(schema = @Schema(implementation = ApiResponses.NamedCode.class))))
    public List<ApiResponses.NamedCode> industries(@Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        QueryValidator.noQuery(query);
        return service.industries();
    }
    @GetMapping("/api/quarters")
    @Operation(summary = "통계 조회 지원 분기 목록", description = "업종 매핑된 통계·매출 자료에 존재하는 YYYYQ 분기를 반환합니다. 현재 적재 검증 자료는 20251~20254입니다. "
        + "query는 허용하지 않으며 추가 시 400 INVALID_PARAMETER입니다. 빈 목록은 정상 200입니다.")
    @ApiResponse(responseCode = "200", description = "분기 code·label 배열", content = @Content(mediaType = "application/json", array = @ArraySchema(schema = @Schema(implementation = ApiResponses.Quarter.class))))
    public List<ApiResponses.Quarter> quarters(@Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        QueryValidator.noQuery(query);
        return service.quarters();
    }

    @GetMapping("/api/admin-dong-stats")
    @Operation(summary = "행정동·업종의 단일 분기 통계", description = "점포 통계와 추정매출을 각각 조회합니다. 행 부재는 해당 객체=null과 missingReasons=NO_ROW, "
        + "행의 개별 NULL은 필드=null, 실제 0은 0 또는 매출·거래건수 문자열 0으로 구분합니다. 금액 단위는 원입니다. "
        + "query는 각각 정확히 한 번 필수이며 공백을 보정하지 않습니다.", parameters = {
        @Parameter(name = "dongCode", in = ParameterIn.QUERY, required = true, description = "8자리 ASCII 행정동 코드. /api/admin-dongs에서 지원값 확인.",
            schema = @Schema(type = "string", pattern = "^[0-9]{8}$"), example = "11110515"),
        @Parameter(name = "industryCode", in = ParameterIn.QUERY, required = true, description = "내부 업종 코드. /api/industries에서 지원값 확인. 미등록 UNKNOWN_INDUSTRY, 매핑/자료 미지원 UNSUPPORTED_INDUSTRY.",
            schema = @Schema(type = "string", pattern = "^[A-Z][A-Z0-9_]{0,29}$"), example = "CAFE"),
        @Parameter(name = "quarterCode", in = ParameterIn.QUERY, required = true, description = "YYYYQ 형식. 실제 지원값은 /api/quarters에서 확인하며 현재 범위는 20251~20254.",
            schema = @Schema(type = "string", pattern = "^[1-9][0-9]{3}[1-4]$"), example = "20251")
    })
    @ApiResponse(responseCode = "200", description = "통계 및 누락 사유. 행 부재도 200.", content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Stats.class)))
    @ApiResponse(responseCode = "400", description = "INVALID_PARAMETER: 미정의·중복·누락·빈 query. INVALID_DONG_CODE / INVALID_INDUSTRY_CODE / INVALID_QUARTER: 형식 오류. "
        + "UNKNOWN_DONG / UNKNOWN_INDUSTRY: lookup에 없는 코드. UNSUPPORTED_INDUSTRY / UNSUPPORTED_QUARTER: lookup에서 지원하지 않는 값.",
        content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class)))
    public ApiResponses.Stats stats(@Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        return service.stats(QueryValidator.stats(query));
    }

    @GetMapping("/api/admin-dong-trends")
    @Operation(summary = "행정동·업종의 분기 추세", description = "20251, 20252, 20253, 20254를 오름차순으로 항상 4개 반환합니다. "
        + "누락 분기도 제거하지 않고 객체=null 및 NO_ROW를 유지합니다. 금액·거래건수는 문자열, 점포 건수는 정수입니다. "
        + "query는 각각 정확히 한 번 필수이며 quarterCode 등 추가 query는 거부합니다.", parameters = {
        @Parameter(name = "dongCode", in = ParameterIn.QUERY, required = true, description = "8자리 ASCII 행정동 코드. /api/admin-dongs에서 지원값 확인.",
            schema = @Schema(type = "string", pattern = "^[0-9]{8}$"), example = "11110515"),
        @Parameter(name = "industryCode", in = ParameterIn.QUERY, required = true, description = "내부 업종 코드. /api/industries에서 지원값 확인.",
            schema = @Schema(type = "string", pattern = "^[A-Z][A-Z0-9_]{0,29}$"), example = "CAFE")
    })
    @ApiResponse(responseCode = "200", description = "4개 분기 통계 및 누락 사유", content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Trend.class)))
    @ApiResponse(responseCode = "400", description = "INVALID_PARAMETER: 미정의·중복·누락·빈 query. INVALID_DONG_CODE / INVALID_INDUSTRY_CODE: 형식 오류. "
        + "UNKNOWN_DONG / UNKNOWN_INDUSTRY: lookup에 없는 코드. UNSUPPORTED_INDUSTRY: 지원하지 않는 업종.",
        content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class)))
    public ApiResponses.Trend trends(@Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        return service.trends(QueryValidator.trends(query));
    }
}
