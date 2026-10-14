package com.example.backend;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.models.media.ComposedSchema;
import io.swagger.v3.oas.models.media.Schema;
import java.util.List;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@OpenAPIDefinition(info = @Info(title = "RecycleYoungs API", version = "1",
    description = "서울시 분기 통계와 SEMAS 점포·공식 경계 조회 API. 창업 성공·수익을 예측하지 않습니다. "
        + "통계 분기와 점포 snapshot의 시점은 다르며 원천 기준일은 UNVERIFIED, 역사적 경계 호환성은 UNRESOLVED입니다. "
        + "모든 query는 정확히 한 번 전달하며 미정의·중복·누락·빈 값은 400입니다. 인증은 현재 미구현입니다."))
public class OpenApiConfig {
    @Bean
    OpenApiCustomizer nullableResponseObjects() {
        return document -> {
            var schemas = document.getComponents().getSchemas();
            for (var name : List.of("Stats", "TrendQuarter", "AdminDongResult")) {
                Schema<?> schema = schemas.get(name);
                if (schema == null || schema.getProperties() == null) continue;
                schema.getProperties().replaceAll((field, property) -> {
                    if (property.get$ref() == null || property.getTypes() == null
                        || !property.getTypes().contains("null")) return property;
                    // In OAS 3.1 a $ref is still enforced alongside type=[object,null].
                    // Use a union so the actual API's NO_ROW/ambiguous null is valid.
                    return new ComposedSchema().addAnyOfItem(new Schema<>().$ref(property.get$ref()))
                        .addAnyOfItem(new Schema<>().types(Set.of("null"))).description(property.getDescription());
                });
            }
        };
    }
}
