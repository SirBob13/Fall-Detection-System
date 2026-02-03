// src/services/location.service.ts
import * as Location from 'expo-location';
import { Platform, Alert } from 'react-native';

export class LocationService {
  private static instance: LocationService;
  private locationSubscription: any = null;
  private lastLocation: any = null;

  static getInstance(): LocationService {
    if (!LocationService.instance) {
      LocationService.instance = new LocationService();
    }
    return LocationService.instance;
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Location permission is needed for emergency features',
          [{ text: 'OK' }]
        );
        return false;
      }
      
      if (Platform.OS === 'android') {
        const backgroundStatus = await Location.requestBackgroundPermissionsAsync();
        return backgroundStatus.status === 'granted';
      }
      
      return true;
    } catch (error) {
      console.error('Location permission error:', error);
      return false;
    }
  }

  async getCurrentLocation(): Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;
  } | null> {
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) return null;

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeout: 15000,
      });

      this.lastLocation = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        timestamp: Date.now(),
      };

      return this.lastLocation;
    } catch (error) {
      console.error('Get location error:', error);
      return null;
    }
  }

  startLocationTracking(
    onLocationUpdate: (location: any) => void,
    interval: number = 5000
  ) {
    this.requestPermissions().then(hasPermission => {
      if (!hasPermission) return;

      this.locationSubscription = Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: interval,
          distanceInterval: 10,
        },
        (location) => {
          const locData = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
            speed: location.coords.speed,
            timestamp: Date.now(),
          };
          
          this.lastLocation = locData;
          onLocationUpdate(locData);
        }
      );
    });
  }

  stopLocationTracking() {
    if (this.locationSubscription) {
      this.locationSubscription.remove();
      this.locationSubscription = null;
    }
  }

  getLastLocation() {
    return this.lastLocation;
  }

  async geocodeAddress(address: string) {
    try {
      const results = await Location.geocodeAsync(address);
      return results[0];
    } catch (error) {
      console.error('Geocode error:', error);
      return null;
    }
  }

  async reverseGeocode(lat: number, lng: number) {
    try {
      const results = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });
      return results[0];
    } catch (error) {
      console.error('Reverse geocode error:', error);
      return null;
    }
  }
}

export const locationService = LocationService.getInstance();