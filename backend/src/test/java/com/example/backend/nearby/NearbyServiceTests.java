package com.example.backend.nearby;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import com.example.backend.admindong.DataIntegrityException;

class NearbyServiceTests {
    static final NearbyResponses.Query QUERY = new NearbyResponses.Query(new NearbyResponses.Coordinate(37.5665, 126.978), 500, "CAFE");
    static NearbyRepository.Inventory inventory() { return new NearbyRepository.Inventory(1L, 1L, 1000, 200, 180, 10, 0, 5, 5, 8); }
    static NearbyResponses.Store store(String id, double distance) { return new NearbyResponses.Store(id, "합성 카페", QUERY.coordinate(), distance); }
    static List<NearbyRepository.Row> rows(int count) {
        var rows = new ArrayList<NearbyRepository.Row>();
        if (count == 0) rows.add(new NearbyRepository.Row(inventory(), 0, null));
        for (int n = 0; n < Math.min(100, count); n++) rows.add(new NearbyRepository.Row(inventory(), count, store("S%03d".formatted(n), n)));
        return rows;
    }
    static NearbyResponses.Result result(int count) {
        var repo = mock(NearbyRepository.class); when(repo.find(QUERY)).thenReturn(rows(count));
        return new NearbyService(repo).find(QUERY);
    }
    @Test void zeroIsAvailableRecordsWithUnverifiedSnapshot() {
        var r = result(0);
        assertThat(r.totalCount()).isEqualTo("0"); assertThat(r.stores()).isEmpty(); assertThat(r.listComplete()).isTrue();
        assertThat(r.data().snapshotStatus()).isEqualTo("UNVERIFIED"); assertThat(r.data().referenceDate()).isNull();
        assertThat(r.data().loadedAt()).isNull(); assertThat(r.data().quality().unclassifiedCafeCount()).isEqualTo("10");
        assertThat(r.data().sourceCategoryCode()).isEqualTo("I21201");
    }
    @Test void limitsListWithoutChangingTotal() {
        var r = result(150); assertThat(r.totalCount()).isEqualTo("150"); assertThat(r.listedCount()).isEqualTo(100);
        assertThat(r.listComplete()).isFalse(); assertThat(r.stores()).hasSize(100);
    }
    @Test void includesExactBoundaryAndPreservesNullableName() {
        var repo = mock(NearbyRepository.class);
        when(repo.find(QUERY)).thenReturn(List.of(new NearbyRepository.Row(inventory(), 1,
            new NearbyResponses.Store("S1", null, QUERY.coordinate(), 500))));
        assertThat(new NearbyService(repo).find(QUERY).stores().getFirst().distanceMeters()).isEqualTo(500);
    }
    @Test void acceptsUtf8CollationOrderForTiedUnicodeSourceIds() {
        var repo = mock(NearbyRepository.class);
        when(repo.find(QUERY)).thenReturn(List.of(new NearbyRepository.Row(inventory(), 2, store("\uE000", 0)),
            new NearbyRepository.Row(inventory(), 2, store("\uD800\uDC00", 0))));
        assertThat(new NearbyService(repo).find(QUERY).listedCount()).isEqualTo(2);
    }
    static Stream<Arguments> unavailable() {
        return Stream.of(Arguments.of(new NearbyRepository.Inventory(null, null, 1, 1, 1, 0, 0, 0, 0, 0), "CAFE_MAPPING_UNAVAILABLE"),
            Arguments.of(new NearbyRepository.Inventory(1L, null, 1, 1, 1, 0, 0, 0, 0, 0), "CAFE_MAPPING_UNAVAILABLE"),
            Arguments.of(new NearbyRepository.Inventory(1L, 2L, 1, 1, 1, 0, 0, 0, 0, 0), "CAFE_MAPPING_UNAVAILABLE"),
            Arguments.of(new NearbyRepository.Inventory(1L, 1L, 0, 0, 0, 0, 0, 0, 0, 0), "STORES_DATA_UNAVAILABLE"),
            Arguments.of(new NearbyRepository.Inventory(1L, 1L, 2, 1, 0, 1, 0, 1, 0, 1), "CAFE_DATA_UNAVAILABLE"),
            Arguments.of(new NearbyRepository.Inventory(1L, 1L, 2, 0, 0, 0, 0, 0, 0, 0), "CAFE_DATA_UNAVAILABLE"));
    }
    @ParameterizedTest @MethodSource("unavailable")
    void doesNotMisreportUnavailableAsZero(NearbyRepository.Inventory inventory, String code) {
        var repo = mock(NearbyRepository.class); when(repo.find(QUERY)).thenReturn(List.of(new NearbyRepository.Row(inventory, 0, null)));
        assertThatThrownBy(() -> new NearbyService(repo).find(QUERY)).isInstanceOf(NearbyDataUnavailableException.class)
            .satisfies(ex -> assertThat(((NearbyDataUnavailableException)ex).code()).isEqualTo(code));
    }
    static Stream<List<NearbyRepository.Row>> badRows() {
        var i = inventory();
        return Stream.of(List.of(), List.of(new NearbyRepository.Row(i, 1, null)), List.of(new NearbyRepository.Row(i, -1, null)),
            List.of(new NearbyRepository.Row(i, 1, store("x", 500.001))),
            List.of(new NearbyRepository.Row(i, 1, store("x", Double.NaN))),
            List.of(new NearbyRepository.Row(i, 1, store("", 1))),
            List.of(new NearbyRepository.Row(i, 2, store("x", 0)), new NearbyRepository.Row(i, 2, store("x", 1))),
            List.of(new NearbyRepository.Row(i, 2, store("x", 2)), new NearbyRepository.Row(i, 2, store("y", 1))),
            List.of(new NearbyRepository.Row(i, 1, new NearbyResponses.Store("x", "x", new NearbyResponses.Coordinate(91, 127), 1))),
            List.of(new NearbyRepository.Row(new NearbyRepository.Inventory(1L, 1L, 2, 2, 1, 0, 1, 0, 0, 0), 0, null)));
    }
    @ParameterizedTest @MethodSource("badRows")
    void rejectsMalformedRepositoryResults(List<NearbyRepository.Row> rows) {
        var repo = mock(NearbyRepository.class); when(repo.find(QUERY)).thenReturn(rows);
        assertThatThrownBy(() -> new NearbyService(repo).find(QUERY)).isInstanceOf(DataIntegrityException.class);
    }
}
