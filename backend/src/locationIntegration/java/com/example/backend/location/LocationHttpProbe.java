package com.example.backend.location;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

/** HTTP bridge for Chrome: runs only inside the already verified isolated runner. */
public final class LocationHttpProbe {
    public static void main(String[] args) throws Exception {
        if (args.length != 1 || !args[0].startsWith("/api/") || args[0].contains("#") || args[0].contains("\n")) {
            throw new IllegalArgumentException("Only local API paths are permitted");
        }
        var response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(
            URI.create("http://127.0.0.1:8080" + args[0])).GET().build(), HttpResponse.BodyHandlers.ofString());
        System.out.println(response.statusCode());
        System.out.println(response.body());
    }
}
