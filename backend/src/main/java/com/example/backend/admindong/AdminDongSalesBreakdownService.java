package com.example.backend.admindong;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

@Service
@Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
public class AdminDongSalesBreakdownService {
    private final AdminDongRepository lookup;
    private final AdminDongSalesBreakdownRepository repository;
    public AdminDongSalesBreakdownService(AdminDongRepository lookup,AdminDongSalesBreakdownRepository repository) {
        this.lookup=lookup; this.repository=repository;
    }
    public ContextResponses.Breakdown breakdown(QueryValidator.StatsQuery query) {
        var selected=ContextSelection.select(lookup.lookup(),query,true);
        var metadata=lookup.requireVersion(query.dataVersion());
        var rows=repository.rows(query.dongCode(),selected.industry().sourceCode(),query.quarterCode());
        if (rows.size()>1) throw new DataIntegrityException();
        ContextResponses.Sales sales=rows.isEmpty()?null:project(rows.getFirst());
        return new ContextResponses.Breakdown(selected.dong(),new ApiResponses.NamedCode("CAFE",selected.industry().name()),
            selected.quarter(),sales,rows.isEmpty()?"NO_ROW":null,metadata);
    }
    static ContextResponses.Sales project(JsonNode row) {
        return new ContextResponses.Sales(new ContextResponses.Totals(value(row,"sales_amount"),value(row,"transaction_count")),
            List.of(item(row,"MDWK","weekday_sales_amount","weekday_transactions"),item(row,"WKEND","weekend_sales_amount","weekend_transactions")),
            group(row,List.of("MON","TUES","WED","THUR","FRI","SAT","SUN"),List.of("mon","tue","wed","thu","fri","sat","sun"),"_sales_amount","_transactions"),
            group(row,List.of("00_06","06_11","11_14","14_17","17_21","21_24"),List.of("time_00_06","time_06_11","time_11_14","time_14_17","time_17_21","time_21_24"),"_sales","_transactions"),
            group(row,List.of("ML","FML"),List.of("male","female"),"_sales","_transactions"),
            group(row,List.of("10","20","30","40","50","60_ABOVE"),List.of("age_10","age_20","age_30","age_40","age_50","age_60_plus"),"_sales","_transactions"));
    }
    private static List<ContextResponses.SalesItem> group(JsonNode row,List<String> codes,List<String> fields,String amount,String count) {
        return java.util.stream.IntStream.range(0,codes.size()).mapToObj(i->item(row,codes.get(i),fields.get(i)+amount,fields.get(i)+count)).toList();
    }
    private static ContextResponses.SalesItem item(JsonNode row,String code,String amount,String count) {
        return new ContextResponses.SalesItem(code,value(row,amount),value(row,count));
    }
    private static String value(JsonNode row,String field) {
        if (!row.has(field)) throw new DataIntegrityException();
        var node=row.path(field);
        if (node.isNull()) return null;
        String value=node.asText();
        if (!node.isIntegralNumber() || !value.matches("0|[1-9][0-9]*")
            || new java.math.BigInteger(value).compareTo(java.math.BigInteger.valueOf(Long.MAX_VALUE))>0) throw new DataIntegrityException();
        return value;
    }
}
