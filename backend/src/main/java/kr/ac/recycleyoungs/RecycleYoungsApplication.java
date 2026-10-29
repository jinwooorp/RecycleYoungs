package kr.ac.recycleyoungs;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** 서비스 API 구현에 앞서 Spring MVC 서버와 선택적 DB 마이그레이션을 구동하는 진입점. */
@SpringBootApplication
public class RecycleYoungsApplication {

  /** 활성 프로필에 따라 기본 웹 서버 또는 DB 마이그레이션을 포함한 서버를 시작한다. */
  public static void main(String[] args) {
    SpringApplication.run(RecycleYoungsApplication.class, args);
  }
}
