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
      // Local controller API
      let controllerUrl = config.controller.replace(/\/$/, '');
      
      // Only add proxy/network if not already present and it's likely a UniFi OS device
      if (!controllerUrl.includes('/proxy/network') && 
          !controllerUrl.includes(':8443') &&
          !controllerUrl.includes(':8080') &&
          (controllerUrl.match(/^https?:\/\/\d+\.\d+\.\d+\.\d+$/) || 
           controllerUrl.includes('.local') ||
           controllerUrl.includes('unifi.ui.com'))) {
        // Modern UniFi OS devices typically need the proxy prefix
        this.baseUrl = `${controllerUrl}/proxy/network`;
      } else {
        // Use URL as-is for legacy controllers or when proxy is already specified
        this.baseUrl = controllerUrl;
      }
    }
  }

  /**
   * Make HTTP request to UniFi API using Node.js built-in modules
   */
  private async request(endpoint: string, options: any = {}): Promise<any> {
    // Properly construct full URL by concatenating baseUrl and endpoint
    const fullUrl = `${this.baseUrl}${endpoint}`;
    const url = new URL(fullUrl);
    
    const headers: any = {
      'Content-Type': 'application/json',
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
              // Enhanced error reporting with response body
              let errorMessage = `UniFi API Error: HTTP ${res.statusCode} - ${res.statusMessage}`;
              
              // Try to parse error details from response
              try {
                const errorData = JSON.parse(data);
                if (errorData.message) {
                  errorMessage += ` | Message: ${errorData.message}`;
                }
                if (errorData.error) {
                  errorMessage += ` | Error: ${errorData.error}`;
                }
                if (errorData.details) {
                  errorMessage += ` | Details: ${JSON.stringify(errorData.details)}`;
                }
              } catch (parseError) {
                // If JSON parsing fails, include raw response
                if (data && data.length > 0 && data.length < 500) {
                  errorMessage += ` | Response: ${data}`;
                }
              }
              
              // Add request details for debugging
              errorMessage += ` | Request: ${options.method || 'GET'} ${fullUrl}`;
              
              reject(new Error(errorMessage));
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
            reject(new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)} | Raw response: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`UniFi API request failed: ${error.message} | Request: ${options.method || 'GET'} ${fullUrl}`));
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
      // Try multiple site endpoints
      const endpointsToTry = [
        '/api/stat/sites',
        '/api/sites',
        '/api/self/sites'
      ];

      for (const endpoint of endpointsToTry) {
        try {
          const result = await this.get(endpoint);
          console.log(`Successfully fetched sites from: ${endpoint}`);
          return result;
        } catch (error) {
          console.log(`Failed to fetch sites from ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }

      // If all endpoints fail, return default site
      console.log('All site endpoints failed, using default site');
      return [{ name: 'default' }];
    }
  }

  /**
   * Get the first available site name or default
   */
  async getFirstSite(): Promise<string> {
    try {
      const sites = await this.getSites();
      if (sites && sites.length > 0) {
        return sites[0].name || 'default';
      }
    } catch (error) {
      console.log(`Failed to get sites: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 'default';
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
      // Try multiple client endpoints with different site configurations
      const endpointsToTry = [
        `/api/s/${site}/clients/active`,
        `/api/s/${site}/stat/alluser`,
        `/api/s/${site}/stat/sta`,
        `/api/stat/sta`,
        `/api/clients/active`,
        `/api/stat/alluser`,
        `/api/s/default/clients/active`,
        `/api/s/default/stat/alluser`,
        `/api/s/default/stat/sta`
      ];

      for (const endpoint of endpointsToTry) {
        try {
          const result = await this.get(endpoint);
          console.log(`Successfully fetched clients from: ${endpoint}`);
          return result;
        } catch (error) {
          console.log(`Failed to fetch clients from ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }

      // If all endpoints fail, return empty array to prevent crash
      console.log('All client endpoints failed, returning empty array');
      return [];
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
      // Try multiple device endpoints
      const endpointsToTry = [
        `/api/s/${site}/stat/device`,
        `/api/s/${site}/device`,
        `/api/stat/device`,
        `/api/device`,
        `/api/s/default/stat/device`,
        `/api/s/default/device`
      ];

      for (const endpoint of endpointsToTry) {
        try {
          const result = await this.get(endpoint);
          console.log(`Successfully fetched devices from: ${endpoint}`);
          return result;
        } catch (error) {
          console.log(`Failed to fetch devices from ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }

      // If all endpoints fail, return empty array
      console.log('All device endpoints failed, returning empty array');
      return [];
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
        return true;
      } else {
        // Try multiple endpoints to test connection
        try {
          // First try sites endpoint
          await this.getSites();
          return true;
        } catch (sitesError) {
          const errorMsg = sitesError instanceof Error ? sitesError.message : String(sitesError);
          console.log(`Sites endpoint failed: ${errorMsg}`);
          
          try {
            // Try devices endpoint as fallback
            await this.getNetworkDevices();
            return true;
          } catch (devicesError) {
            const devErrorMsg = devicesError instanceof Error ? devicesError.message : String(devicesError);
            console.log(`Devices endpoint failed: ${devErrorMsg}`);
            
            try {
              // Try clients endpoint as last resort
              await this.getClients();
              return true;
            } catch (clientsError) {
              const clientErrorMsg = clientsError instanceof Error ? clientsError.message : String(clientsError);
              console.log(`Clients endpoint failed: ${clientErrorMsg}`);
              console.log(`Base URL used: ${this.baseUrl}`);
              return false;
            }
          }
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`Connection test failed: ${errorMsg}`);
      return false;
    }
  }
} 