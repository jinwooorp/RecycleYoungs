package kr.ac.recycleyoungs.region;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.region.RegionResponse.District;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

/** 배치 준비 상태와 지역 존재 여부를 구분하는 서비스 계약을 검증한다. */
class RegionServiceTests {

  private final RegionRepository repository = mock(RegionRepository.class);
  private final RegionService service = new RegionService(repository, JsonMapper.builder().build());
  private final PublishedBatch batch =
      new PublishedBatch(new UUID(0, 2), OffsetDateTime.parse("2026-10-02T00:00:00Z"));

  @ParameterizedTest
  @ValueSource(strings = {"districts", "dongs", "districtBoundary", "dongBoundary", "nearby"})
  void reportsDataNotReadyBeforeLookingForRegion(String operation) {
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.empty());
    assertThatThrownBy(() -> query(operation))
        .isInstanceOfSatisfying(
            ApiException.class,
            exception -> assertThat(exception.errorCode()).isEqualTo(ApiErrorCode.DATA_NOT_READY));
  }

  @ParameterizedTest
  @ValueSource(strings = {"dongs", "districtBoundary", "dongBoundary"})
  void reportsMissingRegionWithinCurrentPublication(String operation) {
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.of(batch));
    assertThatThrownBy(() -> query(operation))
        .isInstanceOfSatisfying(
            ApiException.class,
            exception ->
                assertThat(exception.errorCode()).isEqualTo(ApiErrorCode.REGION_NOT_FOUND));
  }

  @Test
  void returnsEmptyDongsForExistingCurrentDistrict() {
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.of(batch));
    when(repository.findDistrict(batch.batchId(), "11110"))
        .thenReturn(Optional.of(new District("11110", "테스트구")));
    when(repository.findDongs(batch.batchId(), "11110")).thenReturn(List.of());
    assertThat(service.getDongs("11110").items()).isEmpty();
  }

  @Test
  void wrapsPostgisGeometryAsObjectAndIncludesPublication() {
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.of(batch));
    when(repository.findDongBoundary(batch.batchId(), "11110001"))
        .thenReturn(
            Optional.of(
                new RegionRepository.BoundaryRow(
                    "11110001",
                    "테스트동",
                    "11110",
                    "{\"type\":\"MultiPolygon\",\"coordinates\":[[[[127,37],[128,37],[128,38],[127,37]]]]}")));
    var response = service.getDongBoundary("11110001");
    assertThat(response.type()).isEqualTo("Feature");
    assertThat(response.id()).isEqualTo("11110001");
    assertThat(response.geometry().isObject()).isTrue();
    assertThat(response.geometry().get("type").asString()).isEqualTo("MultiPolygon");
    assertThat(response.properties().districtCode()).isEqualTo("11110");
    assertThat(response.properties().boundaryBatch()).isEqualTo(batch);
  }

  @Test
  void rejectsMissingSelectedDistrictBeforeSpatialQueries() {
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.of(batch));
    when(repository.findDistricts(batch.batchId()))
        .thenReturn(List.of(new District("11110", "테스트구")));
    assertThatThrownBy(() -> service.getNearby(127, 37, 500, List.of("11110", "99999")))
        .isInstanceOfSatisfying(
            ApiException.class,
            exception ->
                assertThat(exception.errorCode()).isEqualTo(ApiErrorCode.REGION_NOT_FOUND));
  }

  @Test
  void includesPublicationEvenForSpatiallyEmptyResult() {
    when(repository.findLatestPublishedBatch()).thenReturn(Optional.of(batch));
    var response = service.getNearby(139.7, 35.7, 500, List.of());
    assertThat(response.boundaryBatch()).isEqualTo(batch);
    assertThat(response.districts()).isEmpty();
    assertThat(response.dongs()).isEmpty();
  }

  private Object query(String operation) {
    return switch (operation) {
      case "districts" -> service.getDistricts();
      case "dongs" -> service.getDongs("11110");
      case "districtBoundary" -> service.getDistrictBoundary("11110");
      case "nearby" -> service.getNearby(127, 37, 500, List.of());
      default -> service.getDongBoundary("11110001");
    };
  }
}
