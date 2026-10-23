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
        content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@io.swagger.v3.oas.annotations.media.Schema(implementation=ApiResponses.Error.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="503", description="참고 지표 미제공",
        content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@io.swagger.v3.oas.annotations.media.Schema(implementation=ApiResponses.Error.class)))
})
public class AdminDongContextController {
    private final AdminDongContextService service;
    public AdminDongContextController(AdminDongContextService service) { this.service=service; }
    @GetMapping("/api/admin-dong-context")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="200",description="조회 결과와 원천별 상태",
        content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@io.swagger.v3.oas.annotations.media.Schema(implementation=ContextResponses.Context.class)))
    @Operation(summary="행정동 참고 지표 6종",description="dongCode·quarterCode·dataVersion은 각각 한 번 필수입니다. 업종·위치·반경 query는 허용하지 않습니다. 400 형식/지원값, 409 버전 변경, 503 참고 자료 미제공, 500 무결성 오류. 소비 자료는 전체 보류하며 점수로 사용하지 않습니다.")
    @io.swagger.v3.oas.annotations.Parameter(name="dongCode",in=io.swagger.v3.oas.annotations.enums.ParameterIn.QUERY,required=true,description="조회 가능한 8자리 행정동 코드",schema=@io.swagger.v3.oas.annotations.media.Schema(type="string"))
    @io.swagger.v3.oas.annotations.Parameter(name="quarterCode",in=io.swagger.v3.oas.annotations.enums.ParameterIn.QUERY,required=true,description="제공 분기 YYYYQ",schema=@io.swagger.v3.oas.annotations.media.Schema(type="string"))
    @io.swagger.v3.oas.annotations.Parameter(name="dataVersion",in=io.swagger.v3.oas.annotations.enums.ParameterIn.QUERY,required=true,description="선택한 공개 버전 SHA-256 또는 legacy-unversioned",schema=@io.swagger.v3.oas.annotations.media.Schema(type="string"))
    public ContextResponses.Context context(@io.swagger.v3.oas.annotations.Parameter(hidden=true) @RequestParam MultiValueMap<String,String> query) {
        return service.context(QueryValidator.context(query));
    }
}
