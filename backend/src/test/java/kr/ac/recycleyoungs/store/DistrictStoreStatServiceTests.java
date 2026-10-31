package kr.ac.recycleyoungs.store;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.region.RegionRepository;
import kr.ac.recycleyoungs.region.RegionResponse.District;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import kr.ac.recycleyoungs.store.StoreStatResponse.StoreData;
import org.junit.jupiter.api.Test;

/** 경계 준비·현행 자치구 존재·점포 데이터셋 준비·조건별 미존재를 구분한다. */
class DistrictStoreStatServiceTests {

  private final RegionRepository regions = mock(RegionRepository.class);
  private final DistrictStoreStatRepository repository = mock(DistrictStoreStatRepository.class);
  private final DistrictStoreStatService service =
      new DistrictStoreStatService(regions, repository);
  private final PublishedBatch boundary =
      new PublishedBatch(new UUID(0, 1), OffsetDateTime.parse("2026-10-01T00:00:00Z"));

  @Test
  void requiresPreparedBoundaryBeforeRegionLookup() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.empty());
    expectError(ApiErrorCode.DATA_NOT_READY);
  }

  @Test
  void reportsAbsentCurrentDistrictEvenWhenStoreDatasetIsNotReady() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    expectError(ApiErrorCode.REGION_NOT_FOUND);
  }

  @Test
  void reportsUnpreparedStoreDatasetSeparatelyFromMissingStatistics() {
    currentDistrict();
    expectError(ApiErrorCode.DATA_NOT_READY);
  }

  @Test
  void keepsRequestedKeysAndNullWhenDatasetExistsButRowDoesNot() {
    currentDistrict();
    when(repository.hasPublishedData()).thenReturn(true);
    when(repository.findStores("00110", "20262", "CS100010")).thenReturn(Optional.empty());
    var response = service.getStores("00110", "20262", "CS100010");
    assertThat(response)
        .isEqualTo(new DistrictStoreStatResponse("00110", "20262", "CS100010", null));
  }

  @Test
  void keepsStatisticsPublicationIndependentOfBoundaryPublication() {
    currentDistrict();
    when(repository.hasPublishedData()).thenReturn(true);
    var data =
        new StoreData(
            null,
            "0",
            "1",
            "2",
            "3",
            "123.00001",
            null,
            new PublishedBatch(new UUID(0, 2), OffsetDateTime.parse("2026-09-01T00:00:00Z")));
    when(repository.findStores("00110", "20262", "CS100010")).thenReturn(Optional.of(data));
    assertThat(service.getStores("00110", "20262", "CS100010").data()).isEqualTo(data);
  }

  private void currentDistrict() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    when(regions.findDistrict(boundary.batchId(), "00110"))
        .thenReturn(Optional.of(new District("00110", "예시구")));
  }

  private void expectError(ApiErrorCode code) {
    assertThatThrownBy(() -> service.getStores("00110", "20262", "CS100010"))
        .isInstanceOfSatisfying(
            ApiException.class, error -> assertThat(error.errorCode()).isEqualTo(code));
  }
}
