package kr.ac.recycleyoungs.sales;

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
import kr.ac.recycleyoungs.sales.SalesStatResponse.SalesData;
import org.junit.jupiter.api.Test;

/** 경계 준비·현행 자치구 존재·추정매출 데이터셋 준비·조건별 미존재를 구분한다. */
class DistrictSalesStatServiceTests {

  private final RegionRepository regions = mock(RegionRepository.class);
  private final DistrictSalesStatRepository repository = mock(DistrictSalesStatRepository.class);
  private final DistrictSalesStatService service =
      new DistrictSalesStatService(regions, repository);
  private final PublishedBatch boundary =
      new PublishedBatch(new UUID(0, 1), OffsetDateTime.parse("2026-10-01T00:00:00Z"));

  @Test
  void requiresPreparedBoundaryBeforeRegionLookup() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.empty());
    expectError(ApiErrorCode.DATA_NOT_READY);
  }

  @Test
  void reportsAbsentCurrentDistrictEvenWhenSalesDatasetIsNotReady() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    expectError(ApiErrorCode.REGION_NOT_FOUND);
  }

  @Test
  void reportsUnpreparedSalesDatasetSeparatelyFromMissingStatistics() {
    currentDistrict();
    expectError(ApiErrorCode.DATA_NOT_READY);
  }

  @Test
  void keepsRequestedKeysAndNullWhenDatasetExistsButRowDoesNot() {
    currentDistrict();
    when(repository.hasPublishedData()).thenReturn(true);
    when(repository.findSales("00110", "20262", "CS100010")).thenReturn(Optional.empty());
    var response = service.getSales("00110", "20262", "CS100010");
    assertThat(response)
        .isEqualTo(new DistrictSalesStatResponse("00110", "20262", "CS100010", null));
  }

  @Test
  void keepsStatisticsPublicationIndependentOfBoundaryPublication() {
    currentDistrict();
    when(repository.hasPublishedData()).thenReturn(true);
    var data =
        new SalesData(
            null,
            "0",
            "1",
            "9223372036854775807",
            new PublishedBatch(new UUID(0, 2), OffsetDateTime.parse("2026-09-01T00:00:00Z")));
    when(repository.findSales("00110", "20262", "CS100010")).thenReturn(Optional.of(data));
    assertThat(service.getSales("00110", "20262", "CS100010").data()).isEqualTo(data);
  }

  @Test
  void retainsPresentDataWithAllNullMeasurementsAndPublication() {
    currentDistrict();
    when(repository.hasPublishedData()).thenReturn(true);
    var data = new SalesData(null, null, null, null, boundary);
    when(repository.findSales("00110", "20262", "CS100010")).thenReturn(Optional.of(data));
    var response = service.getSales("00110", "20262", "CS100010");
    assertThat(response.data()).isNotNull();
    assertThat(response.data().sourceBatch()).isEqualTo(boundary);
    assertThat(response.data().monthlySalesAmount()).isNull();
  }

  private void currentDistrict() {
    when(regions.findLatestPublishedBatch()).thenReturn(Optional.of(boundary));
    when(regions.findDistrict(boundary.batchId(), "00110"))
        .thenReturn(Optional.of(new District("00110", "예시구")));
  }

  private void expectError(ApiErrorCode code) {
    assertThatThrownBy(() -> service.getSales("00110", "20262", "CS100010"))
        .isInstanceOfSatisfying(
            ApiException.class, error -> assertThat(error.errorCode()).isEqualTo(code));
  }
}
