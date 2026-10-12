package com.example.backend.location;

import com.example.backend.admindong.DataIntegrityException;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class LocationService {
    private final LocationRepository repository;
    public LocationService(LocationRepository repository) { this.repository = repository; }

    public LocationResponses.Resolution resolve(LocationResponses.Coordinate coordinate) {
        var rows = repository.resolve(coordinate);
        if (rows.stream().anyMatch(row -> !List.of("ADMIN_DONG", "COMMERCIAL_AREA").contains(row.kind()))) {
            throw new DataIntegrityException();
        }
        var adminRows = rows.stream().filter(row -> row.kind().equals("ADMIN_DONG")).toList();
        var commercialRows = rows.stream().filter(row -> row.kind().equals("COMMERCIAL_AREA")).toList();
        var adminDataset = dataset(adminRows, "OA-22160");
        var commercialDataset = dataset(commercialRows, "OA-15560");
        var dongs = adminRows.stream().map(LocationRepository.BoundaryRow::match).filter(java.util.Objects::nonNull)
            .map(m -> new LocationResponses.Dong(m.code(), m.name(), adminDataset.version(), m.qualityStatus(),
                m.qualityDetail(), m.pointRelation())).sorted(Comparator.comparing(LocationResponses.Dong::code)).toList();
        var areas = commercialRows.stream().map(LocationRepository.BoundaryRow::match).filter(java.util.Objects::nonNull)
            .map(m -> new LocationResponses.CommercialArea(m.code(), m.name(), commercialDataset.version(), m.qualityStatus(),
                m.qualityDetail(), m.pointRelation(), m.sourceAttributeStatus(), m.sourceAttributeDetail()))
            .sorted(Comparator.comparing(LocationResponses.CommercialArea::code)).toList();
        String status = dongs.isEmpty() ? "OUTSIDE_OR_UNSUPPORTED" : dongs.size() == 1 ? "RESOLVED" : "AMBIGUOUS_BOUNDARY";
        return new LocationResponses.Resolution(coordinate,
            new LocationResponses.AdminDongResult(status, dongs.isEmpty() ? "NO_COVERING_OPERATIONAL_BOUNDARY" : null,
                dongs.size() == 1 ? dongs.getFirst() : null, dongs.size() > 1 ? dongs : List.of(), adminDataset),
            new LocationResponses.CommercialAreaResult(areas.isEmpty() ? "NO_MEMBERSHIP" : "MEMBERSHIP", areas, commercialDataset));
    }

    private static LocationResponses.DatasetVersion dataset(List<LocationRepository.BoundaryRow> rows, String expectedId) {
        if (rows.isEmpty()) throw new BoundaryDataUnavailableException();
        var first = rows.getFirst();
        var dataset = first.dataset();
        // A duplicate current version is corruption, even if one of the versions is unavailable.
        if (rows.stream().anyMatch(row -> !row.dataset().equals(dataset) || !row.loadStatus().equals(first.loadStatus())
            || row.totalCount() != first.totalCount() || row.usableCount() != first.usableCount()
            || row.featureCount() != first.featureCount())) throw new DataIntegrityException();
        if (!first.loadStatus().equals("READY")) throw new BoundaryDataUnavailableException();
        if (!dataset.datasetId().equals(expectedId) || !dataset.version().matches("[1-9][0-9]*")
            || dataset.sourceCrs() != 5181 || dataset.loadedAt() == null
            || !List.of("PASSED", "PASSED_WITH_LIMITATIONS").contains(dataset.validationStatus())
            || dataset.referenceDateVerified() != (dataset.referenceDate() != null)
            || !List.of("UNRESOLVED", "VERIFIED").contains(dataset.historicalCompatibilityStatus())
            || first.featureCount() <= 0 || first.totalCount() != first.featureCount()
            || first.usableCount() != first.totalCount()) throw new DataIntegrityException();
        var codes = new HashSet<String>();
        for (var row : rows) {
            var m = row.match();
            if (m == null) {
                if (rows.size() != 1) throw new DataIntegrityException();
                continue;
            }
            if (!codes.add(m.code()) || !m.code().matches(expectedId.equals("OA-22160") ? "[0-9]{8}" : "[0-9]{1,20}")
                || m.name() == null || m.name().isBlank()
                || !List.of("INTERIOR", "BOUNDARY").contains(m.pointRelation())
                || !List.of("VALID_SOURCE", "REPAIRED_OPERATIONAL").contains(m.qualityStatus())
                || (m.qualityStatus().equals("VALID_SOURCE") ? m.qualityDetail() != null : m.qualityDetail() == null || m.qualityDetail().isBlank())) {
                throw new DataIntegrityException();
            }
            if (expectedId.equals("OA-15560") &&
                (!List.of("UNVERIFIED", "CONFLICT_OBSERVED").contains(m.sourceAttributeStatus())
                || (m.sourceAttributeStatus().equals("UNVERIFIED") ? m.sourceAttributeDetail() != null
                    : m.sourceAttributeDetail() == null || m.sourceAttributeDetail().isBlank()))) throw new DataIntegrityException();
        }
        return dataset;
    }
}
