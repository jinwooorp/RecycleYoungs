FROM eclipse-temurin:21-jdk-noble AS build
WORKDIR /app

COPY gradlew build.gradle settings.gradle ./
COPY gradle/wrapper/ gradle/wrapper/
COPY src/main/ src/main/
RUN ./gradlew --no-daemon bootJar

FROM eclipse-temurin:21-jre-noble
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar
USER 10001:10001
ENTRYPOINT ["java", "-jar", "app.jar"]
