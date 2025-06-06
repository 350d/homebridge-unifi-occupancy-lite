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
    this.log.info('Initializing UniFi Occupancy Lite platform...');

    try {
      if (!this.parseConfig()) {
        this.log.warn('Configuration incomplete - plugin will wait for proper configuration');
        return;
      }

      this.api.on('didFinishLaunching', () => {
        this.log.info('Homebridge finished launching, setting up UniFi Occupancy Lite...');
        
        try {
          this.connect();
          this.setupAccessories();
          
          // Test connection before starting refresh
          this.testConnectionAndStart();
        } catch (error) {
          this.log.error('Failed to setup platform:', error);
        }
      });
    } catch (error) {
      this.log.error('Failed to initialize platform:', error);
    }
  }

  parseConfig(): boolean {
    try {
      // Check if minimal config exists
      if (!this.config) {
        this.log.warn('No configuration provided');
        return false;
      }

      if (!this.config.unifi) {
        this.log.warn('UniFi Controller is not configured - please configure in plugin settings');
        return false;
      }

      if (!this.config.unifi.apiKey) {
        this.log.warn('UniFi API Key is required - please add API key in plugin settings');
        return false;
      }

      if (this.config.unifi.useSiteManagerApi && !this.config.unifi.hostId) {
        this.log.error('Host ID is required when using Site Manager API');
        return false;
      }

      // Set defaults safely
      this.config.interval = this.config.interval || 180;
      this.config.globalPresenceSensor = this.config.globalPresenceSensor !== false; // Default to true
      this.config.residents = this.config.residents || [];
      this.config.wifiPoints = this.config.wifiPoints || [];

      // Initialize residents safely
      try {
        this.residents = this.config.residents.map((residentConfig: ResidentConfig) => {
          if (!residentConfig.name) {
            throw new Error('Resident name is required');
          }
          return new Resident(residentConfig);
        });
      } catch (error) {
        this.log.error('Error initializing residents:', error);
        this.residents = [];
      }

      // Initialize wifi points safely
      try {
        this.wifiPoints = this.config.wifiPoints.map((wifiPointConfig: WifiPointConfig) => {
          if (!wifiPointConfig.name) {
            throw new Error('WiFi point name is required');
          }
          return new WifiPoint(wifiPointConfig);
        });
      } catch (error) {
        this.log.error('Error initializing WiFi points:', error);
        this.wifiPoints = [];
      }

      const totalDevices = this.residents.reduce((sum, r) => sum + r.devices.length, 0);
      this.log.info(`Configuration loaded: ${this.residents.length} residents, ${totalDevices} devices, ${this.wifiPoints.length} WiFi points`);

      return true;
    } catch (error) {
      this.log.error('Error parsing configuration:', error);
      return false;
    }
  }

  connect() {
    this.log.debug('Connecting to UniFi Controller...');
    
    try {
      // Log configuration for debugging (without sensitive info)
      this.log.info(`UniFi Controller: ${this.config.unifi.controller}`);
      this.log.info(`Site: ${this.config.unifi.site || 'default'}`);
      this.log.info(`Secure: ${this.config.unifi.secure || false}`);
      this.log.info(`Using Site Manager API: ${this.config.unifi.useSiteManagerApi || false}`);
      if (this.config.unifi.hostId) {
        this.log.info(`Host ID: ${this.config.unifi.hostId}`);
      }
      this.log.info(`API Key provided: ${this.config.unifi.apiKey ? 'Yes' : 'No'}`);
      
      this.unifi = new UniFiLiteClient({
        controller: this.config.unifi.controller,
        apiKey: this.config.unifi.apiKey,
        site: this.config.unifi.site || 'default',
        secure: this.config.unifi.secure || false,
        useSiteManagerApi: this.config.unifi.useSiteManagerApi || false,
        hostId: this.config.unifi.hostId
      });

      // Log detected controller type
      this.log.info(`Controller type detected: ${(this.unifi as any).controllerType}`);
      this.log.info('UniFi API Client initialized successfully');
    } catch (error) {
      this.log.error('Failed to initialize UniFi client:', error);
      throw error;
    }
  }

  setupAccessories() {
    try {
      // Setup global presence sensor
      if (this.config.globalPresenceSensor) {
        this.setupGlobalPresenceAccessory();
      }

      // Setup WiFi point accessories
      this.wifiPoints.forEach(wifiPoint => {
        try {
          this.setupWifiPointAccessory(wifiPoint);
        } catch (error) {
          this.log.error(`Failed to setup WiFi point accessory for ${wifiPoint.name}:`, error);
        }
      });

      this.log.info('Accessories setup completed');
    } catch (error) {
      this.log.error('Failed to setup accessories:', error);
    }
  }

  private setupGlobalPresenceAccessory() {
    try {
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
    } catch (error) {
      this.log.error('Failed to setup global presence accessory:', error);
    }
  }

  private setupWifiPointAccessory(wifiPoint: WifiPoint) {
    try {
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
    } catch (error) {
      this.log.error(`Failed to setup WiFi point accessory for ${wifiPoint.name}:`, error);
    }
  }

  refreshPeriodically() {
    const interval = Math.max(30, Math.min(3600, this.config.interval)) * 1000; // Clamp between 30s and 1hour
    this.log.debug(`Setting up periodic refresh every ${interval / 1000} seconds`);
    setInterval(() => this.refresh(), interval);
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug(`Configuring cached accessory: ${accessory.displayName}`);
    this.accessories.set(accessory.UUID, accessory);
  }

  async refresh() {
    try {
      this.log.debug('Refreshing device presence...');
      
      if (!this.unifi) {
        this.log.warn('UniFi client not initialized, skipping refresh');
        return;
      }

      // Get clients from UniFi using configured site
      const clients = await this.unifi.getClients();
      const accessPoints = await this.unifi.getNetworkDevices();
      
      this.log.debug(`Found ${clients.length} clients and ${accessPoints.length} access points`);

      // Update device status for each resident
      for (const resident of this.residents) {
        this.log.debug(`Checking devices for resident: ${resident.name}`);
        
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
            this.log.info(`Device ${device.name} (${resident.name}) online at AP: ${device.currentAccessPoint} - ${device.isOnline ? 'ONLINE' : 'OFFLINE'}`);
          } else {
            this.log.debug(`No matching client found for device: ${device.name} (MAC: ${device.mac})`);
          }
        }
        
        // Update resident presence based on device status
        const wasHome = resident.isHome;
        resident.updatePresence();
        
        const onlineDevices = resident.devices.filter(d => d.isOnline).length;
        this.log.debug(`Resident ${resident.name}: ${onlineDevices}/${resident.devices.length} devices online -> ${resident.isHome ? 'HOME' : 'AWAY'}`);
        
        if (wasHome !== resident.isHome) {
          this.log.info(`${resident.name} presence changed: ${wasHome ? 'HOME' : 'AWAY'} -> ${resident.isHome ? 'HOME' : 'AWAY'}`);
        }
      }

      // Update WiFi points with current access point information
      this.log.info(`Processing ${this.wifiPoints.length} WiFi points with ${accessPoints.length} access points`);
      
      // Log access points for debugging
      if (accessPoints.length > 0) {
        this.log.info(`Access points found: ${accessPoints.map(ap => `${ap.name || 'unnamed'} (${ap.mac})`).join(', ')}`);
      } else {
        this.log.warn('No access points returned from UniFi API');
      }
      
      for (const wifiPoint of this.wifiPoints) {
        this.log.info(`Processing WiFi Point: ${wifiPoint.name} (${wifiPoint.mac})`);
        
        const matchingAP = accessPoints.find(ap => wifiPoint.matchesAccessPoint(ap));
        if (matchingAP) {
          // Ensure wifiPoint has the correct MAC from the access point
          if (!wifiPoint.mac) {
            wifiPoint.mac = matchingAP.mac;
          }
          this.log.info(`WiFi Point ${wifiPoint.name} matched to AP: ${matchingAP.name || matchingAP.mac}`);
        } else {
          this.log.warn(`WiFi Point ${wifiPoint.name} (${wifiPoint.mac}) not found in access points list`);
        }
        
        // Check which residents have devices at this access point
        const residentsAtLocation = this.residents
          .filter(resident => resident.getDevicesAtAccessPoint(wifiPoint.mac || '').length > 0)
          .map(resident => {
            const devicesAtAP = resident.getDevicesAtAccessPoint(wifiPoint.mac || '');
            return `${resident.name} (${devicesAtAP.map(d => d.name).join(', ')})`;
          });
        
        this.log.info(`WiFi Point ${wifiPoint.name}: devices at AP ${wifiPoint.mac}: ${residentsAtLocation.length > 0 ? residentsAtLocation.join('; ') : 'none'}`);
        
        // Update presence based on residents at this access point
        const previousState = wifiPoint.hasResidents;
        wifiPoint.updatePresence(this.residents);
        
        if (previousState !== wifiPoint.hasResidents) {
          if (wifiPoint.hasResidents) {
            this.log.info(`WiFi Point ${wifiPoint.name}: occupied by ${residentsAtLocation.join(', ')}`);
          } else {
            this.log.info(`WiFi Point ${wifiPoint.name}: now empty`);
          }
        }
        
        this.log.info(`WiFi Point ${wifiPoint.name} status: ${wifiPoint.hasResidents ? 'occupied' : 'empty'}`);
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
        this.log.debug('No residents detected at home');
      }

    } catch (error) {
      this.log.error('Error refreshing device presence:', error);
    }
  }

  // Remove unused accessories
  removeUnusedAccessories() {
    try {
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
    } catch (error) {
      this.log.error('Error removing unused accessories:', error);
    }
  }

  async testConnectionAndStart() {
    try {
      this.log.info('Testing UniFi API connection...');
      
      // Test connection first
      let isConnected = await this.unifi.testConnection();
      
      if (!isConnected) {
        this.log.warn('Primary API endpoint failed, trying alternative configurations...');
        
        // Try alternative configurations for different UniFi device types
        const alternatives = this.getAlternativeConfigs();
        
        for (const altConfig of alternatives) {
          this.log.info(`Trying alternative configuration: ${altConfig.description}`);
          
          const altClient = new UniFiLiteClient({
            ...this.config.unifi,
            ...altConfig.config
          });
          
          if (await altClient.testConnection()) {
            this.log.info(`Successfully connected using: ${altConfig.description}`);
            this.unifi = altClient;
            isConnected = true;
            break;
          }
        }
      }
      
      if (!isConnected) {
        this.log.warn('Failed to connect to UniFi API - will retry periodically');
        // Still start the refresh cycle, it will keep trying
        this.refreshPeriodically();
        return;
      }

      this.log.info('UniFi API connection successful');
      
      // Only start refresh if we have residents configured or global sensor enabled
      if (this.residents.length > 0 || this.config.globalPresenceSensor) {
        await this.refresh();
        this.refreshPeriodically();
        this.log.info('Device presence monitoring started');
      } else {
        this.log.info('No residents or sensors configured - plugin running in standby mode');
      }
      
    } catch (error) {
      this.log.error('Failed to test connection and start refresh:', error);
      // Still start the refresh cycle, it will keep trying
      this.refreshPeriodically();
    }
  }

  private getAlternativeConfigs() {
    const baseController = this.config.unifi.controller.replace(/\/$/, '');
    const isHttps = baseController.startsWith('https://');
    const baseWithoutProtocol = baseController.replace(/^https?:\/\//, '');
    
    return [
      {
        description: 'Legacy controller without proxy prefix',
        config: { 
          controller: baseController.replace('/proxy/network', ''),
          secure: false
        }
      },
      {
        description: 'UniFi OS with HTTPS and SSL verification disabled',
        config: { 
          controller: `https://${baseWithoutProtocol}`.replace('/proxy/network', ''),
          secure: false
        }
      },
      {
        description: 'Direct UniFi controller (port 8443)',
        config: { 
          controller: `https://${baseWithoutProtocol.split(':')[0]}:8443`,
          secure: false
        }
      },
      {
        description: 'UniFi OS on port 443 without proxy',
        config: { 
          controller: `https://${baseWithoutProtocol.split(':')[0]}:443`,
          secure: false
        }
      },
      {
        description: 'Legacy controller on port 8080',
        config: { 
          controller: `http://${baseWithoutProtocol.split(':')[0]}:8080`,
          secure: false
        }
      },
      {
        description: 'Cloud Key on port 8443', 
        config: {
          controller: `https://${baseWithoutProtocol.split(':')[0]}:8443`,
          secure: false
        }
      }
    ];
  }
}
