package kr.ac.recycleyoungs.foottraffic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.foottraffic.FootTrafficStatResponse.FootTrafficData;
import kr.ac.recycleyoungs.region.RegionRepository;
import kr.ac.recycleyoungs.region.RegionResponse.District;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.junit.jupiter.api.Test;

/** 경계 준비·현행 자치구 존재·유동인구 데이터셋 준비·조건별 미존재를 구분한다. */
class DistrictFootTrafficStatServiceTests {

  private final RegionRepository regions = mock(RegionRepository.class);
  private final DistrictFootTrafficStatRepository repository =
      mock(DistrictFootTrafficStatRepository.class);
  private final DistrictFootTrafficStatService service =
      new DistrictFootTrafficStatService(regions, repository);
  private final PublishedBatch boundary =
      new PublishedBatch(new UUID(0, 1), OffsetDateTime.parse("2026-10-01T00:00:00Z"));

  @Test
  void requiresPreparedBoundaryBeforeRegionLookup() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.empty());
    expectError(ApiErrorCode.DATA_NOT_READY);
  }

  @Test
  void reportsAbsentCurrentDistrictEvenWhenFootTrafficDatasetIsNotReady() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    expectError(ApiErrorCode.REGION_NOT_FOUND);
  }

  @Test
  void reportsUnpreparedFootTrafficDatasetSeparatelyFromMissingStatistics() {
    currentDistrict();
    expectError(ApiErrorCode.DATA_NOT_READY);
  }

  @Test
  void keepsRequestedKeysAndNullWhenDatasetExistsButRowDoesNot() {
    currentDistrict();
    when(repository.hasPublishedData()).thenReturn(true);
    when(repository.findFootTraffic("00110", "20262")).thenReturn(Optional.empty());
    var response = service.getFootTraffic("00110", "20262");
    assertThat(response).isEqualTo(new DistrictFootTrafficStatResponse("00110", "20262", null));
  }

  @Test
  void keepsStatisticsPublicationIndependentOfBoundaryPublication() {
    currentDistrict();
    when(repository.hasPublishedData()).thenReturn(true);
    var data =
        new FootTrafficData(
            null,
            "0",
            "1.200",
            new PublishedBatch(new UUID(0, 2), OffsetDateTime.parse("2026-09-01T00:00:00Z")));
    when(repository.findFootTraffic("00110", "20262")).thenReturn(Optional.of(data));
    assertThat(service.getFootTraffic("00110", "20262").data()).isEqualTo(data);
  }

  @Test
  void preservesPresentRowWithAllNullMeasurementsAndItsSource() {
    currentDistrict();
    when(repository.hasPublishedData()).thenReturn(true);
    var data = new FootTrafficData(null, null, null, boundary);
    when(repository.findFootTraffic("00110", "20262")).thenReturn(Optional.of(data));
    var response = service.getFootTraffic("00110", "20262");
    assertThat(response.data()).isEqualTo(data);
    assertThat(response.data().sourceBatch()).isEqualTo(boundary);
  }

  private void currentDistrict() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    when(regions.findDistrict(boundary.batchId(), "00110"))
        .thenReturn(Optional.of(new District("00110", "예시구")));
  }

  private void expectError(ApiErrorCode code) {
    assertThatThrownBy(() -> service.getFootTraffic("00110", "20262"))
        .isInstanceOfSatisfying(
            ApiException.class, error -> assertThat(error.errorCode()).isEqualTo(code));
  }
}
