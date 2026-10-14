package com.example.backend.location;

import com.example.backend.admindong.ApiResponses;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Tag(name = "위치 판정", description = "WGS84 좌표의 operational 행정동·상권 경계 판정")
public class LocationController {
    private final LocationService service;
    public LocationController(LocationService service) { this.service = service; }

    @GetMapping("/api/locations/resolve")
    @Operation(summary = "좌표의 행정동·상권 판정", description = "EPSG:4326 POINT를 EPSG:5181로 변환해 current READY operational Polygon에 ST_Covers를 적용합니다. "
        + "행정동 1개는 RESOLVED, 복수는 AMBIGUOUS_BOUNDARY와 모든 candidates 및 resolvedDong=null, 0개는 OUTSIDE_OR_UNSUPPORTED입니다. "
        + "상권은 모든 memberships를 반환합니다. 공유 경계·원본 overlap을 임의 선택하지 않습니다. 경계 모호성/영역 미지원도 정상 200입니다. "
        + "투영 지원 영역 밖 좌표도 OUTSIDE_OR_UNSUPPORTED/NO_MEMBERSHIP으로 처리합니다. 역사적 통계 경계 호환성 UNRESOLVED와 source 속성 충돌을 metadata로 유지합니다. "
        + "query는 각각 정확히 한 번 필수. 최대 64자 십진수(지수 표기 허용), 유한값만 허용하며 공백·NaN·Infinity·0 underflow는 거부합니다.", parameters = {
        @Parameter(name = "lat", in = ParameterIn.QUERY, required = true, description = "WGS84 위도. -90~90, 최대 64자 십진수/지수 표기.",
            schema = @Schema(type = "number", format = "double", minimum = "-90", maximum = "90"), example = "37.5665"),
        @Parameter(name = "lng", in = ParameterIn.QUERY, required = true, description = "WGS84 경도. -180~180, 최대 64자 십진수/지수 표기.",
            schema = @Schema(type = "number", format = "double", minimum = "-180", maximum = "180"), example = "126.9780")
    })
    @ApiResponse(responseCode = "200", description = "행정동·상권 판정 및 dataset metadata", content = @Content(mediaType = "application/json", schema = @Schema(implementation = LocationResponses.Resolution.class)))
    @ApiResponse(responseCode = "400", description = "INVALID_PARAMETER: 미정의·중복·누락·빈 query. INVALID_COORDINATE: 좌표 형식·길이·유한값·범위 오류.",
        content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class)))
    @ApiResponse(responseCode = "503", description = "BOUNDARY_DATA_UNAVAILABLE: current READY 경계 부재·미준비. 0개 공간 match와 구분. field=null.",
        content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class)))
    @ApiResponse(responseCode = "500", description = "DATA_INTEGRITY_ERROR: 경계 버전·건수·식별자·품질 무결성 오류. INTERNAL_ERROR: 기타 내부 오류. field=null.",
        content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class)))
    public LocationResponses.Resolution resolve(@Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        return service.resolve(LocationQueryValidator.coordinate(query));
    }
}
