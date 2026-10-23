package com.example.backend.admindong;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@io.swagger.v3.oas.annotations.responses.ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="400", description="잘못된 query 또는 지원하지 않는 조회 조건",
        content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@io.swagger.v3.oas.annotations.media.Schema(implementation=ApiResponses.Error.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="409", description="공개 자료 버전 변경",
        content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@io.swagger.v3.oas.annotations.media.Schema(implementation=ApiResponses.Error.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="500", description="무결성 또는 내부 오류",
        content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@io.swagger.v3.oas.annotations.media.Schema(implementation=ApiResponses.Error.class)))
})
public class AdminDongSalesBreakdownController {
    private final AdminDongSalesBreakdownService service;
    public AdminDongSalesBreakdownController(AdminDongSalesBreakdownService service) { this.service=service; }
    @GetMapping("/api/admin-dong-sales-breakdown")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="200",description="조회 결과와 원천별 상태",
        content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@io.swagger.v3.oas.annotations.media.Schema(implementation=ContextResponses.Breakdown.class)))
    @Operation(summary="카페 추정매출 세부 구성",description="dongCode·industryCode=CAFE·quarterCode·dataVersion은 각각 한 번 필수입니다. 금액은 원, 거래건수는 건이며 정밀 문자열/NULL/NO_ROW를 구분합니다. 소비 원천 보류와 별개인 기존 카페 매출의 요일·시간·성·연령별 구성입니다. 합계 일치를 보정하거나 고객 수로 해석하지 않습니다.")
    @io.swagger.v3.oas.annotations.Parameter(name="dongCode",in=io.swagger.v3.oas.annotations.enums.ParameterIn.QUERY,required=true,description="조회 가능한 8자리 행정동 코드",schema=@io.swagger.v3.oas.annotations.media.Schema(type="string"))
    @io.swagger.v3.oas.annotations.Parameter(name="industryCode",in=io.swagger.v3.oas.annotations.enums.ParameterIn.QUERY,required=true,description="CAFE",schema=@io.swagger.v3.oas.annotations.media.Schema(type="string"))
    @io.swagger.v3.oas.annotations.Parameter(name="quarterCode",in=io.swagger.v3.oas.annotations.enums.ParameterIn.QUERY,required=true,description="제공 분기 YYYYQ",schema=@io.swagger.v3.oas.annotations.media.Schema(type="string"))
    @io.swagger.v3.oas.annotations.Parameter(name="dataVersion",in=io.swagger.v3.oas.annotations.enums.ParameterIn.QUERY,required=true,description="선택한 공개 버전 SHA-256 또는 legacy-unversioned",schema=@io.swagger.v3.oas.annotations.media.Schema(type="string"))
    public ContextResponses.Breakdown breakdown(@io.swagger.v3.oas.annotations.Parameter(hidden=true) @RequestParam MultiValueMap<String,String> query) {
        return service.breakdown(QueryValidator.breakdown(query));
    }
}
