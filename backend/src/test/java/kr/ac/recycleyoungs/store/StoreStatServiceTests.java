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
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import kr.ac.recycleyoungs.store.StoreStatResponse.StoreData;
import org.junit.jupiter.api.Test;

/** 경계 준비·현행 행정동 존재·점포 데이터셋 준비·조건별 미존재를 구분한다. */
class StoreStatServiceTests {

  private final RegionRepository regions = mock(RegionRepository.class);
  private final StoreStatRepository repository = mock(StoreStatRepository.class);
  private final StoreStatService service = new StoreStatService(regions, repository);
  private final PublishedBatch boundary =
      new PublishedBatch(new UUID(0, 1), OffsetDateTime.parse("2026-10-01T00:00:00Z"));

  @Test
  void requiresPreparedBoundaryBeforeRegionLookup() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.empty());
    expectError(ApiErrorCode.DATA_NOT_READY);
  }

  @Test
  void reportsAbsentCurrentDongEvenWhenStoreDatasetIsNotReady() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    expectError(ApiErrorCode.REGION_NOT_FOUND);
  }

  @Test
  void reportsUnpreparedStoreDatasetSeparatelyFromMissingStatistics() {
    currentDong();
    expectError(ApiErrorCode.DATA_NOT_READY);
  }

  @Test
  void keepsRequestedKeysAndNullWhenDatasetExistsButRowDoesNot() {
    currentDong();
    when(repository.hasPublishedData()).thenReturn(true);
    when(repository.findStores("00110001", "20262", "CS100010")).thenReturn(Optional.empty());
    var response = service.getStores("00110001", "20262", "CS100010");
    assertThat(response).isEqualTo(new StoreStatResponse("00110001", "20262", "CS100010", null));
  }

  @Test
  void keepsStatisticsPublicationIndependentOfBoundaryPublication() {
    currentDong();
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
    when(repository.findStores("00110001", "20262", "CS100010")).thenReturn(Optional.of(data));
    assertThat(service.getStores("00110001", "20262", "CS100010").data()).isEqualTo(data);
  }

  private void currentDong() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    when(regions.existsDong(boundary.batchId(), "00110001")).thenReturn(true);
  }

  private void expectError(ApiErrorCode code) {
    assertThatThrownBy(() -> service.getStores("00110001", "20262", "CS100010"))
        .isInstanceOfSatisfying(
            ApiException.class, error -> assertThat(error.errorCode()).isEqualTo(code));
  }
}
