package com.example.backend.admindong;

import java.util.List;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 10)
public class ChangeScoreService {
    private final AdminDongRepository repository;
    private final RegionCatalog catalog;
    public ChangeScoreService(AdminDongRepository repository, RegionCatalog catalog) { this.repository = repository; this.catalog = catalog; }
    public record Item(ApiResponses.NamedCode dong, String status,
        @Schema(types = {"integer", "null"}, minimum = "0", maximum = "100") Integer score,
        @Schema(types = {"string", "null"}) String currentCount,
        @Schema(types = {"string", "null"}) String previousCount,
        @Schema(types = {"string", "null"}) String changeRate,
        @Schema(types = {"string", "null"}) String direction,
        @Schema(types = {"string", "null"}) String reason) {}
    public record Response(ApiResponses.Quarter quarter, String previousQuarterCode, String modelVersion, String baselineId,
        int cohortSize, int minimumCohortSize, String sourceUrl, String sourceSnapshotStatus, List<Item> items) {}
    public Response scores(List<String> codes, String quarter) {
        var lookup = repository.lookup();
        var q = lookup.quarters().stream().filter(v -> v.code().equals(quarter)).findFirst()
            .orElseThrow(() -> new InvalidQueryException("UNSUPPORTED_QUARTER", "지원하지 않는 분기입니다.", "quarterCode"));
        var industry = lookup.industries().stream().filter(i -> i.code().equals("CAFE") && i.available()).findFirst()
            .orElseThrow(() -> new InvalidQueryException("UNSUPPORTED_INDUSTRY", "카페 통계를 지원하지 않습니다.", "industryCode"));
        var dongs = codes.stream().map(code -> lookup.dongs().stream().filter(d -> d.code().equals(code) && code.startsWith("11")).findFirst()
            .orElseGet(() -> catalog.dongs().stream().filter(d -> d.code().equals(code)).map(d -> new ApiResponses.NamedCode(d.code(), d.name())).findFirst()
                .orElseThrow(() -> new InvalidQueryException("UNKNOWN_DONG", "조회 가능한 서울 행정동이 아닙니다.", "dongCodes")))).toList();
        String previous = ChangeScore.previousQuarter(quarter);
        boolean previousSupported = lookup.quarters().stream().anyMatch(v -> v.code().equals(previous));
        var currentRows = repository.consumptionRows(industry.sourceCode(), quarter);
        var previousRows = previousSupported ? repository.consumptionRows(industry.sourceCode(), previous) : List.<ConsumptionScore.Row>of();
        var items = dongs.stream().map(d -> {
            var r = ChangeScore.evaluate(d.code(), currentRows, previousRows);
            return new Item(d, r.score() == null ? "UNAVAILABLE" : "AVAILABLE", r.score(), r.currentCount(), r.previousCount(), r.changeRate(), r.direction(),
                previousSupported ? r.reason() : "PREVIOUS_QUARTER_UNAVAILABLE");
        }).toList();
        int size = ChangeScore.evaluate(codes.getFirst(), currentRows, previousRows).cohortSize();
        String canonical = ChangeScore.MODEL + ":" + quarter + ":" + previous + ":" + industry.sourceCode() + ":" + industry.id() + "\n"
            + currentRows.stream().sorted(java.util.Comparator.comparing(ConsumptionScore.Row::dongCode)).map(r -> r.dongCode() + ":" + r.transactions()).collect(java.util.stream.Collectors.joining("\n")) + "\nprevious\n"
            + previousRows.stream().sorted(java.util.Comparator.comparing(ConsumptionScore.Row::dongCode)).map(r -> r.dongCode() + ":" + r.transactions()).collect(java.util.stream.Collectors.joining("\n"));
        try {
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8)));
            return new Response(q, previous, ChangeScore.MODEL, hash, size, ChangeScore.MIN_COHORT,
                "https://data.seoul.go.kr/dataList/OA-22175/S/1/datasetView.do", "UNVERIFIED", items);
        } catch (NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }
}
