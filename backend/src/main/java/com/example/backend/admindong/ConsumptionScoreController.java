package com.example.backend.admindong;

import java.util.List;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.responses.ApiResponse;

@RestController
@io.swagger.v3.oas.annotations.responses.ApiResponses({
    @ApiResponse(responseCode = "400", description = "잘못된 코드·분기·중복 파라미터", content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class))),
    @ApiResponse(responseCode = "500", description = "데이터 무결성 또는 내부 오류", content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class)))
})
public class ConsumptionScoreController {
    private final ConsumptionScoreService service;
    public ConsumptionScoreController(ConsumptionScoreService service) { this.service = service; }
    @GetMapping("/api/cafe-consumption-scores")
    @ApiResponse(responseCode="409",description="DATA_VERSION_CHANGED: 공개 자료 버전 변경",content=@Content(mediaType="application/json",schema=@Schema(implementation=ApiResponses.Error.class)))
    @ApiResponse(responseCode = "200", description = "지역별 점수 또는 산정 불가 사유 및 비교 집단 정보")
    @Operation(summary = "행정동 카페 소비규모 상대 점수", description = "동일 분기 서울 카페 거래 건수의 중간 순위 백분위. 종합 입지 점수나 성공률이 아님. 최소 30개 유효 행정동. BIGINT는 문자열. 원본 snapshot은 UNVERIFIED.", parameters = {
        @Parameter(name = "dongCodes", in = ParameterIn.QUERY, required = true, description = "쉼표로 구분한 중복 없는 서울 행정동 1~3개", schema = @Schema(type = "string", pattern = "^[0-9]{8}(,[0-9]{8}){0,2}$")),
        @Parameter(name = "quarterCode", in = ParameterIn.QUERY, required = true, description = "지원 분기 YYYYQ", schema = @Schema(type = "string", pattern = "^[1-9][0-9]{3}[1-4]$")),
        @Parameter(name="dataVersion",in=ParameterIn.QUERY,description="선택한 분기의 공개 버전. 불일치 시 409.",schema=@Schema(type="string",pattern="^[0-9a-f]{64}$|^legacy-unversioned$"))
    })
    public ConsumptionScoreService.Response scores(@Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        if (query.size() != (query.containsKey("dataVersion")?3:2) || !query.containsKey("dongCodes") || !query.containsKey("quarterCode")
            || query.values().stream().anyMatch(v -> v.size() != 1)) throw invalid();
        String raw = query.getFirst("dongCodes");
        if (raw == null || !raw.matches("[0-9]{8}(,[0-9]{8}){0,2}")) throw invalid();
        var codes = List.of(raw.split(","));
        if (codes.stream().distinct().count() != codes.size()) throw invalid();
        var statsQuery = new LinkedMultiValueMap<String, String>();
        statsQuery.add("dongCode", codes.getFirst()); statsQuery.add("industryCode", "CAFE");
        statsQuery.add("quarterCode", query.getFirst("quarterCode"));
        if (query.containsKey("dataVersion")) statsQuery.add("dataVersion",query.getFirst("dataVersion"));
        var valid = QueryValidator.stats(statsQuery);
        return valid.dataVersion()==null?service.scores(codes, valid.quarterCode()):service.scores(codes,valid.quarterCode(),valid.dataVersion());
    }
    private static InvalidQueryException invalid() {
        return new InvalidQueryException("INVALID_PARAMETER", "중복 없는 행정동 1~3개와 분기를 정확히 한 번 전달해 주세요.", "dongCodes");
    }
}
