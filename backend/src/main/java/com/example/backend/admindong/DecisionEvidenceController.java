package com.example.backend.admindong;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@io.swagger.v3.oas.annotations.responses.ApiResponses({
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="400",description="잘못된 후보·분기·버전",content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@io.swagger.v3.oas.annotations.media.Schema(implementation=ApiResponses.Error.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="409",description="공개 자료 버전 변경",content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@io.swagger.v3.oas.annotations.media.Schema(implementation=ApiResponses.Error.class))),
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="500",description="무결성 또는 내부 오류",content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@io.swagger.v3.oas.annotations.media.Schema(implementation=ApiResponses.Error.class)))
})
public class DecisionEvidenceController {
    private final DecisionEvidenceService service;
    public DecisionEvidenceController(DecisionEvidenceService service) { this.service=service; }
    @GetMapping("/api/admin-dong-indicators/batch")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode="200",description="공통 조건의 지표·비교 집단·참고 원값과 총점 미제공 근거",content=@io.swagger.v3.oas.annotations.media.Content(mediaType="application/json",schema=@io.swagger.v3.oas.annotations.media.Schema(implementation=DecisionEvidenceService.Response.class)))
    @Operation(summary="행정동 후보 판단 근거 묶음",description="공통 quarterCode·dataVersion과 중복 없는 dongCodes 1~3개가 필수입니다. 같은 읽기 전용 snapshot에서 기존 거래 규모/증감 상대 지표와 참고 원값·보류 사유를 제공합니다. 비교 집단은 각 분기의 서울 카페이며 선택 후보로 재계산하지 않습니다. 검증되지 않은 종합 총점·가중치·성공률은 제공하지 않습니다.")
    @io.swagger.v3.oas.annotations.Parameter(name="dongCodes",in=io.swagger.v3.oas.annotations.enums.ParameterIn.QUERY,required=true,schema=@io.swagger.v3.oas.annotations.media.Schema(type="string",pattern="^[0-9]{8}(,[0-9]{8}){0,2}$"))
    @io.swagger.v3.oas.annotations.Parameter(name="quarterCode",in=io.swagger.v3.oas.annotations.enums.ParameterIn.QUERY,required=true,schema=@io.swagger.v3.oas.annotations.media.Schema(type="string",pattern="^[1-9][0-9]{3}[1-4]$"))
    @io.swagger.v3.oas.annotations.Parameter(name="dataVersion",in=io.swagger.v3.oas.annotations.enums.ParameterIn.QUERY,required=true,schema=@io.swagger.v3.oas.annotations.media.Schema(type="string",pattern="^[0-9a-f]{64}$|^legacy-unversioned$"))
    public DecisionEvidenceService.Response evidence(@io.swagger.v3.oas.annotations.Parameter(hidden=true) @RequestParam MultiValueMap<String,String> query) {
        return service.evidence(DecisionQuery.parse(query));
    }
}
