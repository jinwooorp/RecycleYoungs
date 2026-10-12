package com.example.backend.location;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.example.backend.admindong.DataIntegrityException;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class LocationServiceTests {
    static final LocationResponses.Coordinate COORDINATE = new LocationResponses.Coordinate(37.5665, 126.978);
    static LocationResponses.DatasetVersion dataset(String kind, String version) {
        return new LocationResponses.DatasetVersion(version, kind.equals("ADMIN_DONG") ? "OA-22160" : "OA-15560",
            "fixture", "https://data.seoul.go.kr/", 5181, null, false, "UNRESOLVED", "PASSED_WITH_LIMITATIONS", "2026-10-12T00:00:00Z");
    }
    static LocationRepository.BoundaryRow row(String kind, String version, LocationRepository.Match match) {
        return new LocationRepository.BoundaryRow(kind, dataset(kind, version), "READY", 3, 3, 3, match);
    }
    static LocationRepository.Match match(boolean admin, int index, String relation) {
        return new LocationRepository.Match(admin ? "1111051" + index : "100" + index, "fixture " + index,
            "VALID_SOURCE", null, relation, admin ? null : "UNVERIFIED", null);
    }
    static LocationResponses.Resolution resolve(List<LocationRepository.BoundaryRow> rows) {
        var repository = mock(LocationRepository.class);
        when(repository.resolve(COORDINATE)).thenReturn(rows);
        return new LocationService(repository).resolve(COORDINATE);
    }

    @ParameterizedTest @CsvSource({"0,0", "1,0", "2,0", "0,1", "1,1", "2,1", "0,3", "1,3", "2,3"})
    void preservesAllMatchesAndSeparatesDomainStates(int dongs, int areas) {
        var rows = new java.util.ArrayList<LocationRepository.BoundaryRow>();
        if (dongs == 0) rows.add(row("ADMIN_DONG", "1", null));
        else IntStream.range(0, dongs).forEach(i -> rows.add(row("ADMIN_DONG", "1", match(true, i, "INTERIOR"))));
        if (areas == 0) rows.add(row("COMMERCIAL_AREA", "2", null));
        else IntStream.range(0, areas).forEach(i -> rows.add(row("COMMERCIAL_AREA", "2", match(false, i, "BOUNDARY"))));
        var result = resolve(rows);
        assertThat(result.coordinate()).isEqualTo(COORDINATE);
        assertThat(result.adminDong().status()).isEqualTo(dongs == 0 ? "OUTSIDE_OR_UNSUPPORTED" : dongs == 1 ? "RESOLVED" : "AMBIGUOUS_BOUNDARY");
        assertThat(result.adminDong().resolvedDong() != null).isEqualTo(dongs == 1);
        assertThat(result.adminDong().candidates()).hasSize(dongs > 1 ? dongs : 0);
        assertThat(result.adminDong().reason()).isEqualTo(dongs == 0 ? "NO_COVERING_OPERATIONAL_BOUNDARY" : null);
        assertThat(result.commercialArea().status()).isEqualTo(areas == 0 ? "NO_MEMBERSHIP" : "MEMBERSHIP");
        assertThat(result.commercialArea().memberships()).hasSize(areas);
        assertThat(result.adminDong().dataset().version()).isEqualTo("1");
        assertThat(result.commercialArea().dataset().version()).isEqualTo("2");
    }

    @Test void singleBoundaryMatchAndSourceConflictAreRetainedWithoutAttributeFallback() {
        var conflict = new LocationRepository.Match("1000", "홍지문 fixture", "REPAIRED_OPERATIONAL", "make_valid fixture",
            "BOUNDARY", "CONFLICT_OBSERVED", "H5 conflict fixture");
        var result = resolve(List.of(row("ADMIN_DONG", "1", match(true, 0, "BOUNDARY")), row("COMMERCIAL_AREA", "2", conflict)));
        assertThat(result.adminDong().resolvedDong().pointRelation()).isEqualTo("BOUNDARY");
        assertThat(result.adminDong().resolvedDong().code()).isEqualTo("11110510");
        assertThat(result.commercialArea().memberships().getFirst().sourceAttributeStatus()).isEqualTo("CONFLICT_OBSERVED");
    }

    @Test void missingEitherCurrentDatasetIsUnavailable() {
        assertThatThrownBy(() -> resolve(List.of())).isInstanceOf(BoundaryDataUnavailableException.class);
        assertThatThrownBy(() -> resolve(List.of(row("ADMIN_DONG", "1", null)))).isInstanceOf(BoundaryDataUnavailableException.class);
        assertThatThrownBy(() -> resolve(List.of(row("COMMERCIAL_AREA", "2", null)))).isInstanceOf(BoundaryDataUnavailableException.class);
    }

    @Test void nonReadyCurrentIsUnavailable() {
        var pending = new LocationRepository.BoundaryRow("ADMIN_DONG", dataset("ADMIN_DONG", "1"), "PENDING", 3, 0, 0, null);
        assertThatThrownBy(() -> resolve(List.of(pending, row("COMMERCIAL_AREA", "2", null))))
            .isInstanceOf(BoundaryDataUnavailableException.class);
    }

    @Test void missingOrUnusableOperationalRowsInReadyDatasetAreCorruption() {
        for (long[] counts : new long[][]{{0,0}, {2,2}, {3,2}}) {
            var corrupt = new LocationRepository.BoundaryRow("ADMIN_DONG", dataset("ADMIN_DONG", "1"), "READY", 3, counts[0], counts[1], null);
            assertThatThrownBy(() -> resolve(List.of(corrupt, row("COMMERCIAL_AREA", "2", null)))).isInstanceOf(DataIntegrityException.class);
        }
    }

    @Test void duplicateVersionsOrCodesNeverResolveByPickingFirst() {
        assertThatThrownBy(() -> resolve(List.of(row("ADMIN_DONG", "1", null), row("ADMIN_DONG", "3", null), row("COMMERCIAL_AREA", "2", null))))
            .isInstanceOf(DataIntegrityException.class);
        assertThatThrownBy(() -> resolve(List.of(row("ADMIN_DONG", "1", match(true, 0, "INTERIOR")),
            row("ADMIN_DONG", "1", match(true, 0, "INTERIOR")), row("COMMERCIAL_AREA", "2", null))))
            .isInstanceOf(DataIntegrityException.class);
    }

    @Test void badQualityOrSourceAttributesAreIntegrityErrors() {
        for (var bad : List.of(
            new LocationRepository.Match("1000", "fixture", "UNSUPPORTED", "unusable", "INTERIOR", "UNVERIFIED", null),
            new LocationRepository.Match("1000", "fixture", "VALID_SOURCE", null, "INTERIOR", "CONFLICT_OBSERVED", null))) {
            assertThatThrownBy(() -> resolve(List.of(row("ADMIN_DONG", "1", null), row("COMMERCIAL_AREA", "2", bad))))
                .isInstanceOf(DataIntegrityException.class);
        }
    }
}
