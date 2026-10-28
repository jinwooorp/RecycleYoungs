package kr.ac.recycleyoungs;

import static org.assertj.core.api.Assertions.assertThat;

import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.web.servlet.DispatcherServlet;

@SpringBootTest
class RecycleYoungsApplicationTests {

  @Autowired private ApplicationContext context;

  @Test
  void startsSpringMvcWithoutDatabaseInfrastructure() {
    assertThat(context.getBean(DispatcherServlet.class)).isNotNull();
    assertThat(context.getBeansOfType(DataSource.class)).isEmpty();
    assertThat(context.getBeansOfType(Flyway.class)).isEmpty();
  }
}
