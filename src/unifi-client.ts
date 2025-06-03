/*
 * Based on homebridge-unifi-occupancy by DouweM
 * Original: https://github.com/DouweM/homebridge-unifi-occupancy
 * Licensed under Apache-2.0
 * 
 * Modified for homebridge-unifi-occupancy-lite - supports both local controller and Site Manager API
 */

import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { URL } from 'url';

export interface UniFiConfig {
  controller: string;
  apiKey: string;
  site: string;
  secure: boolean;
  useSiteManagerApi?: boolean;
  hostId?: string;
}

export class UniFiLiteClient {
  private config: UniFiConfig;
  private baseUrl: string;

  constructor(config: UniFiConfig) {
    this.config = config;
    
    if (config.useSiteManagerApi) {
      // Site Manager API base URL
      this.baseUrl = 'https://api.ui.com';
    } else {
      // Local controller API - Remove trailing slash and add the proxy prefix for UniFi OS devices
      this.baseUrl = `${config.controller.replace(/\/$/, '')}/proxy/network`;
    }
  }

  /**
   * Make HTTP request to UniFi API using Node.js built-in modules
   */
  private async request(endpoint: string, options: any = {}): Promise<any> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Set appropriate auth header based on API type
    if (this.config.useSiteManagerApi) {
      headers['X-API-Key'] = this.config.apiKey;
    } else {
      headers['X-API-KEY'] = this.config.apiKey;
    }

    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers,
      rejectUnauthorized: this.config.secure
    };

    return new Promise((resolve, reject) => {
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`UniFi API Error: HTTP ${res.statusCode} - ${res.statusMessage}`));
              return;
            }

            const jsonData = JSON.parse(data);
            
            if (this.config.useSiteManagerApi) {
              // Site Manager API returns data directly in data field
              resolve(jsonData.data !== undefined ? jsonData.data : jsonData);
            } else {
              // Local controller API wraps data in { meta: {}, data: [] }
              resolve(jsonData.data !== undefined ? jsonData.data : jsonData);
            }
          } catch (error) {
            reject(new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`UniFi API request failed: ${error.message}`));
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  /**
   * GET request
   */
  async get(endpoint: string): Promise<any> {
    return this.request(endpoint, { method: 'GET' });
  }

  /**
   * POST request
   */
  async post(endpoint: string, data?: any): Promise<any> {
    return this.request(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * Get all sites
   */
  async getSites(): Promise<any[]> {
    if (this.config.useSiteManagerApi) {
      return this.get('/v1/sites');
    } else {
      return this.get('/api/stat/sites');
    }
  }

  /**
   * Get active clients for a site
   */
  async getClients(site = this.config.site): Promise<any[]> {
    if (this.config.useSiteManagerApi) {
      // For Site Manager API, we need to get devices and filter clients
      return this.getDevices().then(devices => {
        // Extract client information from devices
        return devices.flatMap(host => 
          host.devices?.filter(device => device.productLine === 'network') || []
        );
      });
    } else {
      return this.get(`/api/site/${site}/clients/active`);
    }
  }

  /**
   * Get devices using Site Manager API or local controller
   */
  async getDevices(): Promise<any[]> {
    if (this.config.useSiteManagerApi) {
      const params = this.config.hostId ? `?hostIds[]=${this.config.hostId}` : '';
      return this.get(`/v1/devices${params}`);
    } else {
      return this.getNetworkDevices();
    }
  }

  /**
   * Get network devices (access points, switches)
   */
  async getNetworkDevices(site = this.config.site): Promise<any[]> {
    if (this.config.useSiteManagerApi) {
      return this.getDevices().then(devices => {
        return devices.flatMap(host => 
          host.devices?.filter(device => 
            device.productLine === 'network' && 
            (device.model?.includes('AP') || device.model?.includes('Switch'))
          ) || []
        );
      });
    } else {
      return this.get(`/api/site/${site}/device`);
    }
  }

  /**
   * Get device fingerprints database
   */
  async getDeviceFingerprints(): Promise<any> {
    if (this.config.useSiteManagerApi) {
      // Site Manager API doesn't have fingerprint endpoint, return empty object
      return {};
    } else {
      return this.get('/api/fingerprint_devices/0');
    }
  }

  /**
   * Get client statistics including traffic data
   */
  async getClientStats(mac: string, site = this.config.site): Promise<any> {
    if (this.config.useSiteManagerApi) {
      // Site Manager API doesn't have detailed client stats, return null
      return null;
    } else {
      return this.get(`/api/site/${site}/stat/client/${mac}`);
    }
  }

  /**
   * Get site statistics
   */
  async getSiteStats(site = this.config.site): Promise<any> {
    if (this.config.useSiteManagerApi) {
      // Site Manager API doesn't have site stats, return null
      return null;
    } else {
      return this.get(`/api/site/${site}/stat/sites`);
    }
  }

  /**
   * Get ISP metrics (Site Manager API only)
   */
  async getIspMetrics(): Promise<any> {
    if (this.config.useSiteManagerApi) {
      const params = this.config.hostId ? `?hostIds[]=${this.config.hostId}` : '';
      return this.get(`/v1/isp-metrics${params}`);
    } else {
      return null;
    }
  }

  /**
   * Get client traffic data for the last 15 minutes
   */
  async getClientTrafficLast15Min(mac: string): Promise<{ rx_bytes: number; tx_bytes: number } | null> {
    try {
      if (this.config.useSiteManagerApi) {
        // Site Manager API doesn't provide detailed traffic stats
        // This would need to be implemented if the API supports it in the future
        return null;
      } else {
        // For local controller, try to get recent client stats
        const stats = await this.getClientStats(mac);
        if (stats && stats.length > 0) {
          const client = stats[0];
          // Return recent traffic data if available
          return {
            rx_bytes: client.rx_bytes || 0,
            tx_bytes: client.tx_bytes || 0
          };
        }
      }
    } catch (error) {
      // Traffic data is optional, don't throw error
      return null;
    }
    return null;
  }

  /**
   * For compatibility with original code
   */
  get opts() {
    return { site: this.config.site };
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      if (this.config.useSiteManagerApi) {
        await this.getDevices();
      } else {
        await this.getSites();
      }
      return true;
    } catch (error) {
      return false;
    }
  }
} 