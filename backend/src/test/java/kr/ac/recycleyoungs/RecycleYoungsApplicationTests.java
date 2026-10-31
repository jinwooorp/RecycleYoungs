package kr.ac.recycleyoungs;

import static org.assertj.core.api.Assertions.assertThat;

import javax.sql.DataSource;
import kr.ac.recycleyoungs.region.RegionController;
import kr.ac.recycleyoungs.region.RegionRepository;
import kr.ac.recycleyoungs.region.RegionService;
import kr.ac.recycleyoungs.store.StoreStatController;
import kr.ac.recycleyoungs.store.StoreStatRepository;
import kr.ac.recycleyoungs.store.StoreStatService;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.servlet.DispatcherServlet;

/** DB 환경변수 없이도 기본 프로필의 웹 서버 기반이 시작되는지 확인한다. */
@SpringBootTest
@ActiveProfiles("default")
class RecycleYoungsApplicationTests {

  @Autowired private ApplicationContext context;

  @Test
  void startsSpringMvcWithoutDatabaseInfrastructure() {
    // 웹 서버는 구성하되 서비스 DB 접근 계층과 Flyway는 기본 실행에서 생성하지 않는다.
    assertThat(context.getBean(DispatcherServlet.class)).isNotNull();
    assertThat(context.getBeansOfType(DataSource.class)).isEmpty();
    assertThat(context.getBeansOfType(Flyway.class)).isEmpty();
    assertThat(context.getBeansOfType(JdbcClient.class)).isEmpty();
    assertThat(context.getBeansOfType(RegionController.class)).isEmpty();
    assertThat(context.getBeansOfType(RegionService.class)).isEmpty();
    assertThat(context.getBeansOfType(RegionRepository.class)).isEmpty();
    assertThat(context.getBeansOfType(StoreStatController.class)).isEmpty();
    assertThat(context.getBeansOfType(StoreStatService.class)).isEmpty();
    assertThat(context.getBeansOfType(StoreStatRepository.class)).isEmpty();
  }
}
