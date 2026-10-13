package com.example.backend.nearby;

import com.example.backend.admindong.DataIntegrityException;
import java.util.HashSet;
import org.springframework.stereotype.Service;

@Service
public class NearbyService {
    private final NearbyRepository repository;
    public NearbyService(NearbyRepository repository) { this.repository = repository; }

    public NearbyResponses.Result find(NearbyResponses.Query query) {
        var rows = repository.find(query);
        if (rows.isEmpty()) throw new DataIntegrityException();
        var i = rows.getFirst().inventory();
        if (i.cafeId() == null || i.mappedId() == null || !i.cafeId().equals(i.mappedId()))
            throw new NearbyDataUnavailableException("CAFE_MAPPING_UNAVAILABLE");
        if (i.totalStores() == 0) throw new NearbyDataUnavailableException("STORES_DATA_UNAVAILABLE");
        if (i.conflicting() != 0) throw new DataIntegrityException();
        if (i.usableCafes() == 0) throw new NearbyDataUnavailableException("CAFE_DATA_UNAVAILABLE");
        long count = rows.getFirst().totalCount();
        if (count < 0 || count > i.usableCafes() || i.usableCafes() > i.cafeSources() || i.cafeSources() > i.totalStores()
            || i.unclassified() < 0 || i.missingLocation() < 0 || i.invalidLocation() < 0 || i.incompleteSourceCoordinates() < 0)
            throw new DataIntegrityException();
        for (var row : rows) {
            if (!i.equals(row.inventory()) || count != row.totalCount()) throw new DataIntegrityException();
        }
        var stores = rows.stream().map(NearbyRepository.Row::store).filter(java.util.Objects::nonNull).toList();
        if (stores.size() != Math.min(count, NearbyRepository.LIST_LIMIT) || (count == 0 && rows.size() != 1))
            throw new DataIntegrityException();
        var ids = new HashSet<String>();
        double previous = -1;
        String previousId = "";
        for (var store : stores) {
            double distance = store.distanceMeters();
            var c = store.coordinate();
            if (store.sourceStoreId() == null || store.sourceStoreId().isBlank() || !ids.add(store.sourceStoreId())
                || !Double.isFinite(distance) || distance < 0 || distance > query.radius()
                || !Double.isFinite(c.lat()) || Math.abs(c.lat()) > 90 || !Double.isFinite(c.lng()) || Math.abs(c.lng()) > 180
                || distance < previous || (distance == previous && java.util.Arrays.compareUnsigned(
                    store.sourceStoreId().getBytes(java.nio.charset.StandardCharsets.UTF_8),
                    previousId.getBytes(java.nio.charset.StandardCharsets.UTF_8)) < 0))
                throw new DataIntegrityException();
            previous = distance; previousId = store.sourceStoreId();
        }
        var quality = new NearbyResponses.Quality(Long.toString(i.totalStores()), Long.toString(i.cafeSources()),
            Long.toString(i.usableCafes()), Long.toString(i.unclassified()), Long.toString(i.missingLocation()),
            Long.toString(i.invalidLocation()), Long.toString(i.incompleteSourceCoordinates()));
        return new NearbyResponses.Result(query.coordinate(), query.industryCode(), query.radius(), Long.toString(count),
            stores.size(), NearbyRepository.LIST_LIMIT, count == stores.size(), stores,
            new NearbyResponses.Data("SEMAS", "I21201", "AVAILABLE_RECORDS", "UNVERIFIED", null, null, quality));
    }
}
