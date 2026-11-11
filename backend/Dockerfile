FROM eclipse-temurin:21-jdk-noble AS build
WORKDIR /app

COPY gradlew build.gradle settings.gradle ./
COPY gradle/wrapper ./gradle/wrapper
COPY src/main ./src/main
# 실행 가능한 Spring Boot JAR를 빌드해 런타임 이미지에 복사한다.
RUN ./gradlew --no-daemon --console=plain bootJar \
    && boot_jar="$(find build/libs -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar')" \
    && cp "$boot_jar" /app/recycleyoungs.jar

FROM eclipse-temurin:21-jre-noble
WORKDIR /app
COPY --from=build /app/recycleyoungs.jar ./recycleyoungs.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/recycleyoungs.jar"]
