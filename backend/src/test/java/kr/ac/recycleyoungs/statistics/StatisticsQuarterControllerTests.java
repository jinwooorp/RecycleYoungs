package kr.ac.recycleyoungs.statistics;

import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(StatisticsQuarterController.class)
@ActiveProfiles("db")
class StatisticsQuarterControllerTests {

  @Autowired private MockMvc mvc;
  @MockitoBean private StatisticsQuarterService service;

  @Test
  void serializesAnExplicitNullDefaultForAnEmptyCatalog() throws Exception {
    when(service.getQuarters())
        .thenReturn(new StatisticsQuarterResponse("CS100010", null, List.of()));
    mvc.perform(get("/api/v1/statistics/quarters"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.industryCode").value("CS100010"))
        .andExpect(jsonPath("$.defaultQuarterCode").value(nullValue()))
        .andExpect(jsonPath("$.quarters").isEmpty());
  }

  @Test
  void keepsTheDataNotReadyProblemContract() throws Exception {
    when(service.getQuarters()).thenThrow(new ApiException(ApiErrorCode.DATA_NOT_READY));
    mvc.perform(get("/api/v1/statistics/quarters"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }
}
