// 이 지도 모듈은 위치 안내 레이아웃 검사에서만 로컬 응답으로 사용합니다.
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

class MapView {
  constructor(_container, { center, level }) {
    this.center = center;
    this.level = level;
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
  }
  getBounds() {
    return {
      getSouthWest: () => new LatLng(37.56, 126.97),
      getNorthEast: () => new LatLng(37.57, 126.99),
    };
  }
  relayout() {}
}

export async function loadKakaoMaps() {
  return {
    Map: MapView,
    LatLng,
    Marker: class {
      setMap() {}
    },
    MarkerImage: class {},
    Size: class {},
    Point: class {},
    InfoWindow: class {
      close() {}
    },
    MarkerClusterer: class {
      clear() {}
    },
    event: { addListener() {}, removeListener() {} },
    services: {
      Status: { OK: 'OK' },
      Geocoder: class {
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
