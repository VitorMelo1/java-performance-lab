FROM maven@sha256:3a4ab3276a087bf276f79cae96b1af04f53731bec53fb2e651aca79e4b10211e AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q verify
FROM eclipse-temurin@sha256:9603446cf51296842eab342514857cf7ab55a8891cd564e6c68ec237fae65a16
WORKDIR /app
RUN useradd --system --uid 10001 app
COPY --from=build /build/target/app.jar app.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]

