// 이 지도 모듈은 실제 SDK·위치 권한이 필요 없는 로컬 브라우저 검사에 사용합니다.
let attempts = 0;
Object.defineProperty(navigator, 'geolocation', {
  configurable: true,
  value: {
    getCurrentPosition(success, failure) {
      const attempt = ++attempts;
      queueMicrotask(() => {
        if (attempt <= 2) failure({ code: attempt });
        else success({ coords: { latitude: 37.5665, longitude: 126.978 } });
      });
    },
  },
});

class LatLng {
  constructor(latitude, longitude) {
    this.latitude = latitude;
    this.longitude = longitude;
  }
  getLat() {
    return this.latitude;
  }
  getLng() {
    return this.longitude;
  }
}

class LatLngBounds {
  constructor(southWest, northEast) {
    this.southWest = southWest;
    this.northEast = northEast;
  }
  getSouthWest() {
    return this.southWest;
  }
  getNorthEast() {
    return this.northEast;
  }
}

class MapView {
  constructor(container, { center, level }) {
    this.container = container;
    this.center = center;
    this.level = level;
    container.dataset.mapLevel = String(level);
    container.addEventListener('click', () => {
      emit(this, 'click', { latLng: new LatLng(37.5665, 126.978) });
    });
  }
  getCenter() {
    return this.center;
  }
  setCenter(center) {
    this.center = center;
  }
  getLevel() {
    return this.level;
  }
  setLevel(level) {
    this.level = level;
    this.container.dataset.mapLevel = String(level);
    emit(this, 'zoom_changed');
    emit(this, 'idle');
  }
  getBounds() {
    return (
      this.bounds ??
      new LatLngBounds(new LatLng(37.56, 126.97), new LatLng(37.57, 126.99))
    );
  }
  setBounds(bounds) {
    this.bounds = bounds;
    const sw = bounds.getSouthWest(),
      ne = bounds.getNorthEast();
    this.setCenter(
      new LatLng(
        (sw.getLat() + ne.getLat()) / 2,
        (sw.getLng() + ne.getLng()) / 2,
      ),
    );
    emit(this, 'idle');
  }
  relayout() {}
}

const listeners = new WeakMap();
function emit(target, event, data) {
  for (const callback of listeners.get(target)?.get(event) ?? [])
    callback(data);
}

export async function loadKakaoMaps() {
  return {
    Map: MapView,
    LatLng,
    LatLngBounds,
    Marker: class {
      setMap() {}
      setZIndex() {}
    },
    Circle: class {
      setMap() {}
    },
    Polygon: class {
      setMap() {}
    },
    MarkerImage: class {},
    Size: class {},
    Point: class {},
    InfoWindow: class {
      close() {}
    },
    MarkerClusterer: class {
      constructor({ map }) {
        this.container = map.container;
        this.markers = new Set();
      }
      addMarkers(markers) {
        for (const marker of markers) this.markers.add(marker);
      }
      removeMarkers(markers) {
        for (const marker of markers) this.markers.delete(marker);
      }
      redraw() {
        this.container.dataset.markerCount = String(this.markers.size);
      }
      clear() {
        this.markers.clear();
        this.redraw();
      }
    },
    event: {
      addListener(target, event, callback) {
        if (!listeners.has(target)) listeners.set(target, new Map());
        const events = listeners.get(target);
        if (!events.has(event)) events.set(event, new Set());
        events.get(event).add(callback);
      },
      removeListener(target, event, callback) {
        listeners.get(target)?.get(event)?.delete(callback);
      },
    },
    services: {
      Status: { OK: 'OK' },
      Geocoder: class {
        coord2Address(_longitude, _latitude, callback) {
          callback([], 'ZERO_RESULT');
        }
        coord2RegionCode(_longitude, _latitude, callback) {
          callback(
            [{ region_type: 'H', region_1depth_name: '서울특별시' }],
            'OK',
          );
        }
      },
    },
  };
}
