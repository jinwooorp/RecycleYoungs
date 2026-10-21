package com.example.backend.admindong;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 10)
public class ConsumptionScoreService {
    private final AdminDongRepository repository;
    private final RegionCatalog catalog;
    public ConsumptionScoreService(AdminDongRepository repository, RegionCatalog catalog) { this.repository = repository; this.catalog = catalog; }
    public record Item(ApiResponses.NamedCode dong, String status,
        @Schema(types = {"integer", "null"}, minimum = "0", maximum = "100") Integer score,
        @Schema(types = {"string", "null"}, pattern = "^-?[0-9]+$") String transactionCount,
        @Schema(types = {"string", "null"}) String reason) {}
    public record Response(ApiResponses.Quarter quarter, String modelVersion, String baselineId, int cohortSize,
        int minimumCohortSize, String sourceUrl, String sourceSnapshotStatus, List<Item> items,
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) DataPublication.Metadata metadata) {
        public Response(ApiResponses.Quarter quarter,String modelVersion,String baselineId,int cohortSize,int minimumCohortSize,
                        String sourceUrl,String sourceSnapshotStatus,List<Item> items) {
            this(quarter,modelVersion,baselineId,cohortSize,minimumCohortSize,sourceUrl,sourceSnapshotStatus,items,null);
        }
    }

    public Response scores(List<String> codes, String quarter) {
        return scores(codes,quarter,null);
    }
    public Response scores(List<String> codes, String quarter, String dataVersion) {
        var metadata=repository.requireVersion(dataVersion);
        var lookup = repository.lookup(); // Preserve mapping/duplicate/name integrity validation.
        var q = lookup.quarters().stream().filter(v -> v.code().equals(quarter)).findFirst()
            .orElseThrow(() -> new InvalidQueryException("UNSUPPORTED_QUARTER", "지원하지 않는 분기입니다.", "quarterCode"));
        var industry = lookup.industries().stream().filter(i -> i.code().equals("CAFE") && i.available()).findFirst()
            .orElseThrow(() -> new InvalidQueryException("UNSUPPORTED_INDUSTRY", "카페 통계를 지원하지 않습니다.", "industryCode"));
        var dongs = codes.stream().map(code -> lookup.dongs().stream().filter(d -> d.code().equals(code) && code.startsWith("11")).findFirst()
            .orElseGet(() -> catalog.dongs().stream().filter(d -> d.code().equals(code))
                .map(d -> new ApiResponses.NamedCode(d.code(), d.name())).findFirst()
                .orElseThrow(() -> new InvalidQueryException("UNKNOWN_DONG", "조회 가능한 서울 행정동이 아닙니다.", "dongCodes")))).toList();
        var rows = repository.consumptionRows(industry.sourceCode(), quarter);
        var results = dongs.stream().map(d -> {
            var result = ConsumptionScore.evaluate(d.code(), rows);
            return new Item(d, result.status(), result.score(), result.transactionCount(), result.reason());
        }).toList();
        int size = ConsumptionScore.evaluate(codes.getFirst(), rows).cohortSize();
        String canonical = quarter + ":" + industry.sourceCode() + ":" + industry.id() + "\n"
            + rows.stream().map(r -> r.dongCode() + ":" + r.transactions()).collect(java.util.stream.Collectors.joining("\n"));
        return new Response(q, ConsumptionScore.MODEL, digest(canonical), size, ConsumptionScore.MIN_COHORT,
            "https://data.seoul.go.kr/dataList/OA-22175/S/1/datasetView.do", "UNVERIFIED", results,metadata);
    }
    private static String digest(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }
}
