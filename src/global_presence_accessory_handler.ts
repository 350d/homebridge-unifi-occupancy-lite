import { PlatformAccessory } from 'homebridge';
import { UnifiOccupancyPlatform } from './platform';
import { AccessoryHandler } from './accessory_handler';
import { Resident } from './resident';

export class GlobalPresenceAccessoryHandler extends AccessoryHandler {
  private residents: Resident[] = [];

  constructor(
    platform: UnifiOccupancyPlatform,
    accessory: PlatformAccessory,
    residents: Resident[]
  ) {
    super(platform, accessory);
    this.residents = residents;
    this.setupServices();
  }

  private setupServices(): void {
    // Get or create occupancy sensor service
    let service = this.accessory.getService(this.platform.Service.OccupancySensor);
    
    if (!service) {
      service = this.accessory.addService(
        this.platform.Service.OccupancySensor,
        'Global Presence',
        'global-presence'
      );
      this.platform.log.debug('Created new occupancy sensor service for global presence');
    }

    // Set up characteristics
    service.setCharacteristic(this.platform.Characteristic.Name, 'Global Presence');
    
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

    // Check if any resident is home
    const anyoneHome = this.residents.some(resident => resident.isHome);
    
    // Update occupancy detected characteristic
    service.updateCharacteristic(
      this.platform.Characteristic.OccupancyDetected,
      anyoneHome ? 1 : 0
    );

    // Log status change
    const status = anyoneHome ? 'detected' : 'not detected';
    this.platform.log.debug(`Global presence ${status}`);
  }

  public refresh(): void {
    this.updatePresenceState();
  }

  public getDisplayName(): string {
    return 'Global Presence';
  }

  public getStatusSummary(): string {
    const anyoneHome = this.residents.some(resident => resident.isHome);
    const homeResidents = this.residents
      .filter(resident => resident.isHome)
      .map(resident => resident.name);

    if (anyoneHome) {
      return `Home: ${homeResidents.join(', ')}`;
    } else {
      return 'Nobody home';
    }
  }
} 