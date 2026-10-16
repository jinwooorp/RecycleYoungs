package com.example.backend.admindong;

import java.util.List;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonRawValue;
import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 10)
public class RegionService {
    private final RegionCatalog catalog;
    private final RegionRepository repository;
    private final AdminDongRepository stats;
    public RegionService(RegionCatalog catalog, RegionRepository repository, AdminDongRepository stats) {
        this.catalog = catalog; this.repository = repository; this.stats = stats;
    }
    public record Dong(String code, String name, boolean statisticsSupported, boolean boundaryAvailable) {}
    public record District(String code, String name, List<Dong> dongs) {}
    public record Regions(String city, String catalogVersion, String sourceUrl, String boundaryVersion, List<District> districts) {}
    public record Boundary(String code, String name, String datasetVersion, String sourceUrl, int displayCrs,
        String qualityStatus, String qualityDetail, String historicalCompatibilityStatus, String validationStatus,
        @Schema(types = {"string", "null"}) String referenceDate, boolean referenceDateVerified,
        @Schema(type = "object", description = "GeoJSON Polygon/MultiPolygon, EPSG:4326 [경도,위도] 및 내부 구멍 보존") @JsonRawValue String geometry) {}

    public Regions regions() {
        var lookup = stats.lookup();
        var supported = lookup.industries().stream().filter(i -> i.code().equals("CAFE") && i.available())
            .flatMap(i -> stats.supportedDongs(i.sourceCode()).stream()).collect(java.util.stream.Collectors.toSet());
        var boundaries = repository.boundaries("");
        var available = boundaries.stream().map(RegionRepository.BoundaryRow::code).collect(java.util.stream.Collectors.toSet());
        if (boundaries.stream().map(RegionRepository.BoundaryRow::version).distinct().count() > 1) throw new DataIntegrityException();
        var districts = catalog.dongs().stream().map(d -> new ApiResponses.NamedCode(d.districtCode(), d.districtName())).distinct()
            .sorted(java.util.Comparator.comparing(ApiResponses.NamedCode::code)).map(d -> new District(d.code(), d.name(),
                catalog.dongs().stream().filter(dong -> dong.districtCode().equals(d.code())).map(dong -> new Dong(dong.code(), dong.name(),
                    supported.contains(dong.code()), available.contains(dong.code()))).toList())).toList();
        return new Regions("서울특별시", "OA-22160+OA-22161-files-20231031", sourceUrl(),
            boundaries.isEmpty() ? null : boundaries.getFirst().version(), districts);
    }

    public Boundary boundary(String code, String version) {
        if (catalog.dongs().stream().noneMatch(d -> d.code().equals(code)))
            throw new InvalidQueryException("UNKNOWN_DONG", "지역 목록에 없는 행정동입니다.", "dongCode");
        var rows = repository.boundaries(code).stream().filter(r -> r.code().equals(code)).toList();
        if (rows.size() > 1) throw new DataIntegrityException();
        if (rows.isEmpty() || rows.getFirst().geometry() == null)
            throw new InvalidQueryException("BOUNDARY_DATA_UNAVAILABLE", "해당 행정동의 경계를 표시할 수 없습니다.", "dongCode");
        var row = rows.getFirst();
        if (version != null && !Objects.equals(version, row.version()))
            throw new InvalidQueryException("BOUNDARY_VERSION_CHANGED", "경계 버전이 변경됐습니다. 지역 목록을 새로 불러와 주세요.", "datasetVersion");
        return new Boundary(code, row.name(), row.version(), sourceUrl(), 4326, row.quality(), row.detail(),
            row.historicalCompatibility(), row.validationStatus(), row.referenceDate(), row.referenceDateVerified(), row.geometry());
    }
    private static String sourceUrl() { return "https://data.seoul.go.kr/dataList/OA-22160/S/1/datasetView.do"; }
}
