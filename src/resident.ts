export interface DeviceConfig {
  name: string;
  hostname?: string;
  ip?: string;
  mac?: string;
  minTrafficAmount?: number;
}

export interface ResidentConfig {
  name: string;
  devices: DeviceConfig[];
}

export interface WifiPointConfig {
  name: string;
  ip?: string;
  mac?: string;
}

export class Device {
  public name: string;
  public hostname?: string;
  public ip?: string;
  public mac?: string;
  public minTrafficAmount?: number;
  public lastSeen?: Date;
  public isOnline = false;
  public currentAccessPoint?: string;
  public trafficBytes = 0;

  constructor(config: DeviceConfig) {
    this.name = config.name;
    this.hostname = config.hostname;
    this.ip = config.ip;
    this.mac = config.mac;
    this.minTrafficAmount = config.minTrafficAmount;
  }

  /**
   * Check if this device matches the given UniFi client
   */
  matchesClient(client: any): boolean {
    // Check MAC address first (most reliable)
    if (this.mac && client.mac && this.mac.toLowerCase() === client.mac.toLowerCase()) {
      return true;
    }

    // Check IP address
    if (this.ip && client.ip && this.ip === client.ip) {
      return true;
    }

    // Check hostname
    if (this.hostname && client.hostname && 
        this.hostname.toLowerCase() === client.hostname.toLowerCase()) {
      return true;
    }

    // Check if hostname matches device name
    if (this.hostname && client.name && 
        this.hostname.toLowerCase() === client.name.toLowerCase()) {
      return true;
    }

    return false;
  }

  /**
   * Update device status from UniFi client data
   */
  updateFromClient(client: any, trafficData?: { rx_bytes: number; tx_bytes: number } | null): void {
    // Accept both wired and wireless connections
    this.isOnline = true;
    this.lastSeen = new Date();
    
    // Set access point MAC from client data
    this.currentAccessPoint = client.ap_mac || client.sw_mac || client.uplink_mac || client.access_point_mac;

    // Update traffic data if available
    if (trafficData) {
      this.trafficBytes = trafficData.rx_bytes + trafficData.tx_bytes;
    }

    // If minTrafficAmount is set, check if device has enough traffic
    if (this.minTrafficAmount && this.minTrafficAmount > 0) {
      const trafficKB = this.trafficBytes / 1024;
      const hasEnoughTraffic = trafficKB >= this.minTrafficAmount;
      this.isOnline = this.isOnline && hasEnoughTraffic;
    }
  }
}

export class Resident {
  public name: string;
  public devices: Device[] = [];
  public isHome = false;

  constructor(config: ResidentConfig) {
    this.name = config.name;
    this.devices = config.devices.map(deviceConfig => new Device(deviceConfig));
  }

  /**
   * Update resident status based on device presence
   */
  updatePresence(): void {
    this.isHome = this.devices.some(device => device.isOnline);
  }

  /**
   * Get devices connected to specific access point
   */
  getDevicesAtAccessPoint(accessPointMac: string): Device[] {
    return this.devices.filter(device => 
      device.isOnline && device.currentAccessPoint === accessPointMac
    );
  }
}

export class WifiPoint {
  public name: string;
  public ip?: string;
  public mac?: string;
  public hasResidents = false;

  constructor(config: WifiPointConfig) {
    this.name = config.name;
    this.ip = config.ip;
    this.mac = config.mac;
  }

  /**
   * Check if this wifi point matches the given access point
   */
  matchesAccessPoint(accessPoint: any): boolean {
    // Check MAC address
    if (this.mac && accessPoint.mac && 
        this.mac.toLowerCase() === accessPoint.mac.toLowerCase()) {
      return true;
    }

    // Check IP address
    if (this.ip && accessPoint.ip && this.ip === accessPoint.ip) {
      return true;
    }

    return false;
  }

  /**
   * Update presence based on residents at this access point
   */
  updatePresence(residents: Resident[]): void {
    if (!this.mac) {
      this.hasResidents = false;
      return;
    }

    this.hasResidents = residents.some(resident => 
      resident.getDevicesAtAccessPoint(this.mac!).length > 0
    );
  }
} 