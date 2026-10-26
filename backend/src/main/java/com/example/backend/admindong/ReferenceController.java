package com.example.backend.admindong;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@io.swagger.v3.oas.annotations.responses.ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="400",description="잘못된 query",content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@Schema(implementation=ApiResponses.Error.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="409",description="공개 또는 참고 버전 변경",content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@Schema(implementation=ApiResponses.Error.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="500",description="무결성 또는 내부 오류",content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@Schema(implementation=ApiResponses.Error.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="503",description="참고 목록 미제공",content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@Schema(implementation=ApiResponses.Error.class)))
})
public class ReferenceController {
    private final ReferenceService service;
    public ReferenceController(ReferenceService service) { this.service=service; }
    @GetMapping("/api/reference-catalog")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="200",description="현재 원천 목록과 독립 공개·정책 버전",content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@Schema(implementation=ReferenceResponses.Catalog.class)))
    @Operation(summary="현재 원천 참고 목록",description="dataVersion 필수. 버스·공영주차장·지하철 상가의 현재 수집본입니다. 분기·500m·점수 자료가 아닙니다. 미공개503, 버전 변경409, 무결성500.")
    @Parameter(name="dataVersion",in=ParameterIn.QUERY,required=true,schema=@Schema(type="string",pattern="^[0-9a-f]{64}$|^legacy-unversioned$"))
    public ReferenceResponses.Catalog catalog(@Parameter(hidden=true) @RequestParam MultiValueMap<String,String> query) {
        return service.catalog(ReferenceQuery.catalog(query));
    }
    @GetMapping("/api/reference-records")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="200",description="원천별 허용 필드와 검색·페이지 결과",content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@Schema(implementation=ReferenceResponses.Records.class)))
    @Operation(summary="현재 원천 참고 목록 검색",description="sourceId·referenceVersion·dataVersion 필수. query 최대80자, page 1~2500, 페이지20건. 원천별 허용 필드만 제공하며 좌표·요금·임대료·실시간 여유면수·점수는 제공하지 않습니다.",parameters={
        @Parameter(name="sourceId",in=ParameterIn.QUERY,required=true,schema=@Schema(type="string",allowableValues={"seoul-bus-stops","seoul-public-parking","seoul-metro-leases"})),
        @Parameter(name="referenceVersion",in=ParameterIn.QUERY,required=true,schema=@Schema(type="string",pattern="^[0-9a-f]{64}$")),
        @Parameter(name="dataVersion",in=ParameterIn.QUERY,required=true,schema=@Schema(type="string",pattern="^[0-9a-f]{64}$|^legacy-unversioned$")),
        @Parameter(name="query",in=ParameterIn.QUERY,schema=@Schema(type="string",maxLength=80)),
        @Parameter(name="page",in=ParameterIn.QUERY,schema=@Schema(type="integer",minimum="1",maximum="2500",defaultValue="1"))
    })
    public ReferenceResponses.Records records(@Parameter(hidden=true) @RequestParam MultiValueMap<String,String> query) {
        return service.records(ReferenceQuery.records(query));
    }
}
