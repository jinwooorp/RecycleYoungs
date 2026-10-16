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
public class ChangeScoreController {
    private final ChangeScoreService service;
    public ChangeScoreController(ChangeScoreService service) { this.service = service; }
    @GetMapping("/api/cafe-change-scores")
    @ApiResponse(responseCode = "200", description = "소비증감 상대 점수와 전분기 원자료·산정 불가 사유")
    @Operation(summary = "행정동 카페 소비증감 상대 점수", description = "직전 분기 대비 거래 건수 증감률의 중간 순위 백분위. 두 분기 유효 서울 카페 행정동 최소 30개. 전분기 0·NULL·누락은 제외. 상대 점수가 높아도 소비가 감소할 수 있음. 성공률이 아님. 원본 snapshot UNVERIFIED.", parameters = {
        @Parameter(name = "dongCodes", in = ParameterIn.QUERY, required = true, schema = @Schema(type = "string", pattern = "^[0-9]{8}(,[0-9]{8}){0,2}$")),
        @Parameter(name = "quarterCode", in = ParameterIn.QUERY, required = true, schema = @Schema(type = "string", pattern = "^[1-9][0-9]{3}[1-4]$"))
    })
    public ChangeScoreService.Response scores(@Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        if (query.size() != 2 || !query.containsKey("dongCodes") || !query.containsKey("quarterCode") || query.values().stream().anyMatch(v -> v.size() != 1)) throw invalid();
        String raw = query.getFirst("dongCodes");
        if (raw == null || !raw.matches("[0-9]{8}(,[0-9]{8}){0,2}")) throw invalid();
        var codes = List.of(raw.split(","));
        if (codes.stream().distinct().count() != codes.size()) throw invalid();
        var stats = new LinkedMultiValueMap<String, String>();
        stats.add("dongCode", codes.getFirst()); stats.add("industryCode", "CAFE"); stats.add("quarterCode", query.getFirst("quarterCode"));
        return service.scores(codes, QueryValidator.stats(stats).quarterCode());
    }
    private static InvalidQueryException invalid() {
        return new InvalidQueryException("INVALID_PARAMETER", "중복 없는 행정동 1~3개와 분기를 정확히 한 번 전달해 주세요.", "dongCodes");
    }
}
