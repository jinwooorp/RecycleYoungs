package com.example.backend.nearby;

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
@Tag(name = "경쟁 카페", description = "SEMAS 가용 카페 POINT의 반경 500m 조회")
public class NearbyController {
    private final NearbyService service;
    public NearbyController(NearbyService service) { this.service = service; }

    @GetMapping("/api/nearby-stores")
    @Operation(summary = "반경 500m 경쟁 카페 조회", description = "CAFE에 매핑된 SEMAS I21201의 사용 가능한 POINT만 geography ST_DWithin으로 조회합니다. "
        + "반경 500m를 포함하며 거리 오름차순, 같은 거리는 sourceStoreId C collation 순으로 최대 100개 반환합니다. totalCount는 전체 건수의 문자열입니다. "
        + "가용 자료에서 0개는 정상 200/totalCount=문자열 0/stores=[], 자료·매핑 미준비는 503입니다. "
        + "snapshotStatus=UNVERIFIED, referenceDate/loadedAt=null이며 누락을 폐업으로 단정하지 않습니다. query는 각각 정확히 한 번 필수. "
        + "좌표는 최대 64자 십진수(지수 표기 허용), 유한값이며 공백·NaN·Infinity·0 underflow는 거부합니다.", parameters = {
        @Parameter(name = "lat", in = ParameterIn.QUERY, required = true, description = "WGS84 위도. -90~90, 최대 64자 십진수/지수 표기.",
            schema = @Schema(type = "number", format = "double", minimum = "-90", maximum = "90"), example = "37.5665"),
        @Parameter(name = "lng", in = ParameterIn.QUERY, required = true, description = "WGS84 경도. -180~180, 최대 64자 십진수/지수 표기.",
            schema = @Schema(type = "number", format = "double", minimum = "-180", maximum = "180"), example = "126.9780"),
        @Parameter(name = "radius", in = ParameterIn.QUERY, required = true, description = "문자열 500만 허용. 500.0/+500/0500 등은 UNSUPPORTED_RADIUS. 단위 m.",
            schema = @Schema(type = "string", allowableValues = {"500"}), example = "500"),
        @Parameter(name = "industryCode", in = ParameterIn.QUERY, required = true, description = "대소문자를 구분하는 CAFE만 허용. 다른 값은 UNSUPPORTED_INDUSTRY.",
            schema = @Schema(type = "string", allowableValues = {"CAFE"}), example = "CAFE")
    })
    @ApiResponse(responseCode = "200", description = "전체 건수·최대 100개 목록·자료 품질 metadata", content = @Content(mediaType = "application/json", schema = @Schema(implementation = NearbyResponses.Result.class)))
    @ApiResponse(responseCode = "400", description = "INVALID_PARAMETER: 미정의·중복·누락·빈 query. INVALID_COORDINATE: 좌표 오류. "
        + "UNSUPPORTED_RADIUS: 500 이외. UNSUPPORTED_INDUSTRY: CAFE 이외.",
        content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class)))
    @ApiResponse(responseCode = "503", description = "CAFE_MAPPING_UNAVAILABLE: CAFE/SEMAS I21201 매핑 부재·불일치. "
        + "STORES_DATA_UNAVAILABLE: 점포 전체 자료 없음. CAFE_DATA_UNAVAILABLE: 가용 카페 없음. field=null.",
        content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class)))
    @ApiResponse(responseCode = "500", description = "DATA_INTEGRITY_ERROR: 분류·건수·목록·좌표 무결성 오류. INTERNAL_ERROR: 기타 내부 오류. field=null.",
        content = @Content(mediaType = "application/json", schema = @Schema(implementation = ApiResponses.Error.class)))
    public NearbyResponses.Result nearby(@Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        return service.find(NearbyQueryValidator.validate(query));
    }
}
