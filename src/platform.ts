/*
 * Based on homebridge-unifi-occupancy by DouweM
 * Original: https://github.com/DouweM/homebridge-unifi-occupancy
 * Licensed under Apache-2.0
 * 
 * Modified for homebridge-unifi-occupancy-lite - simplified, resident-based presence detection
 */

import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { UniFiLiteClient } from './unifi-client';
import { Resident, WifiPoint, ResidentConfig, WifiPointConfig, Device } from './resident';
import { GlobalPresenceAccessoryHandler } from './global_presence_accessory_handler';
import { WifiPointAccessoryHandler } from './wifi_point_accessory_handler';

export class UnifiOccupancyPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  private unifi!: UniFiLiteClient;
  private residents: Resident[] = [];
  private wifiPoints: WifiPoint[] = [];
  private accessories: Map<string, PlatformAccessory> = new Map();
  private globalPresenceHandler?: GlobalPresenceAccessoryHandler;
  private wifiPointHandlers: Map<string, WifiPointAccessoryHandler> = new Map();

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    if (!this.parseConfig()) {
      return;
    }

    this.api.on('didFinishLaunching', () => {
      this.connect();
      this.setupAccessories();
      this.refresh()
        .then(() => this.refreshPeriodically())
        .catch(error => {
          this.log.error('Failed to initialize:', error);
        });
    });
  }

  parseConfig(): boolean {
    if (!this.config.unifi) {
      this.log.error('ERROR: UniFi Controller is not configured.');
      return false;
    }

    if (!this.config.unifi.apiKey) {
      this.log.error('ERROR: UniFi API Key is required.');
      return false;
    }

    if (this.config.unifi.useSiteManagerApi && !this.config.unifi.hostId) {
      this.log.error('ERROR: Host ID is required when using Site Manager API.');
      return false;
    }

    // Set defaults
    this.config.interval ||= 180;
    this.config.globalPresenceSensor ??= true;
    this.config.residents ||= [];
    this.config.wifiPoints ||= [];

    // Initialize residents
    this.residents = this.config.residents.map((residentConfig: ResidentConfig) => 
      new Resident(residentConfig)
    );

    // Initialize wifi points
    this.wifiPoints = this.config.wifiPoints.map((wifiPointConfig: WifiPointConfig) => 
      new WifiPoint(wifiPointConfig)
    );

    this.log.info(`Configured ${this.residents.length} residents with ${this.residents.reduce((sum, r) => sum + r.devices.length, 0)} total devices`);
    this.log.info(`Configured ${this.wifiPoints.length} WiFi points`);

    return true;
  }

  connect() {
    this.log.debug('Connecting to UniFi Controller...');
    
    this.unifi = new UniFiLiteClient({
      controller: this.config.unifi.controller,
      apiKey: this.config.unifi.apiKey,
      site: this.config.unifi.site || 'default',
      secure: this.config.unifi.secure || false,
      useSiteManagerApi: this.config.unifi.useSiteManagerApi || false,
      hostId: this.config.unifi.hostId
    });

    this.log.info('UniFi API Client initialized');
  }

  setupAccessories() {
    // Setup global presence sensor
    if (this.config.globalPresenceSensor) {
      this.setupGlobalPresenceAccessory();
    }

    // Setup WiFi point accessories
    this.wifiPoints.forEach(wifiPoint => {
      this.setupWifiPointAccessory(wifiPoint);
    });
  }

  private setupGlobalPresenceAccessory() {
    const uuid = this.api.hap.uuid.generate('global-presence');
    let accessory = this.accessories.get(uuid);

    if (!accessory) {
      accessory = new this.api.platformAccessory('Global Presence', uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
      this.log.info('Created new global presence accessory');
    }

    this.globalPresenceHandler = new GlobalPresenceAccessoryHandler(
      this, accessory, this.residents
    );
  }

  private setupWifiPointAccessory(wifiPoint: WifiPoint) {
    const uuid = this.api.hap.uuid.generate(`wifi-point-${wifiPoint.name}`);
    let accessory = this.accessories.get(uuid);

    if (!accessory) {
      accessory = new this.api.platformAccessory(`${wifiPoint.name} Presence`, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
      this.log.info(`Created new wifi point accessory: ${wifiPoint.name}`);
    }

    const handler = new WifiPointAccessoryHandler(
      this, accessory, wifiPoint, this.residents
    );
    this.wifiPointHandlers.set(wifiPoint.name, handler);
  }

  refreshPeriodically() {
    setInterval(() => this.refresh(), this.config.interval * 1000);
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.accessories.set(accessory.UUID, accessory);
  }

  async refresh() {
    try {
      this.log.debug('Refreshing device presence...');
      
      // Get clients from UniFi
      const clients = await this.unifi.getClients();
      const accessPoints = await this.unifi.getNetworkDevices();
      
      // Update device status for each resident
      for (const resident of this.residents) {
        for (const device of resident.devices) {
          // Reset device status
          device.isOnline = false;
          device.currentAccessPoint = undefined;

          // Find matching client
          const matchingClient = clients.find(client => device.matchesClient(client));
          
          if (matchingClient) {
            // Get traffic data if needed
            let trafficData: { rx_bytes: number; tx_bytes: number } | null = null;
            if (device.minTrafficAmount && device.minTrafficAmount > 0) {
              trafficData = await this.unifi.getClientTrafficLast15Min(matchingClient.mac);
            }

            device.updateFromClient(matchingClient, trafficData);
          }
        }
        
        // Update resident presence based on device status
        resident.updatePresence();
      }

      // Map access points for wifi point matching
      for (const wifiPoint of this.wifiPoints) {
        const matchingAP = accessPoints.find(ap => wifiPoint.matchesAccessPoint(ap));
        if (matchingAP) {
          wifiPoint.mac = matchingAP.mac;
        }
      }

      // Update accessory handlers
      this.globalPresenceHandler?.updateResidents(this.residents);
      this.globalPresenceHandler?.refresh();

      this.wifiPointHandlers.forEach(handler => {
        handler.updateResidents(this.residents);
        handler.refresh();
      });

      // Log presence summary
      const homeResidents = this.residents.filter(r => r.isHome).map(r => r.name);
      if (homeResidents.length > 0) {
        this.log.info(`Residents at home: ${homeResidents.join(', ')}`);
      } else {
        this.log.info('No residents detected at home');
      }

    } catch (error) {
      this.log.error('Error refreshing device presence:', error);
    }
  }

  // Remove unused accessories
  removeUnusedAccessories() {
    const expectedAccessories = new Set<string>();
    
    // Add global presence if enabled
    if (this.config.globalPresenceSensor) {
      expectedAccessories.add(this.api.hap.uuid.generate('global-presence'));
    }

    // Add wifi point accessories
    this.wifiPoints.forEach(wifiPoint => {
      expectedAccessories.add(this.api.hap.uuid.generate(`wifi-point-${wifiPoint.name}`));
    });

    // Remove accessories that are no longer needed
    const accessoriesToRemove: PlatformAccessory[] = [];
    this.accessories.forEach((accessory, uuid) => {
      if (!expectedAccessories.has(uuid)) {
        accessoriesToRemove.push(accessory);
      }
    });

    if (accessoriesToRemove.length > 0) {
      this.log.info(`Removing ${accessoriesToRemove.length} unused accessories`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemove);
      accessoriesToRemove.forEach(accessory => {
        this.accessories.delete(accessory.UUID);
      });
    }
  }
}
