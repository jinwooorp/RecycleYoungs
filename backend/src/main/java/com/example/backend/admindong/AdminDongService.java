package com.example.backend.admindong;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class AdminDongService {
    private static final List<String> TREND_QUARTERS = List.of("20251", "20252", "20253", "20254");
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
        var dong = dong(lookup, query.dongCode());
        var industry = industry(lookup, query.industryCode());
        var quarter = lookup.quarters().stream().filter(q -> q.code().equals(query.quarterCode())).findFirst()
            .orElseThrow(() -> new InvalidQueryException("UNSUPPORTED_QUARTER", "지원하지 않는 분기입니다.", "quarterCode"));
        var store = repository.store(query.dongCode(), industry.sourceCode(), query.quarterCode());
        var sales = repository.sales(query.dongCode(), industry.sourceCode(), query.quarterCode());
        return new ApiResponses.Stats(dong, new ApiResponses.NamedCode(industry.code(), industry.name()), quarter,
            storeStats(store), salesStats(sales), missingReasons(store, sales));
    }

    public ApiResponses.Trend trends(QueryValidator.TrendQuery query) {
        var lookup = repository.lookup();
        var dong = dong(lookup, query.dongCode());
        var industry = industry(lookup, query.industryCode());
        var stores = repository.stores(query.dongCode(), industry.sourceCode(), TREND_QUARTERS);
        var sales = repository.salesByQuarter(query.dongCode(), industry.sourceCode(), TREND_QUARTERS);
        var quarters = TREND_QUARTERS.stream().map(code -> {
            var store = stores.get(code);
            var sale = sales.get(code);
            var quarter = new ApiResponses.Quarter(code, code.substring(0, 4) + "년 " + code.charAt(4) + "분기");
            return new ApiResponses.TrendQuarter(quarter, storeStats(store), salesStats(sale), missingReasons(store, sale));
        }).toList();
        return new ApiResponses.Trend(dong, new ApiResponses.NamedCode(industry.code(), industry.name()), quarters);
    }

    private static ApiResponses.NamedCode dong(AdminDongRepository.Lookup lookup, String code) {
        return lookup.dongs().stream().filter(d -> d.code().equals(code)).findFirst()
            .orElseThrow(() -> new InvalidQueryException("UNKNOWN_DONG", "조회 가능한 행정동이 아닙니다.", "dongCode"));
    }

    private static AdminDongRepository.Industry industry(AdminDongRepository.Lookup lookup, String code) {
        var industry = lookup.industries().stream().filter(i -> i.code().equals(code)).findFirst()
            .orElseThrow(() -> new InvalidQueryException("UNKNOWN_INDUSTRY", "등록되지 않은 내부 업종입니다.", "industryCode"));
        if (!industry.available()) {
            throw new InvalidQueryException("UNSUPPORTED_INDUSTRY", "지원하지 않는 업종입니다.", "industryCode");
        }
        return industry;
    }

    private static ApiResponses.StoreStats storeStats(AdminDongRepository.StoreRow store) {
        return store == null ? null : new ApiResponses.StoreStats(store.storeCount(), store.similarStoreCount(),
            store.openingStoreCount(), store.closingStoreCount(), store.franchiseStoreCount());
    }

    private static ApiResponses.SalesStats salesStats(AdminDongRepository.SalesRow sales) {
        return sales == null ? null : new ApiResponses.SalesStats(decimal(sales.salesAmount()),
            decimal(sales.transactionCount()), decimal(sales.weekdaySalesAmount()), decimal(sales.weekendSalesAmount()));
    }

    private static ApiResponses.MissingReasons missingReasons(AdminDongRepository.StoreRow store, AdminDongRepository.SalesRow sales) {
        return new ApiResponses.MissingReasons(store == null ? "NO_ROW" : null, sales == null ? "NO_ROW" : null);
    }

    private static String decimal(Long value) { return value == null ? null : value.toString(); }
}
