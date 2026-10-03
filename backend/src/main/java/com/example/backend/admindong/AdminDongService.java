package com.example.backend.admindong;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class AdminDongService {
    private final AdminDongRepository repository;
    public AdminDongService(AdminDongRepository repository) { this.repository = repository; }

    public List<ApiResponses.NamedCode> dongs() { return repository.lookup().dongs(); }
    public List<ApiResponses.NamedCode> industries() {
        return repository.lookup().industries().stream().filter(AdminDongRepository.Industry::available)
            .map(i -> new ApiResponses.NamedCode(i.code(), i.name())).toList();
    }
    public List<ApiResponses.Quarter> quarters() { return repository.lookup().quarters(); }
    public ApiResponses.Stats stats(QueryValidator.StatsQuery query) {
        var lookup = repository.lookup();
        var dong = lookup.dongs().stream().filter(d -> d.code().equals(query.dongCode())).findFirst()
            .orElseThrow(() -> new InvalidQueryException("UNKNOWN_DONG", "조회 가능한 행정동이 아닙니다.", "dongCode"));
        var industry = lookup.industries().stream().filter(i -> i.code().equals(query.industryCode())).findFirst()
            .orElseThrow(() -> new InvalidQueryException("UNKNOWN_INDUSTRY", "등록되지 않은 내부 업종입니다.", "industryCode"));
        if (!industry.available()) {
            throw new InvalidQueryException("UNSUPPORTED_INDUSTRY", "지원하지 않는 업종입니다.", "industryCode");
        }
        var quarter = lookup.quarters().stream().filter(q -> q.code().equals(query.quarterCode())).findFirst()
            .orElseThrow(() -> new InvalidQueryException("UNSUPPORTED_QUARTER", "지원하지 않는 분기입니다.", "quarterCode"));
        var store = repository.store(query.dongCode(), industry.sourceCode(), query.quarterCode());
        var sales = repository.sales(query.dongCode(), industry.sourceCode(), query.quarterCode());
        var storeStats = store == null ? null : new ApiResponses.StoreStats(store.storeCount(), store.similarStoreCount(),
            store.openingStoreCount(), store.closingStoreCount(), store.franchiseStoreCount());
        var salesStats = sales == null ? null : new ApiResponses.SalesStats(decimal(sales.salesAmount()),
            decimal(sales.transactionCount()), decimal(sales.weekdaySalesAmount()), decimal(sales.weekendSalesAmount()));
        return new ApiResponses.Stats(dong, new ApiResponses.NamedCode(industry.code(), industry.name()), quarter,
            storeStats, salesStats, new ApiResponses.MissingReasons(store == null ? "NO_ROW" : null, sales == null ? "NO_ROW" : null));
    }

    private static String decimal(Long value) { return value == null ? null : value.toString(); }

}
