package com.example.backend.admindong;

import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.responses.ApiResponse;

@RestController
@io.swagger.v3.oas.annotations.responses.ApiResponses({
    @ApiResponse(responseCode = "400", description = "잘못된 코드·버전·미제공 경계", content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class))),
    @ApiResponse(responseCode = "500", description = "데이터 무결성 또는 내부 오류", content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class)))
})
public class RegionController {
    private final RegionService service;
    public RegionController(RegionService service) { this.service = service; }
    @GetMapping("/api/regions")
    @ApiResponse(responseCode = "200", description = "공식 구·동 목록과 지원 상태")
    @Operation(summary = "서울 구·행정동 목록", description = "공식 2023-10-31 파일의 425개 행정동 목록과 현재 통계·경계 지원 여부. 특정 분기 데이터 존재를 보장하지 않음.")
    public RegionService.Regions regions(@Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        QueryValidator.noQuery(query); return service.regions();
    }
    @GetMapping("/api/regions/admin-dongs/{dongCode}/boundary")
    @ApiResponse(responseCode = "200", description = "표시용 경계와 공간 자료의 품질 metadata")
    @Operation(summary = "선택 행정동 표시 경계", description = "현재 검증된 operational geometry의 EPSG:4326 GeoJSON. source geometry 수정 없음. 역사적 호환성과 품질 한계를 함께 제공.", parameters = {
        @Parameter(name = "datasetVersion", in = ParameterIn.QUERY, description = "목록 또는 위치 판정에서 받은 경계 버전. 변경 시 400 BOUNDARY_VERSION_CHANGED", schema = @Schema(type = "string", pattern = "^[1-9][0-9]*$"))
    })
    public RegionService.Boundary boundary(@PathVariable String dongCode, @Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        if (!dongCode.matches("[0-9]{8}")) throw new InvalidQueryException("INVALID_DONG_CODE", "행정동 코드 형식이 올바르지 않습니다.", "dongCode");
        if (query.keySet().stream().anyMatch(k -> !k.equals("datasetVersion"))
            || query.containsKey("datasetVersion") && (query.get("datasetVersion").size() != 1 || query.getFirst("datasetVersion") == null
            || !query.getFirst("datasetVersion").matches("[1-9][0-9]*")))
            throw new InvalidQueryException("INVALID_PARAMETER", "경계 버전은 정확히 한 번 전달해 주세요.", "datasetVersion");
        return service.boundary(dongCode, query.getFirst("datasetVersion"));
    }
}
