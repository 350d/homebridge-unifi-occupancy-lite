import { PlatformAccessory } from 'homebridge';
import { UnifiOccupancyPlatform } from './platform';
import { AccessoryHandler } from './accessory_handler';
import { WifiPoint, Resident } from './resident';

export class WifiPointAccessoryHandler extends AccessoryHandler {
  private wifiPoint: WifiPoint;
  private residents: Resident[] = [];

  constructor(
    platform: UnifiOccupancyPlatform,
    accessory: PlatformAccessory,
    wifiPoint: WifiPoint,
    residents: Resident[]
  ) {
    super(platform, accessory);
    this.wifiPoint = wifiPoint;
    this.residents = residents;
    this.setupServices();
  }

  private setupServices(): void {
    // Get or create occupancy sensor service
    let service = this.accessory.getService(this.platform.Service.OccupancySensor);
    
    if (!service) {
      service = this.accessory.addService(
        this.platform.Service.OccupancySensor,
        this.wifiPoint.name,
        `wifi-point-${this.wifiPoint.name}`
      );
      this.platform.log.debug(`Created new occupancy sensor service for wifi point: ${this.wifiPoint.name}`);
    }

    // Set up characteristics
    service.setCharacteristic(this.platform.Characteristic.Name, `${this.wifiPoint.name} Presence`);
    
    // Set initial state
    this.updatePresenceState();
  }

  public updateResidents(residents: Resident[]): void {
    this.residents = residents;
    this.updatePresenceState();
  }

  private updatePresenceState(): void {
    const service = this.accessory.getService(this.platform.Service.OccupancySensor);
    if (!service) {
      return;
    }

    // Store previous state
    const previousState = this.wifiPoint.hasResidents;

    // Update wifi point presence based on residents
    this.wifiPoint.updatePresence(this.residents);
    
    // Update occupancy detected characteristic
    service.updateCharacteristic(
      this.platform.Characteristic.OccupancyDetected,
      this.wifiPoint.hasResidents ? 1 : 0
    );

    // Log status change only when it changes
    if (previousState !== this.wifiPoint.hasResidents) {
      const status = this.wifiPoint.hasResidents ? 'detected' : 'not detected';
      this.platform.log.info(`${this.wifiPoint.name} presence ${status}`);
    }
  }

  public refresh(): void {
    this.updatePresenceState();
  }

  public getDisplayName(): string {
    return `${this.wifiPoint.name} Presence`;
  }

  public getStatusSummary(): string {
    if (this.wifiPoint.hasResidents) {
      const residentsAtLocation = this.residents
        .filter(resident => resident.getDevicesAtAccessPoint(this.wifiPoint.mac || '').length > 0)
        .map(resident => resident.name);
      
      return `Present: ${residentsAtLocation.join(', ')}`;
    } else {
      return 'No one present';
    }
  }
} 