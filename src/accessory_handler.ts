import { PlatformAccessory } from 'homebridge';
import { UnifiOccupancyPlatform } from './platform';

export abstract class AccessoryHandler {
  protected platform: UnifiOccupancyPlatform;
  protected accessory: PlatformAccessory;

  constructor(
    platform: UnifiOccupancyPlatform,
    accessory: PlatformAccessory
  ) {
    this.platform = platform;
    this.accessory = accessory;
  }

  abstract refresh(): void;
  abstract getDisplayName(): string;
  abstract getStatusSummary(): string;
} 