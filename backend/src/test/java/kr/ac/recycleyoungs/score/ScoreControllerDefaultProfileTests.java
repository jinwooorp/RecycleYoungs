package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/** 기본 프로필에는 점수 경로·DB 계층을 만들지 않으며 지역 미존재 오류와도 구분한다. */
@WebMvcTest(ScoreController.class)
@ActiveProfiles("default")
class ScoreControllerDefaultProfileTests {
  @Autowired private MockMvc mvc;
  @Autowired private ApplicationContext context;

  @Test
  void requiresNeitherTheScoreControllerNorDatabaseInfrastructure() {
    assertThat(context.getBeansOfType(ScoreController.class)).isEmpty();
    assertThat(context.getBeansOfType(ScoreService.class)).isEmpty();
    assertThat(context.getBeansOfType(ScoreInputRepository.class)).isEmpty();
    assertThat(context.getBeansOfType(DataSource.class)).isEmpty();
  }

  @ParameterizedTest
  @ValueSource(strings = {"/api/v1/districts/00001/score", "/api/v1/dongs/00001001/score"})
  void leavesScorePathsUnregisteredOutsideTheDbProfile(String path) throws Exception {
    mvc.perform(get(path).param("quarterCode", "20262").param("industryCode", "CS100010"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").doesNotExist());
  }
}
